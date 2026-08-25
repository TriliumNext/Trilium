import type { FrontendScriptModule, UnavailableScriptModule } from "@triliumnext/commons";

import type { Entity } from "./frontend_script_api.js";
import froca from "./froca.js";
import { createScriptModuleRequire } from "./script_modules.js";
import utils from "./utils.js";

/** The packages a bundle brought with it, compiled and ready for the script that asked for them. */
export interface ScriptContextModules {
    scriptModules?: FrontendScriptModule[];
    unavailableModules?: UnavailableScriptModule[];
}

async function ScriptContext(
    startNoteId: string,
    allNoteIds: string[],
    originEntity: Entity | null = null,
    $container: JQuery<HTMLElement> | null = null,
    bundled: ScriptContextModules = {}
) {
    const modules: Record<string, { exports: unknown }> = {};
    const requireScriptModule = createScriptModuleRequire(
        bundled.scriptModules, bundled.unavailableModules);

    await froca.initializedPromise;

    const startNote = await froca.getNote(startNoteId);
    const allNotes = await froca.getNotes(allNoteIds);

    if (!startNote) {
        throw new Error(`Could not find start note ${startNoteId}.`);
    }

    const FrontendScriptApi = (await import("./frontend_script_api.js")).default;

    return {
        modules: modules,
        notes: utils.toObject(allNotes, (note) => [note.noteId, note]),
        apis: utils.toObject(allNotes, (note) => [note.noteId, new FrontendScriptApi(startNote, note, originEntity, $container)]),
        /**
         * Resolves a module for a script: a child note of it first, then a package installed into
         * Trilium. A child note is already evaluated, since the bundle inlines it; a package is
         * evaluated the first time this is asked for it.
         */
        require: (moduleNoteIds: string) => {
            return (moduleName: string) => {
                const candidates = allNotes.filter((note) => moduleNoteIds.includes(note.noteId));
                const note = candidates.find((c) => c.title === moduleName);

                if (note) {
                    return modules[note.noteId].exports;
                }

                const installed = requireScriptModule(moduleName);
                if (installed) {
                    return installed.exports;
                }

                throw new Error(
                    `Could not find module '${moduleName}'. Install it from Script modules on a ` +
                    `script note, or name a child note after it.`
                );
            };
        }
    };
}

export default ScriptContext;
