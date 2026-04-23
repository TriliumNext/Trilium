import fs from "fs";
import { default as path, dirname } from "path";
import { fileURLToPath } from "url";
import { beforeAll, describe, expect, it } from "vitest";

import becca from "../../becca/becca.js";
import type BNote from "../../becca/entities/bnote.js";
import cls from "../cls.js";
import sql_init from "../sql_init.js";
import TaskContext from "../task_context.js";
import enex from "./enex.js";

const scriptDir = dirname(fileURLToPath(import.meta.url));

async function testImport(fileName: string) {
    const sample = fs.readFileSync(path.join(scriptDir, "samples", fileName));
    const taskContext = TaskContext.getInstance("import-enex", "importNotes", {});

    return new Promise<{ importedNote: BNote; rootNote: BNote }>((resolve, reject) => {
        cls.init(async () => {
            const rootNote = becca.getNote("root");
            if (!rootNote) {
                expect(rootNote).toBeTruthy();
                return;
            }

            const importedNote = await enex.importEnex(taskContext, {
                originalname: fileName,
                mimetype: "application/enex+xml",
                buffer: sample
            }, rootNote as BNote);
            resolve({
                importedNote,
                rootNote
            });
        });
    });
}

describe("importEnex", () => {
    beforeAll(async () => {
        sql_init.initializeDb();
        await sql_init.dbReady;
    });

    it("imports non-image resources as attachments instead of child notes", async () => {
        const { importedNote } = await testImport("File with attachments.enex");

        // The root import note should contain the individual notes as children
        const test1 = importedNote.getChildNotes().find(n => n.title === "TEST1");
        expect(test1).toBeTruthy();

        // Non-image resources should be attachments, not child notes
        const childNotes = test1!.getChildNotes();
        expect(childNotes).toHaveLength(0);

        // Should have two file attachments
        const attachments = test1!.getAttachmentsByRole("file");
        expect(attachments).toHaveLength(2);

        const txt = attachments.find(a => a.title === "attachments1.txt");
        expect(txt).toBeTruthy();
        expect(txt!.mime).toBe("text/plain");
        expect(txt!.getContent().toString()).toBe("111");

        const bin = attachments.find(a => a.title === "attachments2");
        expect(bin).toBeTruthy();
        expect(bin!.mime).toBe("application/octet-stream");
        expect(bin!.getContent().toString()).toBe("222");

        // The note content should contain reference links to the attachments
        const content = test1!.getContent().toString();
        expect(content).toContain(`class="reference-link" href="#root/${test1!.noteId}?viewMode=attachments&amp;attachmentId=${txt!.attachmentId}"`);
        expect(content).toContain(`class="reference-link" href="#root/${test1!.noteId}?viewMode=attachments&amp;attachmentId=${bin!.attachmentId}"`);
    });

    it("imports notes without attachments normally", async () => {
        const { importedNote } = await testImport("File with attachments.enex");

        const test2 = importedNote.getChildNotes().find(n => n.title === "TEST2");
        expect(test2).toBeTruthy();
        expect(test2!.getChildNotes()).toHaveLength(0);
        expect(test2!.getAttachmentsByRole("file")).toHaveLength(0);

        const test3 = importedNote.getChildNotes().find(n => n.title === "TEST3");
        expect(test3).toBeTruthy();
        expect(test3!.getChildNotes()).toHaveLength(0);
        expect(test3!.getAttachmentsByRole("file")).toHaveLength(0);
    });
}, 60_000);
