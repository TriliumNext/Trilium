import { beforeAll, describe, expect, it, vi } from "vitest";
import archiver from "archiver";
import fs from "fs";
import { fileURLToPath } from "url";
import { dirname } from "path";
import { PassThrough } from "stream";
import zip, { removeTriliumTags } from "./zip.js";
import becca from "../../becca/becca.js";
import BNote from "../../becca/entities/bnote.js";
import TaskContext from "../task_context.js";
import sql_init from "../sql_init.js";
import { trimIndentation } from "@triliumnext/commons";
import { getContext } from "../context.js";
const scriptDir = dirname(fileURLToPath(import.meta.url));

async function testImport(fileName: string) {
    const buffer = fs.readFileSync(`${scriptDir}/samples/${fileName}`);
    return testImportBuffer(buffer);
}

async function testImportBuffer(buffer: Buffer) {
    const taskContext = TaskContext.getInstance("import-mdx", "importNotes", {
        textImportedAsText: true
    });

    return new Promise<{ importedNote: BNote; rootNote: BNote }>((resolve, reject) => {
        getContext().init(async () => {
            const rootNote = becca.getNote("root");
            if (!rootNote) {
                expect(rootNote).toBeTruthy();
                return;
            }

            const importedNote = await zip.importZip(taskContext, buffer, rootNote as BNote);
            resolve({
                importedNote,
                rootNote
            });
        });
    });
}

async function createZipBuffer(files: Record<string, string | Buffer>): Promise<Buffer> {
    const archive = archiver("zip");
    const chunks: Buffer[] = [];
    const passthrough = new PassThrough();
    passthrough.on("data", (chunk: Buffer) => chunks.push(chunk));
    archive.pipe(passthrough);
    for (const [name, content] of Object.entries(files)) {
        archive.append(content, { name });
    }
    await archive.finalize();
    return Buffer.concat(chunks);
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

    it("can import ZIP with UTF-8 filenames without language encoding flag", async () => {
        const { importedNote } = await testImport("utf8-filename.zip");
        expect(importedNote.title).toBe("测试");
    });

    it("can import ZIP with GBK-encoded filenames (Chinese Windows)", async () => {
        const { rootNote } = await testImport("gbk-support.zip");
        const children = rootNote.getChildNotes().map((n) => n.title);
        expect(children).toContain("测试文件.txt");
        expect(children).toContain("中文目录");
        const dirNote = rootNote.getChildNotes().find((n) => n.title === "中文目录")!;
        expect(dirNote.getChildNotes().map((n) => n.title)).toContain("子文件.txt");
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

    it("rewrites relative attachment paths in markdown code notes on import", async () => {
        const metaFile = {
            formatVersion: 2,
            appVersion: "0.0.0",
            files: [{
                noteId: "mdCodeNote1",
                title: "Markdown Note",
                type: "code",
                mime: "text/x-markdown",
                dataFileName: "Markdown Note.md",
                attachments: [{
                    attachmentId: "imgAtt1",
                    title: "image.jpg",
                    role: "image",
                    mime: "image/jpeg",
                    position: 10,
                    dataFileName: "Markdown Note_image.jpg"
                }]
            }]
        };

        const zipBuffer = await createZipBuffer({
            "!!!meta.json": JSON.stringify(metaFile),
            "Markdown Note.md": "# Hello\n\n![photo](Markdown Note_image.jpg)",
            "Markdown Note_image.jpg": Buffer.from("fake image data")
        });

        const { importedNote } = await testImportBuffer(zipBuffer);
        const content = importedNote.getContent() as string;
        expect(content).toContain("![photo](api/attachments/");
        expect(content).toContain("/image/image.jpg)");
        expect(content).not.toContain("Markdown Note_image.jpg");
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
