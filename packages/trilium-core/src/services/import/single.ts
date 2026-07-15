import type { NoteType } from "@triliumnext/commons";

import type BNote from "../../becca/entities/bnote.js";
import imageService from "../../services/image.js";
import noteService from "../../services/notes.js";
import protectedSessionService from "../protected_session.js";
import type TaskContext from "../task_context.js";
import type { File } from "./common.js";
import { extractFrontmatter } from "./frontmatter.js";
import markdownService from "./markdown.js";
import mimeService from "./mime.js";
import importUtils from "./utils.js";
import { getNoteTitle } from "../utils/index.js";
import { sanitizeHtml } from "../sanitizer.js";
import { processStringOrBuffer } from "../utils/binary.js";

// MIME of an `.xlsx` upload (Office Open XML spreadsheet), as resolved by `mime-types`.
const XLSX_MIME = "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
// MIME of a `.csv` upload, as resolved by `mime-types`.
const CSV_MIME = "text/csv";

async function importSingleFile(taskContext: TaskContext<"importNotes">, file: File, parentNote: BNote) {
    const mime = mimeService.getMime(file.originalname) || file.mimetype;

    if (taskContext?.data?.textImportedAsText) {
        if (mime === "text/html") {
            return importHtml(taskContext, file, parentNote);
        } else if (["text/markdown", "text/x-markdown", "text/mdx"].includes(mime)) {
            return importMarkdown(taskContext, file, parentNote);
        } else if (mime === "text/plain") {
            return importPlainText(taskContext, file, parentNote);
        }
    }

    // CSV/XLSX become editable spreadsheet notes unless the user opts out (then they fall through
    // to a plain file attachment), mirroring `textImportedAsText`/`codeImportedAsCode`.
    if (taskContext?.data?.spreadsheetImportedAsSpreadsheet) {
        if (mime === XLSX_MIME) {
            return importSpreadsheet(taskContext, file, parentNote);
        }

        if (mime === CSV_MIME) {
            return importSpreadsheetFromCsv(taskContext, file, parentNote);
        }
    }

    if (mime === "text/vnd.mermaid") {
        return importCustomType(taskContext, file, parentNote, "mermaid", mime);
    }

    // `.triliumsheet` is Trilium's native lossless spreadsheet format (see single-note export): the raw
    // Univer workbook JSON is re-imported verbatim, unlike `.xlsx`/`.csv` which are parsed into a workbook.
    if (mime === "text/x-spreadsheet") {
        return importCustomType(taskContext, file, parentNote, "spreadsheet", mime);
    }

    if (taskContext?.data?.codeImportedAsCode && mimeService.getType(taskContext.data, mime) === "code") {
        return importCodeNote(taskContext, file, parentNote);
    }

    if (mime.startsWith("image/")) {
        return importImage(file, parentNote, taskContext);
    }

    return importFile(taskContext, file, parentNote);
}

function importImage(file: File, parentNote: BNote, taskContext: TaskContext<"importNotes">) {
    if (typeof file.buffer === "string") {
        throw new Error("Invalid file content for image.");
    }
    const { note } = imageService.saveImage(parentNote.noteId, file.buffer, file.originalname, !!taskContext.data?.shrinkImages);

    taskContext.increaseProgressCount();

    return note;
}

function importFile(taskContext: TaskContext<"importNotes">, file: File, parentNote: BNote) {
    const originalName = file.originalname;

    const mime = mimeService.getMime(originalName) || file.mimetype;
    const { note } = noteService.createNewNote({
        parentNoteId: parentNote.noteId,
        title: getNoteTitle(originalName, mime === "application/pdf", { mime }),
        content: file.buffer,
        isProtected: parentNote.isProtected && protectedSessionService.isProtectedSessionAvailable(),
        type: "file",
        mime
    });

    note.addLabel("originalFileName", originalName);

    taskContext.increaseProgressCount();

    return note;
}

function importCodeNote(taskContext: TaskContext<"importNotes">, file: File, parentNote: BNote) {
    const title = getNoteTitle(file.originalname, !!taskContext.data?.replaceUnderscoresWithSpaces);
    const content = processStringOrBuffer(file.buffer);
    const detectedMime = mimeService.getMime(file.originalname) || file.mimetype;
    const mime = mimeService.normalizeMimeType(detectedMime);

    let type: NoteType = "code";
    if (file.originalname.endsWith(".excalidraw")) {
        type = "canvas";
    }

    const { note } = noteService.createNewNote({
        parentNoteId: parentNote.noteId,
        title,
        content,
        type,
        mime,
        isProtected: parentNote.isProtected && protectedSessionService.isProtectedSessionAvailable()
    });

    taskContext.increaseProgressCount();

    return note;
}

function importCustomType(taskContext: TaskContext<"importNotes">, file: File, parentNote: BNote, type: NoteType, mime: string) {
    const title = getNoteTitle(file.originalname, !!taskContext.data?.replaceUnderscoresWithSpaces);
    const content = processStringOrBuffer(file.buffer);

    const { note } = noteService.createNewNote({
        parentNoteId: parentNote.noteId,
        title,
        content,
        type,
        mime,
        isProtected: parentNote.isProtected && protectedSessionService.isProtectedSessionAvailable()
    });

    taskContext.increaseProgressCount();

    return note;
}

async function importSpreadsheet(taskContext: TaskContext<"importNotes">, file: File, parentNote: BNote) {
    // Dynamically import the exceljs-backed parser so exceljs only loads when an `.xlsx` is
    // actually imported, keeping it out of the core barrel (and the standalone/browser bundle).
    const { parseXlsxToWorkbook } = await import("@triliumnext/commons/src/lib/spreadsheet/parse_from_xlsx.js");
    const buffer = typeof file.buffer === "string" ? Buffer.from(file.buffer) : file.buffer;
    const workbook = await parseXlsxToWorkbook(buffer);

    return createSpreadsheetNote(taskContext, file, parentNote, JSON.stringify(workbook));
}

async function importSpreadsheetFromCsv(taskContext: TaskContext<"importNotes">, file: File, parentNote: BNote) {
    const csv = processStringOrBuffer(file.buffer);
    const { parseCsvToWorkbook } = await import("@triliumnext/commons/src/lib/spreadsheet/parse_from_csv.js");
    const workbook = parseCsvToWorkbook(csv);

    return createSpreadsheetNote(taskContext, file, parentNote, JSON.stringify(workbook));
}

function createSpreadsheetNote(taskContext: TaskContext<"importNotes">, file: File, parentNote: BNote, content: string) {
    const title = getNoteTitle(file.originalname, !!taskContext.data?.replaceUnderscoresWithSpaces);

    const { note } = noteService.createNewNote({
        parentNoteId: parentNote.noteId,
        title,
        content,
        type: "spreadsheet",
        mime: "text/x-spreadsheet",
        isProtected: parentNote.isProtected && protectedSessionService.isProtectedSessionAvailable()
    });

    note.addLabel("originalFileName", file.originalname);

    taskContext.increaseProgressCount();

    return note;
}

function importPlainText(taskContext: TaskContext<"importNotes">, file: File, parentNote: BNote) {
    const title = getNoteTitle(file.originalname, !!taskContext.data?.replaceUnderscoresWithSpaces);
    const plainTextContent = processStringOrBuffer(file.buffer);
    const htmlContent = convertTextToHtml(plainTextContent);

    const { note } = noteService.createNewNote({
        parentNoteId: parentNote.noteId,
        title,
        content: htmlContent,
        type: "text",
        mime: "text/html",
        isProtected: parentNote.isProtected && protectedSessionService.isProtectedSessionAvailable()
    });

    taskContext.increaseProgressCount();

    return note;
}

function convertTextToHtml(text: string) {
    // 1: Plain Text Search
    text = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

    // 2: Line Breaks
    text = text.replace(/\r\n?|\n/g, "<br>");

    // 3: Paragraphs
    text = text.replace(/<br>\s*<br>/g, "</p><p>");

    // 4: Wrap in Paragraph Tags
    text = `<p>${text}</p>`;

    return text;
}

function importMarkdown(taskContext: TaskContext<"importNotes">, file: File, parentNote: BNote) {
    const title = getNoteTitle(file.originalname, !!taskContext.data?.replaceUnderscoresWithSpaces);

    const markdownContent = processStringOrBuffer(file.buffer);
    // YAML front matter (Obsidian/Jekyll/Hugo/…) is lifted into labels and stripped before rendering.
    const { body, attributes } = extractFrontmatter(markdownContent);
    let htmlContent = markdownService.renderToHtml(body, title);

    if (taskContext.data?.safeImport) {
        htmlContent = sanitizeHtml(htmlContent);
    }

    const { note } = noteService.createNewNote({
        parentNoteId: parentNote.noteId,
        title,
        content: htmlContent,
        type: "text",
        mime: "text/html",
        isProtected: parentNote.isProtected && protectedSessionService.isProtectedSessionAvailable()
    });

    for (const attribute of attributes) {
        note.addLabel(attribute.name, attribute.value);
    }

    taskContext.increaseProgressCount();

    return note;
}

function importHtml(taskContext: TaskContext<"importNotes">, file: File, parentNote: BNote) {
    let content = processStringOrBuffer(file.buffer);

    // Try to get title from HTML first, fall back to filename
    // We do this before sanitization since that turns all <h1>s into <h2>
    const htmlTitle = importUtils.extractHtmlTitle(content);
    const title = htmlTitle || getNoteTitle(file.originalname, !!taskContext.data?.replaceUnderscoresWithSpaces);

    content = importUtils.handleH1(content, title);

    if (taskContext?.data?.safeImport) {
        content = sanitizeHtml(content);
    }

    const { note } = noteService.createNewNote({
        parentNoteId: parentNote.noteId,
        title,
        content,
        type: "text",
        mime: "text/html",
        isProtected: parentNote.isProtected && protectedSessionService.isProtectedSessionAvailable()
    });

    taskContext.increaseProgressCount();

    return note;
}

function importAttachment(taskContext: TaskContext<"importNotes">, file: File, parentNote: BNote) {
    const mime = mimeService.getMime(file.originalname) || file.mimetype;

    if (mime.startsWith("image/") && typeof file.buffer !== "string") {
        imageService.saveImageToAttachment(parentNote.noteId, file.buffer, file.originalname, taskContext.data?.shrinkImages);

        taskContext.increaseProgressCount();
    } else {
        parentNote.saveAttachment({
            title: file.originalname,
            content: file.buffer,
            role: "file",
            mime
        });

        taskContext.increaseProgressCount();
    }
}

export default {
    importSingleFile,
    importAttachment
};
