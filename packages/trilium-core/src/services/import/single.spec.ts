import { beforeAll, describe, expect, it, vi } from "vitest";
import ExcelJS from "exceljs";
import fs from "fs";
import { fileURLToPath } from "url";
import { dirname } from "path";
import becca from "../../becca/becca.js";
import BNote from "../../becca/entities/bnote.js";
import imageService from "../image.js";
import noteService from "../notes.js";
import protectedSessionService from "../protected_session.js";
import TaskContext from "../task_context.js";
import sql_init from "../sql_init.js";
import single from "./single.js";
import { encodeUtf8, stripBom } from "../utils/binary.js";
import { getContext } from "../context.js";
import { mapByNoteType } from "../export/single.js";
const scriptDir = dirname(fileURLToPath(import.meta.url));

/** A vector icon, as GitHub and many other sites serve — markup, so its content is a string. */
const TINY_SVG = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><path d="M0 0h16v16H0z"/></svg>`;

/** A 1x1 PNG. The bytes are asked what they are, so a placeholder buffer would rightly be refused. */
const PIXEL_PNG = Buffer.from(
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M8AAAMBAQDJ/pLvAAAAAElFTkSuQmCC",
    "base64"
);

async function testImport(fileName: string, mimetype: string, bufferOverride?: Buffer, extraOptions?: Record<string, unknown>) {
    const buffer = bufferOverride ?? fs.readFileSync(`${scriptDir}/samples/${fileName}`);
    // getInstance caches by task id, so a caller needing distinct options (e.g. safeImport) must
    // use a distinct id rather than reusing the shared "import-mdx" context.
    const taskContext = TaskContext.getInstance(extraOptions ? `import-${fileName}` : "import-mdx", "importNotes", {
        textImportedAsText: true,
        codeImportedAsCode: true,
        spreadsheetImportedAsSpreadsheet: true,
        ...extraOptions
    });

    return new Promise<{ buffer: Buffer; importedNote: BNote }>((resolve, reject) => {
        getContext().init(async () => {
            const rootNote = becca.getNote("root");
            if (!rootNote) {
                reject("Missing root note.");
                return;
            }

            const importedNote = await single.importSingleFile(
                taskContext,
                {
                    originalname: fileName,
                    mimetype,
                    buffer: buffer
                },
                rootNote as BNote
            );
            if (importedNote === null) {
                reject("Import failed.");
                return;
            }
            resolve({
                buffer,
                importedNote
            });
        });
    });
}

beforeAll(async () => {
    sql_init.initializeDb();
    await sql_init.dbReady;
});

describe("processNoteContent", () => {
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

    it("safe import preserves data-trilium-collapsed on list items", async () => {
        const html = `<ul><li data-trilium-collapsed="true">Parent<ul><li>Child</li></ul></li></ul>`;
        const { importedNote } = await testImport("collapsed-list.html", "text/html", Buffer.from(html), { safeImport: true });

        expect(importedNote.mime).toBe("text/html");
        // safeImport runs the content through the sanitizer; data-* attributes are whitelisted, so
        // the collapsed-state flag survives along with the nested item.
        const content = importedNote.getContent().toString();
        expect(content).toContain(`data-trilium-collapsed="true"`);
        expect(content).toContain("Child");
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

    it("imports YAML front matter as labels and strips it from a Markdown note", async () => {
        const md = "---\nfirst: First value\ntags:\n  - Tag\n  - AnotherTag\n---\nThe body.";
        const { importedNote } = await testImport("Frontmatter.md", "text/markdown", Buffer.from(md));
        expect(importedNote.getContent().toString()).toBe("<p>The body.</p>");
        expect(importedNote.getOwnedLabelValue("first")).toBe("First value");
        expect(importedNote.getOwnedLabelValues("tags")).toEqual(["Tag", "AnotherTag"]);
    });

    it("only creates labels from front matter — never relations (no script triggers)", async () => {
        const md = '---\n"~runOnNoteCreation": evil\ntemplate: x\n---\nBody.';
        const { importedNote } = await testImport("Safe.md", "text/markdown", Buffer.from(md));
        // Front matter applies via addLabel, so the only script-execution / template vector (a relation)
        // can never appear — even a key that looks like one lands as a harmless label.
        expect(importedNote.getOwnedAttributes().filter((a) => a.type === "relation")).toHaveLength(0);
        expect(importedNote.getOwnedAttributes().every((a) => a.type === "label")).toBe(true);
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

    it("imports a .triliumsheet file as a spreadsheet note, preserving content verbatim", async () => {
        // .triliumsheet is Trilium's lossless round-trip format: the raw Univer workbook JSON exported
        // by single-note export is re-imported byte-for-byte (unlike .xlsx, which is parsed/re-serialized).
        const workbookJson = JSON.stringify({ workbook: { id: "wb", sheetOrder: ["s1"], sheets: { s1: { cellData: {} } } } });

        const { importedNote } = await testImport("Budget.triliumsheet", "application/json", Buffer.from(workbookJson));

        expect(importedNote).toMatchObject({
            mime: "text/x-spreadsheet",
            type: "spreadsheet",
            title: "Budget"
        });
        expect(importedNote.getContent().toString()).toBe(workbookJson);
    });

    it("imports .xlsx as a spreadsheet note", async () => {
        const wb = new ExcelJS.Workbook();
        const ws = wb.addWorksheet("Sheet1");
        ws.getCell("A1").value = "Hello";
        ws.getCell("B1").value = 42;
        const xlsxBuffer = Buffer.from(await wb.xlsx.writeBuffer());

        const { importedNote } = await testImport(
            "Budget.xlsx",
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            xlsxBuffer
        );

        expect(importedNote).toMatchObject({
            mime: "text/x-spreadsheet",
            type: "spreadsheet",
            title: "Budget"
        });
        expect(importedNote.getLabelValue("originalFileName")).toBe("Budget.xlsx");

        // Content is the persisted Univer workbook with our imported values.
        const parsed = JSON.parse(importedNote.getContent().toString());
        const sheet = parsed.workbook.sheets[parsed.workbook.sheetOrder[0]];
        expect(sheet.cellData[0][0].v).toBe("Hello");
        expect(sheet.cellData[0][1].v).toBe(42);
    });

    it("imports .csv as a spreadsheet note", async () => {
        const { importedNote } = await testImport("Budget.csv", "text/csv", Buffer.from("a,b\r\n1,2"));

        expect(importedNote).toMatchObject({
            mime: "text/x-spreadsheet",
            type: "spreadsheet",
            title: "Budget"
        });
        expect(importedNote.getLabelValue("originalFileName")).toBe("Budget.csv");

        const parsed = JSON.parse(importedNote.getContent().toString());
        const sheet = parsed.workbook.sheets[parsed.workbook.sheetOrder[0]];
        expect(sheet.cellData[0][0].v).toBe("a");
        expect(sheet.cellData[1][1].v).toBe(2);
    });

    it("carries a link preview's pictures through a single-file export and back", async () => {
        // A single-file export has nowhere to put an attachment, so it inlines every picture as base64
        // — which is only half an answer unless the import unpacks them again. Left inline they cost a
        // third more than the bytes they encode, in every revision of the note, once per card.
        //
        // The favicon is deliberately an SVG: its content is markup rather than bytes, and the export
        // used to skip it on exactly that basis, writing out `api/attachments/<id>` instead. That is
        // not merely unresolvable elsewhere — the id is the source instance's, so the file names an
        // attachment belonging to somebody else's note.
        const { note: source } = getContext().init(() => noteService.createNewNote({
            parentNoteId: "root", title: "Preview Source", type: "text", content: ""
        }));
        getContext().init(() => {
            const favicon = source.saveAttachment({ role: "favicon", mime: "image/svg+xml", title: "example.com.svg", content: TINY_SVG });
            const cover = source.saveAttachment({ role: "coverImage", mime: "image/png", title: "example.com-page", content: PIXEL_PNG });
            source.setContent(`<section class="link-embed" data-url="https://example.com/page" data-embed-type="opengraph"`
                + ` data-favicon="api/attachments/${favicon.attachmentId}/image/example.com.svg"`
                + ` data-image="api/attachments/${cover.attachmentId}/image/example.com-page"></section>`);
        });

        const exported = String(mapByNoteType(source, source.getContent(), "html").payload);
        // Both pictures travel in the file itself, naming nothing back in this instance.
        expect(exported).toContain("data-favicon=\"data:image/svg+xml;base64,");
        expect(exported).toContain("data-image=\"data:image/png;base64,");
        expect(exported).not.toContain("api/attachments");

        const { importedNote } = await testImport("Preview Source.html", "text/html", Buffer.from(exported));

        // Back to attachments on the far side, roled and named as a preview made here would store them.
        expect(importedNote.getAttachments().map((a) => [a.role, a.title]).sort()).toStrictEqual([
            ["coverImage", expect.stringMatching(/^example\.com-page-[0-9a-f]{8}\.png$/)],
            ["favicon", "example.com.svg"]
        ]);

        const content = importedNote.getContent().toString();
        expect(content).not.toContain("base64");
        for (const attachment of importedNote.getAttachments()) {
            expect(content).toContain(`api/attachments/${attachment.attachmentId}/image/`);
        }
    });

    it("sanitizes rendered Markdown when safeImport is on", async () => {
        const md = `# Heading\n\n<img src=x onerror="alert(1)">`;
        const { importedNote } = await testImport("Unsafe.md", "text/markdown", Buffer.from(md), { safeImport: true });

        const content = importedNote.getContent().toString();
        expect(content).not.toContain("onerror");
        expect(content).toContain("Heading");
    });
}, 60_000);

describe("importSingleFile dispatch", () => {
    it("imports an unrecognized upload as a file note carrying its original filename", async () => {
        const { importedNote } = await testImport("payload.unknownext", "application/x-custom", Buffer.from([1, 2, 3]));

        // `.unknownext` has no mime-db entry, so getMime() returns false and the upload's own mimetype
        // wins; the extension isn't one importFile strips, so it stays in the title.
        expect(importedNote).toMatchObject({ type: "file", mime: "application/x-custom", title: "payload.unknownext" });
        expect(importedNote.getOwnedLabelValue("originalFileName")).toBe("payload.unknownext");
    });

    it("strips the extension and underscores from a PDF's title", async () => {
        // importFile passes `mime === "application/pdf"` as replaceUnderscoresWithSpaces, so only PDFs
        // get the underscore treatment.
        const { importedNote } = await testImport("My_Report.pdf", "application/pdf", Buffer.from("%PDF-1.4\n"));

        expect(importedNote).toMatchObject({ type: "file", mime: "application/pdf", title: "My Report" });
    });

    it("falls back to a plain file note when the matching 'import as' option is off", async () => {
        const csv = await testImport("Off.csv", "text/csv", Buffer.from("a,b\r\n1,2"), { spreadsheetImportedAsSpreadsheet: false });
        expect(csv.importedNote).toMatchObject({ type: "file", mime: "text/csv" });

        const code = await testImport("Off.py", "text/x-python", Buffer.from("print(1)"), { codeImportedAsCode: false });
        expect(code.importedNote).toMatchObject({ type: "file", mime: "text/x-python" });
    });

    it("falls back to the upload's own mimetype for a code note with an unrecognized extension", async () => {
        const { importedNote } = await testImport("script.unknownext", "text/x-python", Buffer.from("print(1)"));

        expect(importedNote).toMatchObject({ type: "code", mime: "text/x-python", title: "script.unknownext" });
    });

    it("imports HTML as a code note when textImportedAsText is off", async () => {
        // text/html is also a code MIME, so with the text option off it lands on the code branch
        // rather than dropping all the way through to a file note.
        const { importedNote } = await testImport("Raw.html", "text/html", Buffer.from("<p>hi</p>"), { textImportedAsText: false });

        expect(importedNote).toMatchObject({ type: "code", mime: "text/html" });
    });

    it("routes an image upload to the image service and returns the note it created", async () => {
        // saveImage kicks off fire-and-forget image processing that would outlive the test, so it is
        // stubbed here; single.ts only has to be shown handing the upload over with the right flags.
        const stubNote = { noteId: "stubImageNote" } as unknown as BNote;
        const saveImage = vi.spyOn(imageService, "saveImage").mockReturnValue({ note: stubNote } as never);
        const buffer = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

        try {
            const { importedNote } = await testImport("Photo.png", "image/png", buffer, { shrinkImages: true });

            expect(importedNote).toBe(stubNote);
            expect(saveImage).toHaveBeenCalledWith("root", buffer, "Photo.png", true);
        } finally {
            saveImage.mockRestore();
        }
    });

    it("rejects an image whose content arrived as a string", async () => {
        const taskContext = TaskContext.getInstance("import-image-string", "importNotes", {});
        const rootNote = becca.getNoteOrThrow("root");

        await expect(
            getContext().init(() =>
                single.importSingleFile(taskContext, { originalname: "Photo.png", mimetype: "image/png", buffer: "not-a-buffer" }, rootNote)
            )
        ).rejects.toThrow("Invalid file content for image.");
    });
}, 60_000);

describe("importAttachment", () => {
    it("routes an image to the image service and saves anything else as a file attachment", async () => {
        // As in the image import test, the async processing inside saveImageToAttachment is stubbed out.
        const saveImageToAttachment = vi.spyOn(imageService, "saveImageToAttachment").mockReturnValue(undefined as never);
        const taskContext = TaskContext.getInstance("import-attachment", "importNotes", { shrinkImages: true });
        const rootNote = becca.getNoteOrThrow("root");
        const imageBuffer = Buffer.from([0x89, 0x50, 0x4e, 0x47]);

        try {
            await getContext().init(async () => {
                single.importAttachment(taskContext, { originalname: "Shot.png", mimetype: "image/png", buffer: imageBuffer }, rootNote);
                single.importAttachment(taskContext, { originalname: "notes.unknownext", mimetype: "application/x-custom", buffer: Buffer.from("data") }, rootNote);
            });

            expect(saveImageToAttachment).toHaveBeenCalledWith("root", imageBuffer, "Shot.png", true);

            const attachment = rootNote.getAttachments().find((a) => a.title === "notes.unknownext");
            expect(attachment).toMatchObject({ mime: "application/x-custom", role: "file" });
        } finally {
            saveImageToAttachment.mockRestore();
        }
    });
}, 60_000);

describe("importing under a protected parent", () => {
    const PROTECTED_KEY = encodeUtf8("0123456789abcdef"); // exactly 16 bytes

    it("marks every import type protected when a protected session is available", async () => {
        // A child inherits protection only via `parentNote.isProtected && isProtectedSessionAvailable()`,
        // so the parent must be protected AND a data key present for the flag to propagate. Each import
        // type resolves that pair independently, hence the sweep across all of them.
        protectedSessionService.setDataKey(PROTECTED_KEY);
        try {
            const parent = await getContext().init(async () => {
                const { note } = noteService.createNewNote({
                    parentNoteId: "root",
                    title: "protected import target",
                    content: "",
                    type: "text",
                    mime: "text/html",
                    isProtected: true
                });
                return note;
            });
            expect(parent.isProtected).toBe(true);

            const taskContext = TaskContext.getInstance("import-protected", "importNotes", {
                textImportedAsText: true,
                codeImportedAsCode: true,
                spreadsheetImportedAsSpreadsheet: true
            });

            const uploads = [
                { originalname: "Prot.bin", mimetype: "application/x-custom", buffer: Buffer.from([1]) },
                { originalname: "Prot.py", mimetype: "text/x-python", buffer: Buffer.from("print(1)") },
                { originalname: "Prot.mermaid", mimetype: "text/vnd.mermaid", buffer: Buffer.from("flowchart TD\n A --> B") },
                { originalname: "Prot.csv", mimetype: "text/csv", buffer: Buffer.from("a,b\r\n1,2") },
                { originalname: "Prot.txt", mimetype: "text/plain", buffer: Buffer.from("plain") },
                { originalname: "Prot.md", mimetype: "text/markdown", buffer: Buffer.from("# md") },
                { originalname: "Prot.html", mimetype: "text/html", buffer: Buffer.from("<p>html</p>") }
            ];

            const imported = await getContext().init(async () => {
                const notes: BNote[] = [];
                for (const upload of uploads) {
                    notes.push(await single.importSingleFile(taskContext, upload, parent));
                }
                return notes;
            });

            expect(imported.map((note) => note.type)).toEqual(["file", "code", "mermaid", "spreadsheet", "text", "text", "text"]);
            expect(imported.every((note) => note.isProtected)).toBe(true);
        } finally {
            protectedSessionService.resetDataKey();
        }
    });
}, 60_000);
