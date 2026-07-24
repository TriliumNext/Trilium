import fs from "fs";
import { dirname, join } from "path";
import { fileURLToPath } from "url";
import { beforeAll, describe, expect, it } from "vitest";

import becca from "../../../becca/becca.js";
import type BNote from "../../../becca/entities/bnote.js";
import { getContext } from "../../context.js";
import noteService from "../../notes.js";
import sql_init from "../../sql_init.js";
import TaskContext from "../../task_context.js";
import { decodeUtf8 } from "../../utils/binary.js";
import oneFileImporter from "./importer.js";

const dir = dirname(fileURLToPath(import.meta.url));

/** Runs the .one importer over the fixture and returns the created import-root note. */
async function importFixture(name: string): Promise<BNote> {
    const bytes = new Uint8Array(fs.readFileSync(join(dir, "fixtures", name)));
    const taskContext = TaskContext.getInstance("onefile-integration", "importNotes", {});

    return new Promise<BNote>((resolve, reject) => {
        void getContext().init(() => {
            try {
                const parent = noteService.createNewNote({ parentNoteId: "root", title: ".one parent", content: "", type: "text", mime: "text/html" }).note;
                resolve(oneFileImporter.importOneFile(taskContext, bytes, parent, name));
            } catch (e) {
                reject(e);
            }
        });
    });
}

describe("importOneFile (real DB)", () => {
    beforeAll(async () => {
        sql_init.initializeDb();
        await sql_init.dbReady;
    });

    it("builds a note per page under a section root, with body text as HTML", async () => {
        const root = await importFixture("onenote_desktop.one");

        // The root is named after the file (extension stripped).
        expect(root.title).toBe("onenote_desktop");

        const pages = root.getChildNotes();
        expect(pages).toHaveLength(3);
        expect(pages[0].title).toContain("Test");

        const firstContent = decodeUtf8(pages[0].getContent() ?? "");
        expect(firstContent).toContain("<p>This notebook should have three pages.</p>");
    });

    it("embeds an extracted image as an inline attachment on its page", async () => {
        const root = await importFixture("onenote_desktop.one");
        const pageWithImage = root.getChildNotes().find((note) => decodeUtf8(note.getContent() ?? "").includes("api/attachments/"));

        expect(pageWithImage).toBeTruthy();
        expect(pageWithImage?.getAttachmentsByRole("image").length).toBeGreaterThan(0);
    });
});
