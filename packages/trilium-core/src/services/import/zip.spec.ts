import { beforeAll, describe, expect, it, vi } from "vitest";
import ExcelJS from "exceljs";
import { ZipArchive } from "archiver";
import { strToU8, zipSync } from "fflate";
import fs from "fs";
import { fileURLToPath } from "url";
import { dirname } from "path";
import { PassThrough } from "stream";
import zip, { removeTriliumTags } from "./zip.js";
import becca from "../../becca/becca.js";
import BNote from "../../becca/entities/bnote.js";
import noteService from "../notes.js";
import TaskContext from "../task_context.js";
import sql_init from "../sql_init.js";
import { isLocalPreviewImageSrc, trimIndentation } from "@triliumnext/commons";
import { getContext } from "../context.js";
const scriptDir = dirname(fileURLToPath(import.meta.url));

async function testImport(fileName: string) {
    const buffer = fs.readFileSync(`${scriptDir}/samples/${fileName}`);
    return testImportBuffer(buffer);
}

async function testImportBuffer(buffer: Buffer, taskId = "import-mdx", taskData: Record<string, unknown> = { textImportedAsText: true }, opts?: { restoreAsRoot?: boolean; preserveIds?: boolean }) {
    const taskContext = TaskContext.getInstance(taskId, "importNotes", taskData);

    // `init` returns the callback's promise, so a failing import rejects here rather than hanging.
    return getContext().init(async () => {
        const rootNote = becca.getNoteOrThrow("root");
        const importedNote = await zip.importZip(taskContext, buffer, rootNote, opts);

        return { importedNote, rootNote };
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

beforeAll(async () => {
    sql_init.initializeDb();
    await sql_init.dbReady;
});

describe("processNoteContent", () => {
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

    it("points the pictures of an imported mind map at the attachments as they were recreated", async () => {
        // The map carries the address each picture was served from where it was exported, and every
        // attachment is given a new id on the way in — so without rewriting, the pictures of an
        // imported map would point at attachments of the instance it left.
        const metaFile = {
            formatVersion: 2,
            appVersion: "0.0.0",
            files: [{
                noteId: "mindMapNote1",
                title: "Mind Map",
                type: "mindMap",
                mime: "application/json",
                dataFileName: "Mind Map.json",
                attachments: [{
                    attachmentId: "mapPicture1",
                    title: "photo.png",
                    role: "image",
                    mime: "image/png",
                    position: 10,
                    dataFileName: "Mind Map_photo.png"
                }]
            }]
        };
        const mapData = {
            nodeData: {
                id: "root",
                topic: "Root",
                image: { url: "api/attachments/mapPicture1/image/photo.png", width: 240, height: 180 }
            }
        };

        const zipBuffer = await createZipBuffer({
            "!!!meta.json": JSON.stringify(metaFile),
            "Mind Map.json": JSON.stringify(mapData),
            "Mind Map_photo.png": Buffer.from("fake image data")
        });

        const { importedNote } = await testImportBuffer(zipBuffer);
        const [ picture ] = importedNote.getAttachmentsByRole("image");
        const content = importedNote.getContent() as string;

        expect(picture.attachmentId).not.toBe("mapPicture1");
        expect(content).toContain(`api/attachments/${picture.attachmentId}/image/photo.png`);
        expect(content).not.toContain("mapPicture1");
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

    it("keeps a folder zip's entries in archive order under an inherited #newNotesOnTop (no position metadata)", async () => {
        // A plain folder zip carries no !!!meta.json, so its notes have no stored positions and fall back to
        // getNewNotePosition. With #newNotesOnTop inherited onto the target that default would reverse them
        // (each note inserted above the last); the import must preserve the archive order instead.
        const zipBuffer = await createZipBuffer({ "a.txt": "first", "b.txt": "second", "c.txt": "third" });

        const orderedTitles = await new Promise<(string | undefined)[]>((resolve, reject) => {
            void getContext().init(async () => {
                try {
                    const parent = noteService.createNewNote({ parentNoteId: "root", title: "zip-order target", content: "", type: "text", mime: "text/html" }).note;
                    parent.addLabel("newNotesOnTop", "", true);

                    const taskContext = TaskContext.getInstance("import-zip-order", "importNotes", { textImportedAsText: true });
                    await zip.importZip(taskContext, zipBuffer, parent);

                    // Sort by notePosition the way the tree renders it (becca's `children` is insertion order).
                    const titles = parent
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

        expect(orderedTitles).toEqual(["a.txt", "b.txt", "c.txt"]);
    });

    it("imports a CSV entry as a plain file note when the spreadsheet option is off", async () => {
        const zipBuffer = await createZipBuffer({ "csv_as_file_sample.csv": "a,b\r\n1,2" });
        const { rootNote } = await testImportBuffer(zipBuffer, "import-csv-off", { spreadsheetImportedAsSpreadsheet: false });

        const note = rootNote.getChildNotes().find((n) => n.title === "csv_as_file_sample");
        expect(note?.type).toBe("file");
        expect(note?.mime).toBe("text/csv");
    });

    it("skips macOS resource-fork entries and reports an archive that holds nothing else", async () => {
        // A zip zipped on macOS carries a __MACOSX/ sidecar for every real entry. With nothing but
        // those, no note is ever created and the import has no root to hand back.
        const zipBuffer = await createZipBuffer({
            "__MACOSX/._a.txt": "resource fork",
            "__MACOSX": "dir marker"
        });

        await expect(testImportBuffer(zipBuffer, "import-macosx-only")).rejects.toThrow("Unable to determine first note.");
    });

    it("normalizes backslash separators and strips a leading slash", async () => {
        // A zip written on Windows can use backslashes, and a rooted name would otherwise be read as
        // an extra empty path segment. archiver rewrites both, so the raw names are built with fflate.
        const zipBuffer = Buffer.from(zipSync({
            "\\Windows Dir\\entry.txt": strToU8("windows content"),
            "/rooted.txt": strToU8("rooted content")
        }));

        const { rootNote } = await testImportBuffer(zipBuffer, "import-raw-entry-names");

        const dirNote = rootNote.getChildNotes().find((n) => n.title === "Windows Dir");
        expect(dirNote?.getChildNotes().map((n) => n.title)).toEqual(["entry.txt"]);
        expect(rootNote.getChildNotes().map((n) => n.title)).toContain("rooted.txt");
    });

    it("flushes a batch once the entry count reaches the cap", async () => {
        // Notes are written in batches of 200 inside one transaction; an archive larger than the cap
        // must flush mid-stream rather than buffering the whole thing.
        const files: Record<string, string> = {};
        for (let i = 0; i < 205; i++) {
            files[`batched/note-${String(i).padStart(3, "0")}.txt`] = `body ${i}`;
        }
        const zipBuffer = await createZipBuffer(files);

        const { rootNote } = await testImportBuffer(zipBuffer, "import-batched");
        const batchDir = rootNote.getChildNotes().find((n) => n.title === "batched");

        expect(batchDir?.getChildNotes()).toHaveLength(205);
    });

    it("treats a data file and a same-named directory as one note", async () => {
        // "Programming.html" and the "Programming" folder that holds its children describe the same
        // note; the directory is created first (out-of-order entry) and the data file must land on it
        // rather than spawning a duplicate.
        const zipBuffer = await createZipBuffer({
            "Programming/Child.txt": "child",
            "Programming.html": "<p>parent body</p>"
        });
        const { rootNote } = await testImportBuffer(zipBuffer, "import-dir-and-file");

        const matches = rootNote.getChildNotes().filter((n) => n.title === "Programming");
        expect(matches).toHaveLength(1);
        expect(matches[0]?.getContent().toString()).toContain("parent body");
        expect(matches[0]?.getChildNotes().map((n) => n.title)).toEqual(["Child.txt"]);
    });

    it("preserves note and attachment ids when asked to", async () => {
        const metaFile = {
            formatVersion: 2,
            appVersion: "0.0.0",
            files: [{
                noteId: "keptNoteId01",
                title: "Kept",
                type: "text",
                mime: "text/html",
                format: "html",
                dataFileName: "Kept.html",
                attributes: [],
                attachments: [{
                    attachmentId: "keptAttach01",
                    title: "data.txt",
                    role: "file",
                    mime: "text/plain",
                    position: 10,
                    dataFileName: "Kept_data.txt"
                }]
            }]
        };

        const zipBuffer = await createZipBuffer({
            "!!!meta.json": JSON.stringify(metaFile),
            "Kept.html": "<p>kept</p>",
            "Kept_data.txt": "attachment body"
        });

        const { importedNote } = await testImportBuffer(zipBuffer, "import-preserve-ids", { textImportedAsText: true }, { preserveIds: true });

        expect(importedNote.noteId).toBe("keptNoteId01");
        expect(importedNote.getAttachments().map((a) => a.attachmentId)).toEqual(["keptAttach01"]);
    });

    it("substitutes placeholder ids for blank note and attachment ids", async () => {
        // A malformed archive can carry empty ids; they're funnelled onto fixed placeholders rather
        // than being allowed to collide with a generated id.
        const metaFile = {
            formatVersion: 2,
            appVersion: "0.0.0",
            files: [{
                noteId: "blankIdHost1",
                title: "Host",
                type: "text",
                mime: "text/html",
                format: "html",
                dataFileName: "Host.html",
                attributes: [{ type: "relation", name: "myRelation", value: "   " }],
                attachments: [{
                    attachmentId: " ",
                    title: "blank.txt",
                    role: "file",
                    mime: "text/plain",
                    position: 10,
                    dataFileName: "Host_blank.txt"
                }]
            }]
        };

        const zipBuffer = await createZipBuffer({
            "!!!meta.json": JSON.stringify(metaFile),
            "Host.html": "<p>host</p>",
            "Host_blank.txt": "blank"
        });

        const { importedNote } = await testImportBuffer(zipBuffer, "import-blank-ids");

        expect(importedNote.getAttachments().map((a) => a.attachmentId)).toEqual(["empty_attachment_id"]);
        // The relation's blank target maps to the placeholder, which matches no note, so the relation
        // is dropped rather than saved pointing at nothing.
        expect(importedNote.getOwnedAttributes().filter((a) => a.type === "relation")).toHaveLength(0);
    });

    it("re-parents a note that a malformed archive makes its own parent", async () => {
        // Both meta levels claim the same noteId, so the child's computed parent is itself. Left alone
        // that persists a self-referential branch which corrupts the tree.
        const metaFile = {
            formatVersion: 2,
            appVersion: "0.0.0",
            files: [{
                noteId: "selfParent01",
                title: "Self",
                type: "text",
                mime: "text/html",
                format: "html",
                dirFileName: "Self",
                attributes: [],
                attachments: [],
                children: [{
                    noteId: "selfParent01",
                    title: "Self Child",
                    type: "text",
                    mime: "text/html",
                    format: "html",
                    dataFileName: "Self.html",
                    attributes: [],
                    attachments: []
                }]
            }]
        };

        const zipBuffer = await createZipBuffer({
            "!!!meta.json": JSON.stringify(metaFile),
            "Self/Self.html": "<p>self</p>"
        });

        const { importedNote, rootNote } = await testImportBuffer(zipBuffer, "import-self-parent");

        expect(importedNote.getParentNotes().map((n) => n.noteId)).toEqual([rootNote.noteId]);
        expect(becca.getBranchFromChildAndParent(importedNote.noteId, importedNote.noteId)).toBeFalsy();
    });

    it("aborts when a folder's name collides with an already-imported data file", async () => {
        // "Doc.md" is imported as a note, which registers it under the extension-less path "Doc". A
        // folder that is *literally* named "Doc.md" then resolves to that same note, so the importer
        // finds an existing note where it expected to create a parent folder and gives up.
        // NOTE: this aborts the whole import rather than degrading gracefully.
        const zipBuffer = Buffer.from(zipSync({
            "Doc.md": strToU8("body"),
            "Doc.md/child.txt": strToU8("child")
        }));

        await expect(testImportBuffer(zipBuffer, "import-name-collision")).rejects.toThrow("Cannot find parentNoteId for 'Doc.md/child.txt'");
    });

    it("aborts when a nested folder sits under such a colliding name", async () => {
        // Same collision, one level deeper: the failure now surfaces while creating the intermediate
        // folder note instead of while saving the leaf.
        const zipBuffer = Buffer.from(zipSync({
            "Nested.md": strToU8("body"),
            "Nested.md/sub/child.txt": strToU8("child")
        }));

        await expect(testImportBuffer(zipBuffer, "import-name-collision-nested")).rejects.toThrow("Missing parent note ID.");
    });

    it("restores a cloned note whose clone entry precedes its primary", async () => {
        // An export writes a clone as a stub entry carrying the same noteId as the primary. When the
        // stub is read first, its branch materialises a type-less skeleton note in becca; the primary
        // entry that follows must fill that skeleton in rather than being treated as an existing note.
        const sharedChild = { noteId: "clonedNote01", title: "Shared", type: "text", mime: "text/html", format: "html", attributes: [], attachments: [] };
        const metaFile = {
            formatVersion: 2,
            appVersion: "0.0.0",
            files: [{
                noteId: "cloneFolderB1",
                title: "Folder B",
                type: "text",
                mime: "text/html",
                format: "html",
                dataFileName: "Folder B.html",
                dirFileName: "Folder B",
                attributes: [],
                attachments: [],
                children: [{ ...sharedChild, isClone: true, dataFileName: "Shared.clone.html" }]
            }, {
                noteId: "cloneFolderA1",
                title: "Folder A",
                type: "text",
                mime: "text/html",
                format: "html",
                dataFileName: "Folder A.html",
                dirFileName: "Folder A",
                attributes: [],
                attachments: [],
                children: [{ ...sharedChild, dataFileName: "Shared.html" }]
            }]
        };

        const zipBuffer = await createZipBuffer({
            "!!!meta.json": JSON.stringify(metaFile),
            "Folder B.html": "<p>folder b</p>",
            "Folder B/Shared.clone.html": "<p>this is a clone</p>",
            "Folder A.html": "<p>folder a</p>",
            "Folder A/Shared.html": "<p>the real body</p>"
        });

        const { rootNote } = await testImportBuffer(zipBuffer, "import-clone-before-primary");
        const folderA = rootNote.getChildNotes().find((n) => n.title === "Folder A");
        const folderB = rootNote.getChildNotes().find((n) => n.title === "Folder B");
        const shared = folderA?.getChildNotes().find((n) => n.title === "Shared");

        // One note, cloned into both folders, carrying the primary entry's content and type.
        expect(shared?.type).toBe("text");
        expect(shared?.getContent().toString()).toContain("the real body");
        expect(folderB?.getChildNotes().map((n) => n.noteId)).toEqual([shared?.noteId]);
        expect(shared?.getParentNotes().map((n) => n.title).sort()).toEqual(["Folder A", "Folder B"]);
    });

    it("rejects a meta entry that declares no MIME type", async () => {
        const metaFile = {
            formatVersion: 2,
            appVersion: "0.0.0",
            files: [{ noteId: "noMime01", title: "No Mime", type: "text", dataFileName: "No Mime.html", attributes: [], attachments: [] }]
        };
        const zipBuffer = await createZipBuffer({ "!!!meta.json": JSON.stringify(metaFile), "No Mime.html": "<p>x</p>" });

        await expect(testImportBuffer(zipBuffer, "import-no-mime")).rejects.toThrow("Unable to resolve mime type.");
    });

    it("maps legacy 0.57-era note types onto their current names", async () => {
        const legacyTypes = [
            { noteId: "legacyRelMap1", title: "Legacy Rel Map", type: "relation-map", dataFileName: "Legacy Rel Map.json", expected: "relationMap" },
            { noteId: "legacyNoteMap", title: "Legacy Note Map", type: "note-map", dataFileName: "Legacy Note Map.json", expected: "noteMap" },
            { noteId: "legacyWebView", title: "Legacy Web View", type: "web-view", dataFileName: "Legacy Web View.html", expected: "webView" }
        ];
        const metaFile = {
            formatVersion: 2,
            appVersion: "0.0.0",
            files: legacyTypes.map(({ noteId, title, type, dataFileName }) => ({
                noteId, title, type, dataFileName, mime: "application/json", attributes: [], attachments: []
            }))
        };

        const zipBuffer = await createZipBuffer({
            "!!!meta.json": JSON.stringify(metaFile),
            "Legacy Rel Map.json": "{}",
            "Legacy Note Map.json": "{}",
            "Legacy Web View.html": "<p>x</p>"
        });

        const { rootNote } = await testImportBuffer(zipBuffer, "import-legacy-types");

        for (const { title, expected } of legacyTypes) {
            expect(rootNote.getChildNotes().find((n) => n.title === title)?.type).toBe(expected);
        }
    });
}, 60_000);

describe("attribute handling on import", () => {
    it("rewrites promoted-attribute definitions and drops unrecognized types", async () => {
        const metaFile = {
            formatVersion: 2,
            appVersion: "0.0.0",
            files: [{
                noteId: "attrHost0001",
                title: "Attr Host",
                type: "text",
                mime: "text/html",
                format: "html",
                dataFileName: "Attr Host.html",
                attachments: [],
                attributes: [
                    { type: "label-definition", name: "priority", value: "promoted,single,text" },
                    { type: "relation-definition", name: "assignee", value: "promoted,single" },
                    { type: "nonsense", name: "bogus", value: "x" },
                    { type: "relation", name: "internalLink", value: "attrHost0001" }
                ]
            }]
        };
        const zipBuffer = await createZipBuffer({ "!!!meta.json": JSON.stringify(metaFile), "Attr Host.html": "<p>x</p>" });

        const { importedNote } = await testImportBuffer(zipBuffer, "import-attr-definitions");
        const names = importedNote.getOwnedAttributes().map((a) => a.name);

        // Definitions are stored as `label:`/`relation:` labels ...
        expect(names).toContain("label:priority");
        expect(names).toContain("relation:assignee");
        // ... an unknown attribute type is refused ...
        expect(names).not.toContain("bogus");
        // ... and auto-generated link relations are left for the link scanner to recreate.
        expect(names).not.toContain("internalLink");
    });

    it("disables dangerous attributes and sanitizes attribute text on safe import", async () => {
        const metaFile = {
            formatVersion: 2,
            appVersion: "0.0.0",
            files: [{
                noteId: "safeAttrHost1",
                title: "Safe Attr Host",
                type: "text",
                mime: "text/html",
                format: "html",
                dataFileName: "Safe Attr Host.html",
                attachments: [],
                attributes: [
                    { type: "label", name: "run", value: "frontendStartup" },
                    { type: "label", name: "harmless", value: `<img src=x onerror="alert(1)">` }
                ]
            }]
        };
        const zipBuffer = await createZipBuffer({ "!!!meta.json": JSON.stringify(metaFile), "Safe Attr Host.html": "<p>x</p>" });

        const { importedNote } = await testImportBuffer(zipBuffer, "import-attr-safe", { textImportedAsText: true, safeImport: true });

        // `#run` triggers script execution, so safe import neuters it by renaming rather than dropping it.
        expect(importedNote.getOwnedLabelValue("disabled:run")).toBe("frontendStartup");
        expect(importedNote.getOwnedLabelValue("run")).toBeNull();
        expect(importedNote.getOwnedLabelValue("harmless")).not.toContain("onerror");
    });
}, 60_000);

describe("link and image rewriting on import", () => {
    /** A Trilium export of one HTML note that owns an image attachment and links to a sibling note. */
    function linkedMetaFile() {
        return {
            formatVersion: 2,
            appVersion: "0.0.0",
            files: [{
                noteId: "linkHost00001",
                title: "Link Host",
                type: "text",
                mime: "text/html",
                format: "html",
                dataFileName: "Link Host.html",
                dirFileName: "Link Host",
                attributes: [],
                attachments: [{
                    attachmentId: "linkAttach001",
                    title: "photo.png",
                    role: "image",
                    mime: "image/png",
                    position: 10,
                    dataFileName: "Link Host_photo.png"
                }],
                children: [{
                    noteId: "linkSibling01",
                    title: "Sibling",
                    type: "text",
                    mime: "text/html",
                    format: "html",
                    dataFileName: "Sibling.html",
                    attributes: [],
                    attachments: []
                }]
            }]
        };
    }

    it("rewrites relative src/href targets and leaves inline, absolute and undecodable ones alone", async () => {
        // The export writes an attachment out as a sibling of its owner's data file, so a "./"-prefixed
        // reference from "Link Host.html" resolves to it.
        const body = [
            `<img src="data:image/png;base64,AAAA">`,
            `<img src="https://example.com/remote.png">`,
            `<img src="./Link Host_photo.png">`,
            `<img src="%E0%A4%A">`,
            `<a href="Link Host/Sibling.html">sibling</a>`,
            `<a href="Link Host/Sibling.html/deeper">past the end of the metadata</a>`,
            `<a href="Link Host_photo.png">the photo</a>`,
            `<a href="#root/somewhere">anchor</a>`,
            `<a href="https://example.com/">remote</a>`,
            `<a href="%E0%A4%A">broken</a>`
        ].join("");

        const zipBuffer = await createZipBuffer({
            "!!!meta.json": JSON.stringify(linkedMetaFile()),
            "Link Host.html": body,
            "Link Host_photo.png": Buffer.from("fake png"),
            "Link Host/Sibling.html": "<p>sibling</p>"
        });

        const { importedNote } = await testImportBuffer(zipBuffer, "import-link-rewrite");
        const content = importedNote.getContent().toString();
        const sibling = importedNote.getChildNotes().find((n) => n.title === "Sibling");
        const attachmentId = importedNote.getAttachments().find((a) => a.title === "photo.png")?.attachmentId;

        // The inline data URI is deliberately skipped by the link rewriter and left for the note
        // service, which lifts it into an attachment of its own - so the note ends up owning one more
        // attachment than the archive declared.
        expect(content).not.toContain("data:image");
        expect(importedNote.getAttachments()).toHaveLength(2);
        // Absolute URLs and anchors are passed through untouched ...
        expect(content).toContain(`src="https://example.com/remote.png"`);
        expect(content).toContain(`href="#root/somewhere"`);
        expect(content).toContain(`href="https://example.com/"`);
        // ... a "./"-prefixed image resolves onto the attachment ...
        expect(content).toContain(`src="api/attachments/${attachmentId}/image/`);
        // ... links resolve onto the note and the attachment view respectively ...
        expect(content).toContain(`href="#root/${sibling?.noteId}"`);
        expect(content).toContain(`href="#root/${importedNote.noteId}?viewMode=attachments&attachmentId=${attachmentId}"`);
        // ... and a URL that cannot be percent-decoded is kept verbatim instead of throwing.
        expect(content).toContain(`src="%E0%A4%A"`);
        expect(content).toContain(`href="%E0%A4%A"`);
        // A link that walks past the end of the metadata still yields a note path rather than blowing up.
        expect(content).toContain(`href="#root/`);
    });

    it("rewrites a link preview's picture references back onto the imported attachments", async () => {
        // The counterpart of the export's `data-image`/`data-favicon` rewrite. A preview keeps its two
        // pictures in those attributes rather than in an <img src>, and the render sinks accept only an
        // `api/attachments/…` URL (see `isLocalPreviewImageSrc`), so an archived relative filename left
        // as it stands renders as no picture at all — with both attachments sitting right there.
        const metaFile = {
            formatVersion: 2,
            appVersion: "0.0.0",
            files: [{
                noteId: "previewHost01",
                title: "Preview Host",
                type: "text",
                mime: "text/html",
                format: "html",
                dataFileName: "Preview Host.html",
                attributes: [],
                attachments: [{
                    attachmentId: "previewCover01",
                    title: "https://example.com/page",
                    role: "coverImage",
                    mime: "image/jpeg",
                    position: 10,
                    dataFileName: "Preview Host_cover.jpg"
                }, {
                    attachmentId: "previewIcon001",
                    title: "example.com",
                    role: "favicon",
                    mime: "image/png",
                    position: 20,
                    dataFileName: "Preview Host_example.com.png"
                }]
            }]
        };

        const zipBuffer = await createZipBuffer({
            "!!!meta.json": JSON.stringify(metaFile),
            "Preview Host.html": `<section class="link-embed" data-url="https://example.com/page"`
                + ` data-embed-type="opengraph" data-title="Example"`
                + ` data-image="Preview Host_cover.jpg"`
                + ` data-favicon="Preview Host_example.com.png"></section>`,
            "Preview Host_cover.jpg": Buffer.from("jpeg-bytes"),
            "Preview Host_example.com.png": Buffer.from("png-bytes")
        });

        const { importedNote } = await testImportBuffer(zipBuffer, "import-link-preview-pictures");
        const content = importedNote.getContent().toString();
        const idOf = (role: string) => importedNote.getAttachments().find((a) => a.role === role)?.attachmentId;

        // The attachment's title, encoded — not the archive file name. The owner note's title is
        // prefixed onto that, so with a space in it ("Preview Host_cover.jpg", and "New note_…" for
        // anyone who never renamed the note) the reference would be right and still render nothing:
        // the sink admits no whitespace.
        expect(content).toContain(`data-image="api/attachments/${idOf("coverImage")}/image/https%3A%2F%2Fexample.com%2Fpage"`);
        expect(content).toContain(`data-favicon="api/attachments/${idOf("favicon")}/image/example.com"`);

        for (const [, src] of content.matchAll(/data-(?:image|favicon)="([^"]*)"/g)) {
            expect(isLocalPreviewImageSrc(src), src).toBe(true);
        }
    });

    it("remaps an includeNoteLink target inside the note's own content", async () => {
        const metaFile = {
            formatVersion: 2,
            appVersion: "0.0.0",
            files: [{
                noteId: "includeHost01",
                title: "Include Host",
                type: "text",
                mime: "text/html",
                format: "html",
                dataFileName: "Include Host.html",
                attachments: [],
                attributes: [{ type: "relation", name: "includeNoteLink", value: "includeTarget1" }]
            }, {
                noteId: "includeTarget1",
                title: "Included",
                type: "text",
                mime: "text/html",
                format: "html",
                dataFileName: "Included.html",
                attributes: [],
                attachments: []
            }]
        };
        const zipBuffer = await createZipBuffer({
            "!!!meta.json": JSON.stringify(metaFile),
            "Include Host.html": `<section class="include-note" data-note-id="includeTarget1"></section>`,
            "Included.html": "<p>included body</p>"
        });

        const { rootNote } = await testImportBuffer(zipBuffer, "import-include-note-link");
        const host = rootNote.getChildNotes().find((n) => n.title === "Include Host");
        const included = rootNote.getChildNotes().find((n) => n.title === "Included");

        // The embedded reference follows the target to its freshly generated id.
        const content = host?.getContent().toString() ?? "";
        expect(content).not.toContain("includeTarget1");
        expect(content).toContain(included?.noteId ?? "MISSING");
    });

    it("resolves a root-relative image path against the archive's single top-level folder", async () => {
        // Every entry sits under one top-level folder, so that folder is the archive root and a
        // "/"-prefixed src is resolved against it rather than against the entry's own directory.
        const zipBuffer = await createZipBuffer({
            "Export/photo.png": Buffer.from("fake png"),
            "Export/Doc.html": `<img src="/photo.png">`
        });

        const { rootNote } = await testImportBuffer(zipBuffer, "import-root-relative-src");
        const exportNote = rootNote.getChildNotes().find((n) => n.title === "Export");
        const photo = exportNote?.getChildNotes().find((n) => n.title === "photo.png");
        const doc = exportNote?.getChildNotes().find((n) => n.title === "Doc");

        expect(doc?.getContent().toString()).toContain(`src="api/images/${photo?.noteId}/photo.png"`);
    });

    it("drops an H1 that repeats the note title and demotes any other H1 to H2", async () => {
        const metaFile = {
            formatVersion: 2,
            appVersion: "0.0.0",
            files: [{
                noteId: "h1Host000001",
                title: "H1 Host",
                type: "text",
                mime: "text/html",
                format: "html",
                dataFileName: "H1 Host.html",
                attributes: [],
                attachments: []
            }]
        };
        const zipBuffer = await createZipBuffer({
            "!!!meta.json": JSON.stringify(metaFile),
            "H1 Host.html": "<h1>H1 Host</h1><h1>Another heading</h1><p>body</p>"
        });

        const { importedNote } = await testImportBuffer(zipBuffer, "import-h1");
        const content = importedNote.getContent().toString();

        expect(content).not.toContain("<h1>");
        expect(content).toContain("<h2>Another heading</h2>");
    });

    it("remaps relation map links onto the newly generated note ids", async () => {
        const metaFile = {
            formatVersion: 2,
            appVersion: "0.0.0",
            files: [{
                noteId: "relMapHost001",
                title: "Rel Map",
                type: "relationMap",
                mime: "application/json",
                dataFileName: "Rel Map.json",
                attachments: [],
                attributes: [{ type: "relation", name: "relationMapLink", value: "relMapTarget1" }]
            }, {
                noteId: "relMapTarget1",
                title: "Target",
                type: "text",
                mime: "text/html",
                format: "html",
                dataFileName: "Target.html",
                attributes: [],
                attachments: []
            }]
        };
        const zipBuffer = await createZipBuffer({
            "!!!meta.json": JSON.stringify(metaFile),
            "Rel Map.json": JSON.stringify({ notes: [{ noteId: "relMapTarget1", x: 1 }] }),
            "Target.html": "<p>target</p>"
        });

        const { rootNote } = await testImportBuffer(zipBuffer, "import-relation-map");
        const relMap = rootNote.getChildNotes().find((n) => n.title === "Rel Map");
        const target = rootNote.getChildNotes().find((n) => n.title === "Target");

        expect(relMap?.type).toBe("relationMap");
        const content = relMap?.getContent().toString() ?? "";
        expect(content).not.toContain("relMapTarget1");
        expect(content).toContain(target?.noteId ?? "MISSING");
    });

    it("rewrites relative links in a Markdown code note and leaves absolute ones alone", async () => {
        const body = [
            `![att](Md Host_photo.png)`,
            `![note](Md Host/Sibling.md)`,
            `![remote](https://example.com/x.png)`,
            `![already](api/images/abc/x.png)`,
            `![broken](%E0%A4%A)`,
            `[att link](Md Host_photo.png)`,
            `[note link](Md Host/Sibling.md)`,
            `[remote link](https://example.com/)`,
            `[anchor](#section)`,
            `[already link](api/images/abc/x.png)`,
            `[broken link](%E0%A4%A)`
        ].join("\n\n");

        const metaFile = {
            formatVersion: 2,
            appVersion: "0.0.0",
            files: [{
                noteId: "mdHost000001",
                title: "Md Host",
                type: "code",
                mime: "text/x-markdown",
                dataFileName: "Md Host.md",
                dirFileName: "Md Host",
                attributes: [],
                attachments: [{
                    attachmentId: "mdAttach0001",
                    title: "photo.png",
                    role: "image",
                    mime: "image/png",
                    position: 10,
                    dataFileName: "Md Host_photo.png"
                }],
                children: [{
                    noteId: "mdSibling0001",
                    title: "Sibling",
                    type: "code",
                    mime: "text/x-markdown",
                    dataFileName: "Sibling.md",
                    attributes: [],
                    attachments: []
                }]
            }]
        };

        const zipBuffer = await createZipBuffer({
            "!!!meta.json": JSON.stringify(metaFile),
            "Md Host.md": body,
            "Md Host_photo.png": Buffer.from("fake png"),
            "Md Host/Sibling.md": "sibling body"
        });

        const { importedNote } = await testImportBuffer(zipBuffer, "import-md-links");
        const content = importedNote.getContent().toString();
        const sibling = importedNote.getChildNotes().find((n) => n.title === "Sibling");
        const attachmentId = importedNote.getAttachments()[0]?.attachmentId;

        // Images: attachment target, note target, and the three that must survive untouched.
        expect(content).toContain(`![att](api/attachments/${attachmentId}/image/photo.png)`);
        expect(content).toContain(`![note](api/images/${sibling?.noteId}/Sibling.md)`);
        expect(content).toContain(`![remote](https://example.com/x.png)`);
        expect(content).toContain(`![already](api/images/abc/x.png)`);
        expect(content).toContain(`![broken](%E0%A4%A)`);
        // Non-image links get the note-path treatment instead.
        expect(content).toContain(`[att link](#root/${importedNote.noteId}?viewMode=attachments&attachmentId=${attachmentId})`);
        expect(content).toContain(`[note link](#root/${sibling?.noteId})`);
        expect(content).toContain(`[remote link](https://example.com/)`);
        expect(content).toContain(`[anchor](#section)`);
        expect(content).toContain(`[already link](api/images/abc/x.png)`);
        expect(content).toContain(`[broken link](%E0%A4%A)`);
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
