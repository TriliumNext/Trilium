import { toObject } from "./utils.js";
import BackendScriptApi from "./backend_script_api.js";
import type BNote from "../becca/entities/bnote.js";
import type { ApiParams } from "./backend_script_api_interface.js";

/**
 * IMPORTANT: This module allowlist/blocklist is a defense-in-depth measure only.
 * It is NOT a security sandbox. Scripts execute via eval() in the main Node.js
 * process and can bypass these restrictions through globalThis, process, etc.
 * The actual security boundary is the [Scripting] enabled=false config toggle,
 * which prevents script execution entirely.
 *
 * Modules that are safe for user scripts to require.
 * Note-based modules (resolved via note title matching) are handled separately
 * and always allowed regardless of this list.
 */
const ALLOWED_MODULES = new Set([
    // Safe utility libraries
    "dayjs",
    "marked",
    "turndown",
    "cheerio",
    "axios",
    "xml2js",
    "escape-html",
    "sanitize-html",
    "lodash",
]);

/**
 * Modules that are ALWAYS blocked even when scripting is enabled.
 * These provide OS-level access that makes RCE trivial.
 */
const BLOCKED_MODULES = new Set([
    "child_process",
    "cluster",
    "dgram",
    "dns",
    "fs",
    "fs/promises",
    "net",
    "os",
    "path",
    "process",
    "tls",
    "worker_threads",
    "v8",
    "vm",
]);

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
                // Check blocked list first
                if (BLOCKED_MODULES.has(moduleName)) {
                    throw new Error(
                        `Module '${moduleName}' is blocked for security. ` +
                        `Scripts cannot access OS-level modules like child_process, fs, net, os.`
                    );
                }

                // Allow if in whitelist
                if (ALLOWED_MODULES.has(moduleName)) {
                    return require(moduleName);
                }

                throw new Error(
                    `Module '${moduleName}' is not in the allowed modules list. ` +
                    `Contact your administrator to add it to the whitelist.`
                );
            }

            return this.modules[note.noteId].exports;
        };
    }
}

export default ScriptContext;
