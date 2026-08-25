import type { ScriptModuleSearchResult, ScriptModuleSummary } from "@triliumnext/commons";
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
    type StoredScriptModule,
    storeScriptModule
} from "../../services/script_modules/storage.js";
import { assertScriptingEnabled } from "../../services/scripting_guard.js";
import { getSql } from "../../services/sql/index.js";

function list(): ScriptModuleSummary[] {
    return listScriptModules().map(summarize);
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
        name: `${module.spec.name}${module.spec.subpath ?? ""}`,
        target: module.spec.target,
        providerId: module.providerId,
        fileCount: module.files.length,
        size: module.size,
        dateModified: module.dateModified
    };
}

export default {
    list,
    search,
    install,
    remove
};
