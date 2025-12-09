import { beforeAll, describe, expect, it, vi } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";
import becca from "../../becca/becca.js";
import BNote from "../../becca/entities/bnote.js";
import TaskContext from "../task_context.js";
import cls from "../cls.js";
import sql_init from "../sql_init.js";
import single from "./single.js";
import stripBom from "strip-bom";
const scriptDir = dirname(fileURLToPath(import.meta.url));

async function testImport(fileName: string, mimetype: string) {
    const buffer = fs.readFileSync(path.join(scriptDir, "samples", fileName));
    const taskContext = TaskContext.getInstance("import-mdx", "importNotes", {
        textImportedAsText: true,
        codeImportedAsCode: true
    });

    return new Promise<{ buffer: Buffer; importedNote: BNote }>((resolve, reject) => {
        cls.init(async () => {
            const rootNote = becca.getNote("root");
            if (!rootNote) {
                reject("Missing root note.");
            }

            const importedNote = single.importSingleFile(
                taskContext,
                {
                    originalname: fileName,
                    mimetype,
                    buffer: buffer
                },
                rootNote as BNote
            );
            resolve({
                buffer,
                importedNote
            });
        });
    });
}

describe("processNoteContent", () => {
    beforeAll(async () => {
        // Prevent download of images.
        vi.mock("../image.js", () => {
            return {
                default: { saveImageToAttachment: () => {} }
            };
        });

        sql_init.initializeDb();
        await sql_init.dbReady;
    });

    it("treats single MDX as Markdown", async () => {
        const { importedNote } = await testImport("Text Note.mdx", "text/mdx");
        expect(importedNote.mime).toBe("text/html");
        expect(importedNote.type).toBe("text");
        expect(importedNote.title).toBe("Text Note");
    });

    it("supports HTML note with UTF-16 (w/ BOM) from Microsoft Outlook", async () => {
        const { importedNote } = await testImport("IREN Reports Q2 FY25 Results.htm", "text/html");
        expect(importedNote.mime).toBe("text/html");
        expect(importedNote.title).toBe("IREN Reports Q2 FY25 Results");
        expect(importedNote.getContent().toString().substring(0, 5)).toEqual("<html");
    });

    it("supports code note with UTF-16", async () => {
        const { importedNote, buffer } = await testImport("UTF-16LE Code Note.json", "application/json");
        expect(importedNote.mime).toBe("application/json");
        expect(importedNote.getContent().toString()).toStrictEqual(stripBom(buffer.toString("utf-16le")));
    });

    it("supports plain text note with UTF-16", async () => {
        const { importedNote } = await testImport("UTF-16LE Text Note.txt", "text/plain");
        expect(importedNote.mime).toBe("text/html");
        expect(importedNote.getContent().toString()).toBe("<p>Plain text goes here.<br></p>");
    });

    it("supports markdown note with UTF-16", async () => {
        const { importedNote } = await testImport("UTF-16LE Text Note.md", "text/markdown");
        expect(importedNote.mime).toBe("text/html");
        expect(importedNote.getContent().toString()).toBe("<h2>Hello world</h2><p>Plain text goes here.</p>");
    });

    it("supports excalidraw note", async () => {
        const { importedNote } = await testImport("New note.excalidraw", "application/json");
        expect(importedNote.mime).toBe("application/json");
        expect(importedNote.type).toBe("canvas");
        expect(importedNote.title).toBe("New note");
    });

    it("imports .mermaid as mermaid note", async () => {
        const { importedNote } = await testImport("New note.mermaid", "application/json");
        expect(importedNote).toMatchObject({
            mime: "text/vnd.mermaid",
            type: "mermaid",
            title: "New note"
        });
    });

    it("imports .mmd as mermaid note", async () => {
        const { importedNote } = await testImport("New note.mmd", "application/json");
        expect(importedNote).toMatchObject({
            mime: "text/vnd.mermaid",
            type: "mermaid",
            title: "New note"
        });
    });
}, 60_000);
