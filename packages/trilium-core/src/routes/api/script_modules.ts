import type { ScriptModuleSearchResult, ScriptModuleSummary, ScriptModuleTypes } from "@triliumnext/commons";
import type { Request } from "express";

import { NotFoundError, ValidationError } from "../../errors.js";
import { forgetScriptModule } from "../../services/script_modules/loader.js";
import { searchPackages } from "../../services/script_modules/npm_registry.js";
import {
    type ModuleTarget,
    parsePackageSpec,
    resolveScriptModule
} from "../../services/script_modules/provider.js";
import {
    deleteScriptModule,
    findScriptModuleByNoteId,
    formatPackageSpec,
    listScriptModules,
    readScriptModuleTypes,
    type StoredScriptModule,
    storeScriptModule
} from "../../services/script_modules/storage.js";
import { assertScriptingEnabled } from "../../services/scripting_guard.js";
import { getSql } from "../../services/sql/index.js";

function list(): ScriptModuleSummary[] {
    return listScriptModules().map(summarize);
}

/**
 * The declarations every installed package is typed by, for the script editor to complete from.
 *
 * One call for all of them, since the editor puts the whole set in front of TypeScript at once. A
 * package installed for both builds is one answer: the two carry the same declarations, and the
 * editor is typing a `require()`, which names a package rather than a build.
 */
function types(): ScriptModuleTypes[] {
    const answered = new Set<string>();
    const modules: ScriptModuleTypes[] = [];

    for (const module of listScriptModules()) {
        const name = bareSpecifier(module);
        if (answered.has(name)) {
            continue;
        }

        const files = readScriptModuleTypes(module);
        if (!module.types || !files) {
            continue;
        }

        answered.add(name);
        modules.push({ name, spec: formatPackageSpec(module.spec), entry: module.types.entry, files });
    }

    return modules;
}

/**
 * Asks the package registry what matches a query.
 *
 * A route of its own rather than part of the install, because it is a separate decision: it tells a
 * third party what someone is looking for, and the dialog reaches it only when the search button is
 * pressed.
 */
async function search(req: Request): Promise<ScriptModuleSearchResult[]> {
    assertScriptingEnabled();

    const query = req.query.q;
    if (typeof query !== "string") {
        throw new ValidationError("A search needs something to search for.");
    }

    return searchPackages(query);
}

/**
 * Fetches a package through the first provider that can build it and stores it, replacing any
 * build of the same version already there.
 *
 * The fetch is the slow part and must not hold a transaction open, so only the write is wrapped in
 * one — a package that arrives whole is stored whole, or not at all.
 */
async function install(req: Request) {
    assertScriptingEnabled();

    const { spec, target } = req.body ?? {};
    if (typeof spec !== "string") {
        throw new ValidationError("A package to install must be given.");
    }
    if (target !== undefined && target !== "portable" && target !== "node") {
        throw new ValidationError(`'${target}' is not a build that can be installed.`);
    }

    const artifact = await resolveScriptModule(parsePackageSpec(spec, target as ModuleTarget));
    return summarize(getSql().transactional(() => storeScriptModule(artifact)));
}

function remove(req: Request<{ noteId: string }>) {
    assertScriptingEnabled();

    const installed = findScriptModuleByNoteId(req.params.noteId);
    if (!installed) {
        throw new NotFoundError(`No script module '${req.params.noteId}' is installed.`);
    }

    deleteScriptModule(installed.spec);
    forgetScriptModule(installed.noteId);
}

function summarize(module: StoredScriptModule): ScriptModuleSummary {
    return {
        noteId: module.noteId,
        spec: formatPackageSpec(module.spec),
        name: bareSpecifier(module),
        target: module.spec.target,
        providerId: module.providerId,
        fileCount: module.files.length,
        size: module.size,
        dateModified: module.dateModified
    };
}

/** What a script names in `require()`: the package and the path inside it, without the version. */
function bareSpecifier(module: StoredScriptModule): string {
    return `${module.spec.name}${module.spec.subpath ?? ""}`;
}

export default {
    list,
    types,
    search,
    install,
    remove
};
