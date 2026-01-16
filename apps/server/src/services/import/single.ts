import type { NoteType } from "@triliumnext/commons";

import type BNote from "../../becca/entities/bnote.js";
import imageService from "../../services/image.js";
import noteService from "../../services/notes.js";
import { getNoteTitle, processStringOrBuffer } from "../../services/utils.js";
import htmlSanitizer from "../html_sanitizer.js";
import protectedSessionService from "../protected_session.js";
import type TaskContext from "../task_context.js";
import type { File } from "./common.js";
import markdownService from "./markdown.js";
import mimeService from "./mime.js";
import importUtils from "./utils.js";

function importSingleFile(taskContext: TaskContext<"importNotes">, file: File, parentNote: BNote) {
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

    if (mime === "text/vnd.mermaid") {
        return importCustomType(taskContext, file, parentNote, "mermaid", mime);
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
        title: getNoteTitle(originalName, mime === "application/pdf"),
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
    let htmlContent = markdownService.renderToHtml(markdownContent, title);

    if (taskContext.data?.safeImport) {
        htmlContent = htmlSanitizer.sanitize(htmlContent);
    }

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

function importHtml(taskContext: TaskContext<"importNotes">, file: File, parentNote: BNote) {
    let content = processStringOrBuffer(file.buffer);

    // Try to get title from HTML first, fall back to filename
    // We do this before sanitization since that turns all <h1>s into <h2>
    const htmlTitle = importUtils.extractHtmlTitle(content);
    const title = htmlTitle || getNoteTitle(file.originalname, !!taskContext.data?.replaceUnderscoresWithSpaces);

    content = importUtils.handleH1(content, title);

    if (taskContext?.data?.safeImport) {
        content = htmlSanitizer.sanitize(content);
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
