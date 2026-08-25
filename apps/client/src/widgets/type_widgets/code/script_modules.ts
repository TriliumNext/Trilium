import { type Completion, type CompletionContext, type CompletionSource } from "@codemirror/autocomplete";
import type VanillaCodeMirror from "@triliumnext/codemirror";
import type { ScriptModuleSummary } from "@triliumnext/commons";
import { useCallback, useEffect, useRef } from "preact/hooks";

import type LoadResults from "../../../services/load_results.js";
import server from "../../../services/server.js";
import { useTriliumEvent } from "../../react/hooks";

/**
 * Matches the specifier being typed inside `require("…")`, capturing what has been typed so far.
 * Either quote, since both are valid JavaScript.
 */
export const REQUIRE_SPECIFIER_REGEX = /require\(\s*["']([^"']*)/;

/** Note the installed packages hang under, so an install or a removal is noticed. */
const SCRIPT_MODULES_ROOT = "_scriptModules";

/**
 * Builds the completions offered inside `require("…")`, one per installed package.
 *
 * A package installed for both builds, or at more than one version, is one specifier and so one
 * completion; the versions behind it are what `detail` shows.
 */
export function buildScriptModuleCompletions(modules: ScriptModuleSummary[]): Completion[] {
    const specsByName = new Map<string, Set<string>>();
    for (const module of modules) {
        const specs = specsByName.get(module.name) ?? new Set<string>();
        specs.add(module.spec);
        specsByName.set(module.name, specs);
    }

    return [ ...specsByName ]
        .sort(([ a ], [ b ]) => a.localeCompare(b))
        .map(([ name, specs ]) => ({
            label: name,
            detail: [ ...specs ].sort().join(", "),
            type: "namespace"
        }));
}

/** Whether the reloaded entities could change what is installed — a package was added or removed. */
export function isScriptModuleChange(loadResults: LoadResults): boolean {
    return loadResults.getBranchRows().some((branch) => branch.parentNoteId === SCRIPT_MODULES_ROOT);
}

/**
 * Offers the installed script modules as completions inside `require("…")`.
 *
 * Backend scripts only: the client's `require()` resolves child notes and nothing else, so on a
 * frontend note the list would name packages the script cannot reach. Like the snippet source, this
 * registers with the editor's shared completion registry, so it co-exists with the TypeScript
 * language service rather than replacing it.
 */
export function useScriptModuleCompletions(editorView: VanillaCodeMirror | null, enabled: boolean) {
    const modulesRef = useRef<ScriptModuleSummary[]>([]);
    // Monotonic id so a slow listing that resolves after a newer reload is discarded.
    const reloadCountRef = useRef(0);

    const reload = useCallback(() => {
        if (!enabled) {
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
    }, [ enabled ]);

    useEffect(() => { reload(); }, [ reload ]);

    useTriliumEvent("entitiesReloaded", ({ loadResults }) => {
        if (enabled && isScriptModuleChange(loadResults)) {
            reload();
        }
    });

    useEffect(() => {
        if (!editorView) return;
        if (!enabled) {
            editorView.setCompletionSource("scriptModules", null);
            return;
        }

        const source: CompletionSource = (context: CompletionContext) => {
            const match = context.matchBefore(REQUIRE_SPECIFIER_REGEX);
            const typed = match && REQUIRE_SPECIFIER_REGEX.exec(match.text)?.[1];
            if (!match || typed == null) return null;

            const options = buildScriptModuleCompletions(modulesRef.current);
            // Nothing installed → no source, so an empty popup never appears over a require().
            return options.length ? { from: match.to - typed.length, options } : null;
        };

        // `setCompletionSource` types its argument via the codemirror package's own copy of
        // @codemirror/autocomplete, a distinct type identity from the client's copy under project
        // references even though it is the same package at runtime — hence the bridge.
        type CmCompletionSource = Parameters<VanillaCodeMirror["setCompletionSource"]>[1];
        editorView.setCompletionSource("scriptModules", source as unknown as CmCompletionSource);
        return () => editorView.setCompletionSource("scriptModules", null);
    }, [ editorView, enabled ]);
}
