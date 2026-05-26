import type BNote from "../becca/entities/bnote.js";
import BackendScriptApi from "./backend_script_api.js";
import type { ApiParams } from "./backend_script_api_interface.js";
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

    require(moduleNoteIds: string[]) {
        return (moduleName: string) => {
            const candidates = this.allNotes.filter((note) => moduleNoteIds.includes(note.noteId));
            const note = candidates.find((c) => c.title === moduleName);

            if (!note) {
                return require(moduleName);
            }

            return this.modules[note.noteId].exports;
        };
    }
}

export default ScriptContext;
