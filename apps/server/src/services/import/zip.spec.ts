import { beforeAll, describe, expect, it, vi } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { dirname } from "path";
import zip, { removeTriliumTags } from "./zip.js";
import becca from "../../becca/becca.js";
import BNote from "../../becca/entities/bnote.js";
import TaskContext from "../task_context.js";
import cls from "../cls.js";
import sql_init from "../sql_init.js";
import { trimIndentation } from "@triliumnext/commons";
const scriptDir = dirname(fileURLToPath(import.meta.url));

async function testImport(fileName: string) {
    const mdxSample = fs.readFileSync(path.join(scriptDir, "samples", fileName));
    const taskContext = TaskContext.getInstance("import-mdx", "importNotes", {
        textImportedAsText: true
    });

    return new Promise<{ importedNote: BNote; rootNote: BNote }>((resolve, reject) => {
        cls.init(async () => {
            const rootNote = becca.getNote("root");
            if (!rootNote) {
                expect(rootNote).toBeTruthy();
                return;
            }

            const importedNote = await zip.importZip(taskContext, mdxSample, rootNote as BNote);
            resolve({
                importedNote,
                rootNote
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

    it("treats single MDX as Markdown in ZIP as text note", async () => {
        const { importedNote } = await testImport("mdx.zip");
        expect(importedNote.mime).toBe("text/mdx");
        expect(importedNote.type).toBe("text");
        expect(importedNote.title).toBe("Text Note");
    });

    it("can import email from Microsoft Outlook with UTF-16 with BOM", async () => {
        const { rootNote, importedNote } = await testImport("IREN.Reports.Q2.FY25.Results_files.zip");
        const htmlNote = rootNote.children.find((ch) => ch.title === "IREN Reports Q2 FY25 Results");
        expect(htmlNote?.getContent().toString().substring(0, 4)).toEqual("<div");
    });

    it("can import from Silverbullet", async () => {
        const { importedNote } = await testImport("silverbullet.zip");
        const bananaNote = getNoteByTitlePath(importedNote, "assets", "banana.jpeg");
        const mondayNote = getNoteByTitlePath(importedNote, "journal", "monday");
        const shopNote = getNoteByTitlePath(importedNote, "other", "shop");
        const content = mondayNote?.getContent();
        expect(content).toContain(`<a class="reference-link" href="#root/${shopNote.noteId}`);
        expect(content).toContain(`<img src="api/images/${bananaNote!.noteId}/banana.jpeg`);
    });

    it("can import old geomap notes", async () => {
        const { importedNote } = await testImport("geomap.zip");
        expect(importedNote.type).toBe("book");
        expect(importedNote.mime).toBe("");
        expect(importedNote.getRelationValue("template")).toBe("_template_geo_map");

        const attachment = importedNote.getAttachmentsByRole("viewConfig")[0];
        expect(attachment.title).toBe("geoMap.json");
        expect(attachment.mime).toBe("application/json");
        const content = attachment.getContent();
        expect(content).toStrictEqual(`{"view":{"center":{"lat":49.19598332223546,"lng":-2.1414576506668808},"zoom":12}}`);
    });
}, 60_000);

function getNoteByTitlePath(parentNote: BNote, ...titlePath: string[]) {
    let cursor = parentNote;
    for (const title of titlePath) {
        const childNote = cursor.getChildNotes().find(n => n.title === title);
        expect(childNote).toBeTruthy();
        cursor = childNote!;
    }

    return cursor;
}

describe("removeTriliumTags", () => {
    it("removes <h1> tags from HTML", () => {
        const output = removeTriliumTags(trimIndentation`\
            <h1 data-trilium-h1>21 - Thursday</h1>
            <p>Hello world</p>
        `);
        const expected = `\n<p>Hello world</p>\n`;
        expect(output).toEqual(expected);
    });

    it("removes <title> tags from HTML", () => {
        const output = removeTriliumTags(trimIndentation`\
            <title data-trilium-title>21 - Thursday</title>
            <p>Hello world</p>
        `);
        const expected = `\n<p>Hello world</p>\n`;
        expect(output).toEqual(expected);
    });

    it("removes ckeditor tags from HTML", () => {
        const output = removeTriliumTags(trimIndentation`\
            <body>
                <div class="content">
                    <h1 data-trilium-h1>21 - Thursday</h1>

                    <div class="ck-content">
                    <p>TODO:</p>
                    <ul class="todo-list">
                        <li>
                        <label class="todo-list__label">
                            <input type="checkbox" disabled="disabled"><span class="todo-list__label__description">&nbsp;&nbsp;</span>
                        </label>
                        </li>
                    </ul>
                    </div>
                </div>
            </body>
        `).split("\n").filter((l) => l.trim()).join("\n");
        const expected = trimIndentation`\
            <body>
                    <p>TODO:</p>
                    <ul class="todo-list">
                        <li>
                        <label class="todo-list__label">
                            <input type="checkbox" disabled="disabled"><span class="todo-list__label__description">&nbsp;&nbsp;</span>
                        </label>
                        </li>
                    </ul>
            </body>`;
        expect(output).toEqual(expected);
    });
});
