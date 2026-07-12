import { beforeAll, describe, expect, it, vi } from "vitest";
import ExcelJS from "exceljs";
import { ZipArchive } from "archiver";
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

async function testImportBuffer(buffer: Buffer, taskId = "import-mdx", taskData: Record<string, unknown> = { textImportedAsText: true }, opts?: { restoreAsRoot?: boolean; preserveIds?: boolean }) {
    const taskContext = TaskContext.getInstance(taskId, "importNotes", taskData);

    return new Promise<{ importedNote: BNote; rootNote: BNote }>((resolve, reject) => {
        getContext().init(async () => {
            const rootNote = becca.getNote("root");
            if (!rootNote) {
                expect(rootNote).toBeTruthy();
                return;
            }

            const importedNote = await zip.importZip(taskContext, buffer, rootNote as BNote, opts);
            resolve({
                importedNote,
                rootNote
            });
        });
    });
}

async function createZipBuffer(files: Record<string, string | Buffer>): Promise<Buffer> {
    const archive = new ZipArchive();
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

    it("imports YAML front matter from a generic Markdown file in a ZIP as labels", async () => {
        const buffer = await createZipBuffer({
            "Note.md": "---\nfirst: First value\ntags:\n  - Tag\n  - AnotherTag\n---\nThe body."
        });
        const { importedNote } = await testImportBuffer(buffer, "import-frontmatter-zip");

        expect(importedNote.title).toBe("Note");
        expect(importedNote.getContent().toString()).toBe("<p>The body.</p>");
        expect(importedNote.getOwnedLabelValue("first")).toBe("First value");
        expect(importedNote.getOwnedLabelValues("tags")).toEqual(["Tag", "AnotherTag"]);
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

    it("sanitizes book note HTML content on safe import (GHSA-h7w4-cjfg-cvj8)", async () => {
        const metaFile = {
            formatVersion: 2,
            appVersion: "0.0.0",
            files: [{
                noteId: "bookXssNote1",
                title: "Book Payload",
                type: "book",
                mime: "text/html",
                dataFileName: "Book Payload.html",
                attributes: [],
                attachments: []
            }]
        };

        const payload = `<img src=x onerror="require('child_process').exec('calc')"><b>safe</b>`;
        const zipBuffer = await createZipBuffer({
            "!!!meta.json": JSON.stringify(metaFile),
            "Book Payload.html": payload
        });

        const { importedNote } = await testImportBuffer(zipBuffer, "import-book-safe", { textImportedAsText: true, safeImport: true });
        const content = importedNote.getContent() as string;

        expect(importedNote.type).toBe("book");
        expect(content).not.toContain("onerror");
        expect(content).not.toContain("child_process");
        // Benign markup survives sanitization.
        expect(content).toContain("safe");
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

    it("restores an embedded mermaid diagram as a note reference, not as a raw attachment", async () => {
        // The export points the <img> at the mermaid note's generated `mermaid-export.svg`.
        // On the way back in that has to resolve to `api/images/<noteId>` — which re-renders the
        // diagram and keeps the #imageLink to the mermaid note — rather than to the raw attachment,
        // which would freeze the live diagram into a static image owned by nobody.
        const metaFile = {
            formatVersion: 2,
            appVersion: "0.0.0",
            files: [{
                noteId: "mermaidHost1",
                title: "MermaidHost",
                type: "text",
                mime: "text/html",
                format: "html",
                dataFileName: "MermaidHost.html",
                dirFileName: "MermaidHost",
                attachments: [],
                children: [{
                    noteId: "mermaidDiag1",
                    title: "Diagram",
                    type: "mermaid",
                    mime: "text/mermaid",
                    dataFileName: "Diagram.txt",
                    attachments: [{
                        attachmentId: "mermSvg1",
                        title: "mermaid-export.svg",
                        role: "image",
                        mime: "image/svg+xml",
                        position: 10,
                        dataFileName: "Diagram_mermaid-export.svg"
                    }]
                }]
            }]
        };

        const zipBuffer = await createZipBuffer({
            "!!!meta.json": JSON.stringify(metaFile),
            "MermaidHost.html": `<p><img src="MermaidHost/Diagram_mermaid-export.svg"></p>`,
            "MermaidHost/Diagram.txt": "flowchart TD\n A --> B",
            "MermaidHost/Diagram_mermaid-export.svg": "<svg/>"
        });

        const { importedNote } = await testImportBuffer(zipBuffer);
        const diagram = importedNote.getChildNotes()[0];
        expect(diagram.type).toBe("mermaid");

        const content = importedNote.getContent() as string;
        expect(content).toContain(`src="api/images/${diagram.noteId}/`);
        expect(content).not.toContain("api/attachments/");
    });

    it("imports a CSV entry as an editable spreadsheet note", async () => {
        const zipBuffer = await createZipBuffer({ "csv_import_sample.csv": "a,b\r\n1,2" });
        const { rootNote } = await testImportBuffer(zipBuffer, "import-csv", { spreadsheetImportedAsSpreadsheet: true });

        const note = rootNote.getChildNotes().find((n) => n.title === "csv_import_sample");
        expect(note?.type).toBe("spreadsheet");
        expect(note?.mime).toBe("text/x-spreadsheet");

        const sheet = parseWorkbookSheet(note?.getContent());
        expect(sheet.cellData[0][0].v).toBe("a");
        expect(sheet.cellData[1][1].v).toBe(2);
    });

    it("imports an XLSX entry as an editable spreadsheet note", async () => {
        const wb = new ExcelJS.Workbook();
        const ws = wb.addWorksheet("Sheet1");
        ws.getCell("A1").value = "hello";
        ws.getCell("B1").value = 42;
        const xlsxBuffer = Buffer.from(await wb.xlsx.writeBuffer());

        const zipBuffer = await createZipBuffer({ "xlsx_import_sample.xlsx": xlsxBuffer });
        const { rootNote } = await testImportBuffer(zipBuffer, "import-xlsx", { spreadsheetImportedAsSpreadsheet: true });

        const note = rootNote.getChildNotes().find((n) => n.title === "xlsx_import_sample");
        expect(note?.type).toBe("spreadsheet");
        expect(note?.mime).toBe("text/x-spreadsheet");

        const sheet = parseWorkbookSheet(note?.getContent());
        expect(sheet.cellData[0][0].v).toBe("hello");
        expect(sheet.cellData[0][1].v).toBe(42);
    });

    it("each phase's running count lands exactly on its total (the bar reaches 100% in both phases)", async () => {
        // fresh task id -> a new TaskContext whose constructor increment happens before we spy
        const taskContext = TaskContext.getInstance("import-progress-total", "importNotes", { textImportedAsText: true });
        const setTotalSpy = vi.spyOn(taskContext, "setTotalCount");
        const increaseSpy = vi.spyOn(taskContext, "increaseProgressCount");
        const resetSpy = vi.spyOn(taskContext, "resetProgressCount");

        const zipBuffer = await createZipBuffer({
            "a.txt": "first",
            "b.txt": "second",
            "sub/c.txt": "third"
        });

        await new Promise<void>((resolve, reject) => {
            getContext().init(async () => {
                const rootNote = becca.getNote("root");
                if (!rootNote) {
                    reject(new Error("missing root note"));
                    return;
                }
                await zip.importZip(taskContext, zipBuffer, rootNote as BNote);
                resolve();
            });
        });

        // two labelled phases — extraction (archive entries) then processing (created notes) — each reset
        // to zero and given its own total, so each drives an independent 0→100% bar
        expect(setTotalSpy).toHaveBeenCalledTimes(2);
        expect(resetSpy).toHaveBeenCalledTimes(2);

        const extractionTotal = setTotalSpy.mock.calls[0]?.[0] ?? 0;
        const processingTotal = setTotalSpy.mock.calls[1]?.[0] ?? 0;
        // the constructor's first increment ran before the spy; every later increment belongs to one of the
        // two phases, so the captured increments equal the two phase totals combined — i.e. each phase counts
        // up to exactly its own total
        expect(increaseSpy.mock.calls.length).toBe(extractionTotal + processingTotal);
    });

    it("drives extraction and post-processing as two separate, labelled phases", async () => {
        const taskContext = TaskContext.getInstance("import-progress-phases", "importNotes", { textImportedAsText: true });
        const setTotalSpy = vi.spyOn(taskContext, "setTotalCount");
        const setPhaseSpy = vi.spyOn(taskContext, "setPhase");

        // Flat files at the root: 3 entries, each becomes a note, no folder notes, no meta file.
        const zipBuffer = await createZipBuffer({ "a.txt": "first", "b.txt": "second", "c.txt": "third" });

        await new Promise<void>((resolve, reject) => {
            getContext().init(async () => {
                const rootNote = becca.getNote("root");
                if (!rootNote) {
                    reject(new Error("missing root note"));
                    return;
                }
                await zip.importZip(taskContext, zipBuffer, rootNote as BNote);
                resolve();
            });
        });

        // extraction is announced first (counting archive entries), then processing (counting created notes)
        expect(setPhaseSpy.mock.calls.map((call) => call[0])).toEqual(["extracting", "processing"]);
        // 3 entries extracted, then the 3 created notes processed — the denominator deliberately switches
        // between phases rather than being summed into one inflated total
        expect(setTotalSpy.mock.calls.map((call) => call[0])).toEqual([3, 3]);
    });

    it("imports an exported root note as a regular note instead of corrupting the system root", async () => {
        // Exporting a root note that has its own content yields a meta entry with noteId "root" AND a
        // data file. The "root" id must be remapped on import (like any other note) so the archived root
        // lands as an ordinary note under the import target - rather than overwriting the destination's
        // real root note and creating a self-referential root->root branch that breaks loading.
        const metaFile = {
            formatVersion: 2,
            appVersion: "0.0.0",
            files: [{
                noteId: "root",
                title: "root",
                type: "text",
                mime: "text/html",
                format: "html",
                dataFileName: "root.html",
                dirFileName: "root",
                attributes: [],
                attachments: [],
                children: [{
                    noteId: "1giO9zlsdvT6",
                    title: "Hi",
                    type: "text",
                    mime: "text/html",
                    format: "html",
                    dataFileName: "Hi.html",
                    attributes: [],
                    attachments: []
                }]
            }]
        };

        const zipBuffer = await createZipBuffer({
            "!!!meta.json": JSON.stringify(metaFile),
            "root.html": "<p>archived root content</p>",
            "root/Hi.html": "<p>hi content</p>"
        });

        const { importedNote, rootNote } = await testImportBuffer(zipBuffer, "import-root-note");

        // The archived root becomes a fresh, ordinary note placed under the import target - not the system root.
        expect(importedNote.noteId).not.toBe("root");
        expect(importedNote.title).toBe("root");
        expect(importedNote.getContent().toString()).toContain("archived root content");
        expect(rootNote.getChildNotes().map((n) => n.noteId)).toContain(importedNote.noteId);

        // Its child came along under the new note.
        const hi = importedNote.getChildNotes().find((n) => n.title === "Hi");
        expect(hi?.getContent().toString()).toContain("hi content");

        // No corruption: the system root keeps its own content and gains no self-referential branch.
        expect(rootNote.getContent().toString()).not.toContain("archived root content");
        expect(becca.getBranchFromChildAndParent("root", "root")).toBeFalsy();
    });

    it("restoreAsRoot maps the archived root onto the destination root instead of wrapping it (demo-content shape)", async () => {
        // The demo archive (and a whole-database restore) is an export whose top note IS "root" with no
        // own content - just children. With restoreAsRoot those children must land directly under the
        // destination root, not inside a redundant "root" wrapper note (which produced "two root folders").
        const metaFile = {
            formatVersion: 2,
            appVersion: "0.0.0",
            files: [{
                noteId: "root",
                title: "root",
                type: "text",
                mime: "text/html",
                format: "html",
                dirFileName: "root",
                attributes: [],
                attachments: [],
                children: [
                    { noteId: "demoChildA", title: "Journal", type: "text", mime: "text/html", format: "html", dataFileName: "Journal.html", attributes: [], attachments: [] },
                    { noteId: "demoChildB", title: "Miscellaneous", type: "text", mime: "text/html", format: "html", dataFileName: "Miscellaneous.html", attributes: [], attachments: [] }
                ]
            }]
        };

        const zipBuffer = await createZipBuffer({
            "!!!meta.json": JSON.stringify(metaFile),
            "root/Journal.html": "<p>journal</p>",
            "root/Miscellaneous.html": "<p>misc</p>"
        });

        const { rootNote } = await testImportBuffer(zipBuffer, "import-restore-as-root", { textImportedAsText: true }, { restoreAsRoot: true });

        // The archived root's children are DIRECT children of the destination root - a "root" wrapper note
        // would interpose itself as their parent instead (the "two root folders" regression).
        const journal = rootNote.getChildNotes().find((n) => n.title === "Journal");
        const misc = rootNote.getChildNotes().find((n) => n.title === "Miscellaneous");
        expect(journal?.getParentNotes().map((n) => n.noteId)).toEqual(["root"]);
        expect(misc?.getParentNotes().map((n) => n.noteId)).toEqual(["root"]);
        // And no self-referential root branch.
        expect(becca.getBranchFromChildAndParent("root", "root")).toBeFalsy();
    });

    it("restoreAsRoot merges an archived root that has its own content into the destination root", async () => {
        const metaFile = {
            formatVersion: 2,
            appVersion: "0.0.0",
            files: [{
                noteId: "root",
                title: "root",
                type: "text",
                mime: "text/html",
                format: "html",
                dataFileName: "root.html",
                dirFileName: "root",
                attributes: [],
                attachments: [],
                children: [
                    { noteId: "restoreChild1", title: "Restored Child", type: "text", mime: "text/html", format: "html", dataFileName: "Restored Child.html", attributes: [], attachments: [] }
                ]
            }]
        };

        const zipBuffer = await createZipBuffer({
            "!!!meta.json": JSON.stringify(metaFile),
            "root.html": "<p>restored root content</p>",
            "root/Restored Child.html": "<p>child content</p>"
        });

        const { rootNote } = await testImportBuffer(zipBuffer, "import-restore-root-content", { textImportedAsText: true }, { restoreAsRoot: true });

        // The archived root's content is written onto the real root, and its child attaches directly to
        // root - no wrapper note, no self-referential branch.
        expect(rootNote.getContent().toString()).toContain("restored root content");
        const child = rootNote.getChildNotes().find((n) => n.title === "Restored Child");
        expect(child?.getParentNotes().map((n) => n.noteId)).toEqual(["root"]);
        expect(child?.getContent().toString()).toContain("child content");
        expect(becca.getBranchFromChildAndParent("root", "root")).toBeFalsy();
    });

    it("imports a CSV entry as a plain file note when the spreadsheet option is off", async () => {
        const zipBuffer = await createZipBuffer({ "csv_as_file_sample.csv": "a,b\r\n1,2" });
        const { rootNote } = await testImportBuffer(zipBuffer, "import-csv-off", { spreadsheetImportedAsSpreadsheet: false });

        const note = rootNote.getChildNotes().find((n) => n.title === "csv_as_file_sample");
        expect(note?.type).toBe("file");
        expect(note?.mime).toBe("text/csv");
    });
}, 60_000);

/** Parses a spreadsheet note's content and returns its single (first) sheet's data. */
function parseWorkbookSheet(content: string | Uint8Array | undefined) {
    expect(typeof content).toBe("string");
    const parsed = JSON.parse(content as string);
    const sheetId = parsed.workbook.sheetOrder[0];
    return parsed.workbook.sheets[sheetId];
}

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
