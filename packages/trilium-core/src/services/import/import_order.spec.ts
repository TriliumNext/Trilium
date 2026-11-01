import { beforeAll, describe, expect, it } from "vitest";

import becca from "../../becca/becca.js";
import { getContext } from "../context.js";
import noteService from "../notes.js";
import sql_init from "../sql_init.js";
import TaskContext from "../task_context.js";
import type { File } from "./common.js";
import importFile, { type ImportOptions } from "./dispatch.js";

const options: ImportOptions = {
    safeImport: true,
    shrinkImages: false,
    textImportedAsText: true,
    codeImportedAsCode: true,
    spreadsheetImportedAsSpreadsheet: true,
    explodeArchives: true, // required so a `.enex` routes to the ENEX importer rather than being kept as a single file
    replaceUnderscoresWithSpaces: false
};

/** An ENEX export whose notes appear in a fixed document order; the importer creates them in that order. */
function orderedEnex(titles: string[]): string {
    const notes = titles
        .map(
            (title) => `  <note>
    <title>${title}</title>
    <created>20200101T000000Z</created>
    <content><![CDATA[<?xml version="1.0" encoding="UTF-8" standalone="no"?>
<!DOCTYPE en-note SYSTEM "http://xml.evernote.com/pub/enml2.dtd"><en-note><div>${title}</div></en-note>]]></content>
  </note>`
        )
        .join("\n");
    return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE en-export SYSTEM "http://xml.evernote.com/pub/evernote-export4.dtd">
<en-export export-date="20260101T000000Z" application="Evernote" version="11">
${notes}
</en-export>`;
}

describe("import ordering (via the import dispatcher)", () => {
    beforeAll(async () => {
        sql_init.initializeDb();
        await sql_init.dbReady;
    });

    // Regression guard for the whole import path — not one importer. A `#newNotesOnTop` label inherited onto
    // the import target (the user's own root, say) makes createNewNote insert each new note *above* the last,
    // which silently reverses every importer's output. ENEX stands in here for any importer that builds its
    // tree with plain createNewNote calls (enex, keep, obsidian, notion, anytype, opml, onenote); only the
    // generic zip importer is immune, because it restores explicit positions from the export metadata.
    it("preserves the imported note order even when #newNotesOnTop is inherited onto the target", async () => {
        const enex = orderedEnex(["Order Note A", "Order Note B", "Order Note C"]);

        const orderedTitles = await new Promise<(string | undefined)[]>((resolve, reject) => {
            void getContext().init(async () => {
                try {
                    // The label the user reported: inheritable on the import target, so every note the import
                    // creates below it (the ENEX root and its children) inherits it.
                    const parent = noteService.createNewNote({
                        parentNoteId: "root",
                        title: "import-order target",
                        content: "",
                        type: "text",
                        mime: "text/html"
                    }).note;
                    parent.addLabel("newNotesOnTop", "", true);

                    const taskContext = TaskContext.getInstance("import-order", "importNotes", options);
                    const file: File = { originalname: "Ordered.enex", mimetype: "application/enex+xml", buffer: Buffer.from(enex) };
                    const importRoot = await importFile(taskContext, file, parent, options);
                    if (!importRoot || Array.isArray(importRoot)) {
                        throw new Error("ENEX import did not return a root note");
                    }

                    // Order lives in notePosition (becca's in-memory `children` is insertion order); the tree
                    // sorts by it the way the client renders it. Without the fix each note lands above the last
                    // (positions -10, -20, -30 → C, B, A); the fix keeps the ENEX document order A, B, C.
                    const titles = becca
                        .getNoteOrThrow(importRoot.noteId)
                        .getChildBranches()
                        .slice()
                        .sort((a, b) => a.notePosition - b.notePosition)
                        .map((branch) => branch.getNote().title);
                    resolve(titles);
                } catch (e) {
                    reject(e);
                }
            });
        });

        expect(orderedTitles).toEqual(["Order Note A", "Order Note B", "Order Note C"]);
    });
});
