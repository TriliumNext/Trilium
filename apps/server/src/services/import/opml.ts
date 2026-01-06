

import { sanitize } from "@triliumnext/core";
import xml2js from "xml2js";

import type BNote from "../../becca/entities/bnote.js";
import noteService from "../../services/notes.js";
import protectedSessionService from "../protected_session.js";
import type TaskContext from "../task_context.js";
const parseString = xml2js.parseString;

interface OpmlXml {
    opml: OpmlBody;
}

interface OpmlBody {
    $: {
        version: string;
    };
    body: OpmlOutline[];
}

interface OpmlOutline {
    $: {
        title: string;
        text: string;
        _note: string;
    };
    outline: OpmlOutline[];
}

async function importOpml(taskContext: TaskContext<"importNotes">, fileBuffer: string | Buffer, parentNote: BNote) {
    const xml = await new Promise<OpmlXml>((resolve, reject) => {
        parseString(fileBuffer, (err: any, result: OpmlXml) => {
            if (err) {
                reject(err);
            } else {
                resolve(result);
            }
        });
    });

    if (!["1.0", "1.1", "2.0"].includes(xml.opml.$.version)) {
        return [400, `Unsupported OPML version ${xml.opml.$.version}, 1.0, 1.1 or 2.0 expected instead.`];
    }

    const opmlVersion = parseInt(xml.opml.$.version);

    function importOutline(outline: OpmlOutline, parentNoteId: string) {
        let title, content;

        if (opmlVersion === 1) {
            title = outline.$.title;
            content = toHtml(outline.$.text);

            if (!title || !title.trim()) {
                // https://github.com/zadam/trilium/issues/1862
                title = outline.$.text;
                content = "";
            }
        } else if (opmlVersion === 2) {
            title = outline.$.text;
            content = outline.$._note; // _note is already HTML
        } else {
            throw new Error(`Unrecognized OPML version ${opmlVersion}`);
        }

        content = sanitize.sanitizeHtml(content || "");

        const { note } = noteService.createNewNote({
            parentNoteId,
            title,
            content,
            type: "text",
            isProtected: parentNote.isProtected && protectedSessionService.isProtectedSessionAvailable()
        });

        taskContext.increaseProgressCount();

        for (const childOutline of outline.outline || []) {
            importOutline(childOutline, note.noteId);
        }

        return note;
    }

    const outlines = xml.opml.body[0].outline || [];
    let returnNote: BNote | null = null;

    for (const outline of outlines) {
        const note = importOutline(outline, parentNote.noteId);

        // the first created note will be activated after import
        returnNote = returnNote || note;
    }

    return returnNote;
}

function toHtml(text: string) {
    if (!text) {
        return "";
    }

    return `<p>${text.replace(/(?:\r\n|\r|\n)/g, "</p><p>")}</p>`;
}

export default {
    importOpml
};
