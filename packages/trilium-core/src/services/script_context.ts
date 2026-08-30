import type BNote from "../becca/entities/bnote.js";
import BackendScriptApi from "./backend_script_api.js";
import type { ApiParams } from "./backend_script_api_interface.js";
import { requireHostModule } from "./script_modules/host_require.js";
import { requireScriptModule } from "./script_modules/loader.js";
import { toObject } from "./utils/index.js";

type Module = {
    exports: any[];
};

class ScriptContext {
    modules: Record<string, Module>;
    notes: {};
    apis: {};
    allNotes: BNote[];

    constructor(allNotes: BNote[], apiParams: ApiParams) {
        this.allNotes = allNotes;
        this.modules = {};
        this.notes = toObject(allNotes, (note) => [note.noteId, note]);
        this.apis = toObject(allNotes, (note) => [note.noteId, new BackendScriptApi(note, apiParams)]);
    }

    /**
     * Resolves a module for a script, in the order a script note declares one: a child note first,
     * then an installed package, then the host.
     *
     * A child note is already evaluated by the time the script runs, since the bundle inlines it.
     * An installed package is not: it is read and evaluated the first time this is asked for it,
     * so a database holding megabytes of packages costs a script nothing until it imports one.
     */
    require(moduleNoteIds: string[]) {
        return (moduleName: string) => {
            const candidates = this.allNotes.filter((n) => moduleNoteIds.includes(n.noteId));
            const note = candidates.find((c) => c.title === moduleName);

            if (note) {
                return this.modules[note.noteId].exports;
            }

            const installed = requireScriptModule(moduleName);
            if (installed) {
                return installed.exports;
            }

            return requireHostModule(moduleName);
        };
    }
}

export default ScriptContext;
