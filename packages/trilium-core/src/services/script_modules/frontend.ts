import type { FrontendScriptModule, UnavailableScriptModule } from "@triliumnext/commons";

import becca from "../../becca/becca.js";
import { compileModuleSource, selectInstalledModule } from "./loader.js";
import {
    formatPackageSpec,
    listScriptModules,
    openScriptModuleSources,
    type StoredScriptModule
} from "./storage.js";

/** `require("x")` with a literal name, the only form answerable ahead of the script running. */
const REQUIRE_CALL = /\brequire\s*\(\s*(["'])([^"'\n]+)\1\s*\)/g;

/** What a frontend bundle needs handed to it, and what it asked for that cannot be. */
export interface FrontendModules {
    modules: FrontendScriptModule[];
    unavailable: UnavailableScriptModule[];
}

/**
 * Gathers the packages a frontend bundle requires, compiled and ready to evaluate.
 *
 * A browser has no database to read and no compiler for what is stored, so both happen here and the
 * page receives runnable text. Only what the bundle names is gathered: a script pays for the
 * packages it uses rather than for everything installed, which is what keeps this affordable on a
 * phone.
 */
export function collectFrontendModules(script: string): FrontendModules {
    const installed = listScriptModules();
    const modules = new Map<string, FrontendScriptModule>();
    const unavailable: UnavailableScriptModule[] = [];

    for (const specifier of readRequiredSpecifiers(script)) {
        let found: StoredScriptModule | undefined;
        try {
            // A browser cannot run a Node build, so one is as good as not installed here.
            found = selectInstalledModule(installed, specifier, false);
        } catch (e) {
            unavailable.push({ specifier, reason: e instanceof Error ? e.message : String(e) });
            continue;
        }

        if (!found) {
            // Not every specifier names a package: a child note of the script is one too, and the
            // bundle already carries those. Nothing to say about a name this does not know.
            continue;
        }

        const already = modules.get(found.noteId);
        if (already) {
            already.specifiers.push(specifier);
            continue;
        }

        try {
            modules.set(found.noteId, compileForFrontend(found, specifier));
        } catch (e) {
            unavailable.push({ specifier, reason: e instanceof Error ? e.message : String(e) });
        }
    }

    return { modules: [ ...modules.values() ], unavailable };
}

/**
 * The literal module names a script requires.
 *
 * Found by pattern rather than by parsing, which over-matches: text that reads as a `require` call
 * is counted too. That costs a lookup for a name nothing has installed, where under-matching would
 * cost a script the package it asked for. A computed name is invisible either way, and fails at the
 * call with its own message.
 */
export function readRequiredSpecifiers(script: string): string[] {
    const seen = new Set<string>();
    for (const match of script.matchAll(REQUIRE_CALL)) {
        seen.add(match[2]);
    }

    return [ ...seen ];
}

/** Reads a package's files and compiles each one, naming it by the specifier that found it. */
function compileForFrontend(module: StoredScriptModule, specifier: string): FrontendScriptModule {
    const note = becca.getNoteOrThrow(module.noteId);
    const readSource = openScriptModuleSources(note);
    const name = formatPackageSpec(module.spec);

    const files = module.files.map((file) => {
        const source = readSource(file.name);
        if (source === undefined) {
            throw new Error(`File '${file.name}' of script module '${name}' is missing.`);
        }

        const code = compileModuleSource(source, file.name, name);
        return { name: file.name, url: file.url, code };
    });

    return {
        noteId: module.noteId,
        specifiers: [ specifier ],
        entry: module.entry,
        fingerprint: module.files.map((file) => `${file.name}@${file.blobId}`).join("|"),
        files
    };
}
