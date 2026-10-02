import { type Completion, type CompletionContext, type CompletionSource } from "@codemirror/autocomplete";
import { SCRIPT_MIME_BACKEND, SCRIPT_MIME_FRONTEND, SCRIPT_MIME_JSX, default as VanillaCodeMirror } from "@triliumnext/codemirror";
import type { ScriptModuleSummary, ScriptModuleTypes } from "@triliumnext/commons";
import { useCallback, useEffect, useRef, useState } from "preact/hooks";

import type LoadResults from "../../../services/load_results.js";
import server from "../../../services/server.js";
import { useTriliumEvent } from "../../react/hooks";

/**
 * Matches the module specifier being typed, capturing what has been typed so far.
 *
 * Both forms a script note reaches a package by: the `require("…")` a backend or frontend script
 * writes, and the `import … from "…"` a JSX render note writes, which becomes a require when the
 * note is built. Either quote, since both are valid JavaScript.
 */
export const MODULE_SPECIFIER_REGEX = /(?:\b(?:require|import)\s*\(\s*|\bfrom\s+|\bimport\s+)["']([^"']*)/;

/** Note the installed packages hang under, so an install or a removal is noticed. */
const SCRIPT_MODULES_ROOT = "_scriptModules";

/**
 * Which runtime a script note's code runs in, which is what decides the packages it can reach.
 *
 * Frontend and JSX notes are one answer: both run on the page, where a package installed only as a
 * Node.js build has nothing to run it.
 */
export type ScriptRuntime = "backend" | "frontend";

/** The runtime a MIME type names, or `null` where the note is not a script note at all. */
export function scriptRuntimeFor(mime: string | null | undefined): ScriptRuntime | null {
    if (mime === SCRIPT_MIME_BACKEND) {
        return "backend";
    }
    if (mime === SCRIPT_MIME_FRONTEND || mime === SCRIPT_MIME_JSX) {
        return "frontend";
    }
    return null;
}

/**
 * Builds the completions offered on a module specifier, one per package the runtime can reach.
 *
 * A package installed for both builds, or at more than one version, is one specifier and so one
 * completion; the versions behind it are what `detail` shows. One installed only for Node.js is
 * left out of a frontend note's list, where asking for it fails at the require rather than typing.
 */
export function buildScriptModuleCompletions(
    modules: ScriptModuleSummary[],
    runtime: ScriptRuntime
): Completion[] {
    const installsByName = new Map<string, ScriptModuleSummary[]>();
    for (const module of modules) {
        installsByName.set(module.name, [ ...installsByName.get(module.name) ?? [], module ]);
    }

    return [ ...installsByName ]
        .filter(([ , installs ]) => installs.some((install) => reachableFrom(runtime, install.target)))
        .sort(([ a ], [ b ]) => a.localeCompare(b))
        .map(([ name, installs ]) => ({
            label: name,
            detail: [ ...new Set(installs.map((install) => install.spec)) ].sort().join(", "),
            type: "namespace"
        }));
}

/** Whether a build of this target runs where the note's script does. */
function reachableFrom(runtime: ScriptRuntime, target: ScriptModuleSummary["target"]): boolean {
    return runtime === "backend" || target !== "node";
}

/** Whether the reloaded entities could change what is installed — a package was added or removed. */
export function isScriptModuleChange(loadResults: LoadResults): boolean {
    return loadResults.getBranchRows().some((branch) => branch.parentNoteId === SCRIPT_MODULES_ROOT);
}

/**
 * Offers the installed script modules as completions on the specifier a script names one by.
 *
 * Like the snippet source, this registers with the editor's shared completion registry, so it
 * co-exists with the TypeScript language service rather than replacing it. `runtime` is `null` on a
 * note that is not a script, where there is nothing to offer.
 */
export function useScriptModuleCompletions(
    editorView: VanillaCodeMirror | null,
    runtime: ScriptRuntime | null
) {
    const modulesRef = useRef<ScriptModuleSummary[]>([]);
    // Monotonic id so a slow listing that resolves after a newer reload is discarded.
    const reloadCountRef = useRef(0);

    const reload = useCallback(() => {
        if (!runtime) {
            modulesRef.current = [];
            return;
        }

        const reloadId = ++reloadCountRef.current;
        void server.get<ScriptModuleSummary[]>("script-modules")
            .then((modules) => {
                if (reloadId === reloadCountRef.current) {
                    modulesRef.current = modules;
                }
            })
            .catch((e: unknown) => logError("Error while listing script modules: ", e));
    }, [ runtime ]);

    useEffect(() => { reload(); }, [ reload ]);

    useTriliumEvent("entitiesReloaded", ({ loadResults }) => {
        if (runtime && isScriptModuleChange(loadResults)) {
            reload();
        }
    });

    useEffect(() => {
        if (!editorView) return;
        if (!runtime) {
            editorView.setCompletionSource("scriptModules", null);
            return;
        }

        const source: CompletionSource = (context: CompletionContext) => {
            const match = context.matchBefore(MODULE_SPECIFIER_REGEX);
            const typed = match && MODULE_SPECIFIER_REGEX.exec(match.text)?.[1];
            if (!match || typed == null) return null;

            const options = buildScriptModuleCompletions(modulesRef.current, runtime);
            // Nothing to offer → no source, so an empty popup never appears over a specifier.
            return options.length ? { from: match.to - typed.length, options } : null;
        };

        // `setCompletionSource` types its argument via the codemirror package's own copy of
        // @codemirror/autocomplete, a distinct type identity from the client's copy under project
        // references even though it is the same package at runtime — hence the bridge.
        type CmCompletionSource = Parameters<VanillaCodeMirror["setCompletionSource"]>[1];
        editorView.setCompletionSource("scriptModules", source as unknown as CmCompletionSource);
        return () => editorView.setCompletionSource("scriptModules", null);
    }, [ editorView, runtime ]);
}

/**
 * The declarations of the packages this note can reach, for the editor to type what it imports.
 *
 * Held against one shared request rather than one per editor: the declarations are megabytes where
 * the sources are, and two split panes want the same answer. An install or a removal drops it, and
 * every editor asks again.
 */
export function useScriptModuleTypes(runtime: ScriptRuntime | null): ScriptModuleTypes[] {
    const [ types, setTypes ] = useState<ScriptModuleTypes[]>([]);

    const reload = useCallback(() => {
        if (!runtime) {
            setTypes([]);
            return;
        }

        let current = true;
        void loadScriptModuleTypes().then((loaded) => {
            // A page has no way to run a Node.js build, so typing one would promise a script
            // something that fails at the require.
            if (current) setTypes(loaded.filter((module) => runtime === "backend" || module.portable));
        });
        return () => { current = false; };
    }, [ runtime ]);

    useEffect(() => reload(), [ reload ]);

    useTriliumEvent("entitiesReloaded", ({ loadResults }) => {
        if (isScriptModuleChange(loadResults)) {
            cachedTypes = null;
            reload();
        }
    });

    return types;
}

/** The one in-flight or settled request for the declarations, dropped when an install changes. */
let cachedTypes: Promise<ScriptModuleTypes[]> | null = null;

function loadScriptModuleTypes(): Promise<ScriptModuleTypes[]> {
    cachedTypes ??= server.get<ScriptModuleTypes[]>("script-modules/types")
        .catch((e: unknown) => {
            logError("Error while loading script module types: ", e);
            cachedTypes = null;
            return [];
        });

    return cachedTypes;
}
