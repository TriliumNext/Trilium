import { transform } from "sucrase";

import becca from "../becca/becca.js";
import type BNote from "../becca/entities/bnote.js";
import type { ApiParams } from "./backend_script_api_interface.js";
import cls from "./cls.js";
import log from "./log.js";
import ScriptContext from "./script_context.js";

export interface Bundle {
    note?: BNote;
    noteId?: string;
    script: string;
    html: string;
    allNotes?: BNote[];
    allNoteIds?: string[];
}

type ScriptParams = any[];

function executeNote(note: BNote, apiParams: ApiParams) {
    if (!note.isJavaScript() || note.getScriptEnv() !== "backend" || !note.isContentAvailable()) {
        log.info(`Cannot execute note ${note.noteId} "${note.title}", note must be of type "Code: JS backend"`);

        return;
    }

    const bundle = getScriptBundle(note, true, "backend");
    if (!bundle) {
        throw new Error("Unable to determine bundle.");
    }

    return executeBundle(bundle, apiParams);
}

function executeNoteNoException(note: BNote, apiParams: ApiParams) {
    try {
        executeNote(note, apiParams);
    } catch (e) {
        // just swallow, exception is logged already in executeNote
    }
}

export function executeBundle(bundle: Bundle, apiParams: ApiParams = {}) {
    if (!apiParams.startNote) {
        // this is the default case, the only exception is when we want to preserve frontend startNote
        apiParams.startNote = bundle.note;
    }

    const originalComponentId = cls.get("componentId");

    cls.set("componentId", "script");
    cls.set("bundleNoteId", bundle.note?.noteId);

    // last \r\n is necessary if the script contains line comment on its last line
    const script = `function() {\r
${bundle.script}\r
}`;
    const ctx = new ScriptContext(bundle.allNotes || [], apiParams);

    try {
        return execute(ctx, script);
    } catch (e: any) {
        log.error(`Execution of script "${bundle.note?.title}" (${bundle.note?.noteId}) failed with error: ${e.message}`);

        throw e;
    } finally {
        cls.set("componentId", originalComponentId);
    }
}

/**
 * THIS METHOD CAN'T BE ASYNC, OTHERWISE TRANSACTION WRAPPER WON'T BE EFFECTIVE AND WE WILL BE LOSING THE
 * ENTITY CHANGES IN CLS.
 *
 * This method preserves frontend startNode - that's why we start execution from currentNote and override
 * bundle's startNote.
 */
function executeScript(script: string, params: ScriptParams, startNoteId: string, currentNoteId: string, originEntityName: string, originEntityId: string) {
    const startNote = becca.getNote(startNoteId);
    const currentNote = becca.getNote(currentNoteId);
    const originEntity = becca.getEntity(originEntityName, originEntityId);

    if (!currentNote) {
        throw new Error("Cannot find note.");
    }

    // we're just executing an excerpt of the original frontend script in the backend context, so we must
    // override normal note's content, and it's mime type / script environment
    const overrideContent = `return (${script}\r\n)(${getParams(params)})`;

    const bundle = getScriptBundle(currentNote, true, "backend", [], overrideContent);
    if (!bundle) {
        throw new Error("Unable to determine script bundle.");
    }

    return executeBundle(bundle, { startNote, originEntity });
}

function execute(ctx: ScriptContext, script: string) {
    return function () {
        return eval(`const apiContext = this;\r\n(${script}\r\n)()`);
    }.call(ctx);
}

function getParams(params?: ScriptParams) {
    if (!params) {
        return params;
    }

    return params
        .map((p) => {
            if (typeof p === "string" && p.startsWith("!@#Function: ")) {
                return p.substr(13);
            }
            return JSON.stringify(p);
        })
        .join(",");
}

function getScriptBundleForFrontend(note: BNote, script?: string, params?: ScriptParams) {
    let overrideContent: string | null = null;

    if (script) {
        overrideContent = `return (${script}\r\n)(${getParams(params)})`;
    }

    const bundle = getScriptBundle(note, true, "frontend", [], overrideContent);

    if (!bundle) {
        return;
    }

    // for frontend, we return just noteIds because frontend needs to use its own entity instances
    bundle.noteId = bundle.note?.noteId;
    delete bundle.note;

    bundle.allNoteIds = bundle.allNotes?.map((note) => note.noteId);
    delete bundle.allNotes;

    return bundle;
}

export function getScriptBundle(note: BNote, root: boolean = true, scriptEnv: string | null = null, includedNoteIds: string[] = [], overrideContent: string | null = null): Bundle | undefined {
    if (!note.isContentAvailable()) {
        return;
    }

    if (!(note.isJavaScript() || note.isHtml() || note.isJsx())) {
        return;
    }

    if (!root && note.hasOwnedLabel("disableInclusion")) {
        return;
    }

    if (note.type !== "file" && !root && scriptEnv !== note.getScriptEnv()) {
        return;
    }

    const bundle: Bundle = {
        note,
        script: "",
        html: "",
        allNotes: [note]
    };

    if (includedNoteIds.includes(note.noteId)) {
        return bundle;
    }

    includedNoteIds.push(note.noteId);

    const modules: BNote[] = [];

    for (const child of note.getChildNotes()) {
        const childBundle = getScriptBundle(child, false, scriptEnv, includedNoteIds);

        if (childBundle) {
            if (childBundle.note) {
                modules.push(childBundle.note);
            }
            bundle.script += childBundle.script;
            bundle.html += childBundle.html;
            if (bundle.allNotes && childBundle.allNotes) {
                bundle.allNotes = bundle.allNotes.concat(childBundle.allNotes);
            }
        }
    }

    const moduleNoteIds = modules.map((mod) => mod.noteId);

    // only frontend scripts are async. Backend cannot be async because of transaction management.
    const isFrontend = scriptEnv === "frontend";

    if (note.isJsx() || note.isJavaScript()) {
        let scriptContent = note.getContent();

        if (note.isJsx()) {
            scriptContent = buildJsx(scriptContent).code;
        }

        bundle.script += `
apiContext.modules['${note.noteId}'] = { exports: {} };
${root ? "return " : ""}${isFrontend ? "await" : ""} ((${isFrontend ? "async" : ""} function(exports, module, require, api${modules.length > 0 ? ", " : ""}${modules.map((child) => sanitizeVariableName(child.title)).join(", ")}) {
try {
${overrideContent || scriptContent};
} catch (e) { throw new Error("Load of script note \\"${note.title}\\" (${note.noteId}) failed with: " + e.message); }
for (const exportKey in exports) module.exports[exportKey] = exports[exportKey];
return module.exports;
}).call({}, {}, apiContext.modules['${note.noteId}'], apiContext.require(${JSON.stringify(moduleNoteIds)}), apiContext.apis['${note.noteId}']${modules.length > 0 ? ", " : ""}${modules.map((mod) => `apiContext.modules['${mod.noteId}'].exports`).join(", ")}));
`;
    } else if (note.isHtml()) {
        bundle.html += note.getContent();
    }

    return bundle;
}

export function buildJsx(contentRaw: string | Buffer) {
    const content = Buffer.isBuffer(contentRaw) ? contentRaw.toString("utf-8") : contentRaw;
    const output = transform(content, {
        transforms: ["jsx", "imports"],
        jsxPragma: "api.preact.h",
        jsxFragmentPragma: "api.preact.Fragment",
        production: true
    });

    let code = output.code;

    // Rewrite ESM-like exports to `module.exports =`.
    code = code.replaceAll(
        /\bexports\s*\.\s*default\s*=\s*/g,
        'module.exports = '
    );

    // Rewrite ESM-like imports to Preact, to `const { foo } = api.preact`
    code = code.replaceAll(
        /(?:var|let|const)\s+(\w+)\s*=\s*require\(['"]trilium:preact['"]\);?/g,
        'const $1 = api.preact;'
    );

    // Rewrite ESM-like imports to internal API, to `const { foo } = api`
    code = code.replaceAll(
        /(?:var|let|const)\s+(\w+)\s*=\s*require\(['"]trilium:api['"]\);?/g,
        'const $1 = api;'
    );

    output.code = code;
    return output;
}

function sanitizeVariableName(str: string) {
    return str.replace(/[^a-z0-9_]/gim, "");
}

export default {
    executeNote,
    executeNoteNoException,
    executeScript,
    getScriptBundleForFrontend
};
