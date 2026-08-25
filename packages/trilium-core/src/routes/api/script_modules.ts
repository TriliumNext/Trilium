import type { ScriptModuleSummary } from "@triliumnext/commons";
import type { Request } from "express";

import { NotFoundError, ValidationError } from "../../errors.js";
import { parsePackageSpec, resolveScriptModule } from "../../services/script_modules/provider.js";
import {
    deleteScriptModule,
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
 * Fetches a package through the first provider that can build it and stores it, replacing any
 * build of the same version already there.
 *
 * The fetch is the slow part and must not hold a transaction open, so only the write is wrapped in
 * one — a package that arrives whole is stored whole, or not at all.
 */
async function install(req: Request) {
    assertScriptingEnabled();

    const spec = (req.body ?? {}).spec;
    if (typeof spec !== "string") {
        throw new ValidationError("A package to install must be given.");
    }

    const artifact = await resolveScriptModule(parsePackageSpec(spec));
    return summarize(getSql().transactional(() => storeScriptModule(artifact)));
}

function remove(req: Request<{ noteId: string }>) {
    assertScriptingEnabled();

    const installed = listScriptModules().find((module) => module.noteId === req.params.noteId);
    if (!installed) {
        throw new NotFoundError(`No script module '${req.params.noteId}' is installed.`);
    }

    deleteScriptModule(installed.spec);
}

function summarize(module: StoredScriptModule): ScriptModuleSummary {
    return {
        noteId: module.noteId,
        spec: formatPackageSpec(module.spec),
        providerId: module.providerId,
        fileCount: module.files.length,
        size: module.size,
        dateModified: module.dateModified
    };
}

export default {
    list,
    install,
    remove
};
