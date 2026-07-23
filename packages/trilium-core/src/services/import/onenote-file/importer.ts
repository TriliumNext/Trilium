/**
 * Imports a OneNote desktop `.one` section file (or `.onetoc2`) directly, offline — no Microsoft Graph,
 * no account. The binary format is decoded by {@link ./one_parser.js} (a from-scratch TypeScript port of
 * the onenote-rs reference), and this service turns the extracted pages into a Trilium note tree.
 *
 * PROOF OF CONCEPT: extracts page hierarchy, titles, body text (in reading order) and embedded
 * images/files. Formatting, ink, tables, note tags, math and cross-page links are not yet handled — the
 * Graph-based importer (apps/server/src/services/import/onenote) remains the higher-fidelity path for
 * cloud-synced notebooks; this covers the offline `.one`-file case the Graph API cannot reach.
 *
 * Invoked from the shared file-import dispatcher (routes/api/import.ts) by the `.one`/`.onetoc2`
 * extension, so progress, completion and failure are reported by that dispatcher's TaskContext — this
 * service just builds the tree and returns its root note, like the zip/enex importers.
 */

import type BNote from "../../../becca/entities/bnote.js";
import imageService from "../../image.js";
import noteService from "../../notes.js";
import protectedSessionService from "../../protected_session.js";
import { sanitizeHtml } from "../../sanitizer.js";
import type TaskContext from "../../task_context.js";
import { escapeHtml } from "../../utils/index.js";
import { type OnePage, parseOneSection } from "./one_parser.js";

function importOneFile(taskContext: TaskContext<"importNotes">, fileBuffer: Uint8Array, importRootNote: BNote, fileName?: string): BNote {
    const section = parseOneSection(fileBuffer);

    const isProtected = importRootNote.isProtected && protectedSessionService.isProtectedSessionAvailable();
    const shrinkImages = !!taskContext.data?.shrinkImages;

    const rootNote = noteService.createNewNote({
        parentNoteId: importRootNote.noteId,
        title: deriveSectionTitle(fileName),
        content: "",
        type: "text",
        mime: "text/html",
        isProtected
    }).note;
    rootNote.addLabel("iconClass", "bx bx-import");

    taskContext.setTotalCount(section.pages.length);

    // OneNote subpages carry an indentation level (0 = top-level); reconstruct the nesting by parenting each
    // page under the most recent page one level shallower. Pages arrive in display order, so that parent
    // always exists by the time we reach a child.
    const lastNoteAtLevel: BNote[] = [];
    for (const page of section.pages) {
        const parent = page.level > 0 ? (lastNoteAtLevel[page.level - 1] ?? rootNote) : rootNote;
        const { note } = noteService.createNewNote({
            parentNoteId: parent.noteId,
            title: page.title,
            content: "",
            type: "text",
            mime: "text/html",
            isProtected
        });
        note.setContent(sanitizeHtml(buildPageHtml(note, page, shrinkImages)));

        lastNoteAtLevel[page.level] = note;
        lastNoteAtLevel.length = page.level + 1; // a shallower page ends any deeper nesting
        taskContext.increaseProgressCount();
    }

    return rootNote;
}

/** Names the import root after the section file (its title isn't reliably in the binary yet). */
function deriveSectionTitle(fileName: string | undefined): string {
    if (!fileName) {
        return "OneNote import";
    }
    return fileName.replace(/\.(one|onetoc2)$/i, "") || "OneNote import";
}

const IMAGE_EXTENSIONS = new Set([".png", ".jpg", ".jpeg", ".gif", ".bmp", ".webp", ".svg", ".tif", ".tiff", ".ico"]);

const MIME_BY_EXTENSION: Record<string, string> = {
    ".pdf": "application/pdf",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    ".txt": "text/plain",
    ".zip": "application/zip",
    ".mp3": "audio/mpeg",
    ".mp4": "video/mp4"
};

/** Renders a page's reading-order content: text as paragraphs, images inline, other files as attachments. */
function buildPageHtml(note: BNote, page: OnePage, shrinkImages: boolean): string {
    const parts: string[] = [];
    for (const block of page.content) {
        if (block.kind === "text") {
            parts.push(`<p>${escapeHtml(block.text).replace(/\n/g, "<br>")}</p>`);
            continue;
        }

        const ext = (block.ext ?? "").toLowerCase();
        if (IMAGE_EXTENSIONS.has(ext)) {
            const { attachmentId, title } = imageService.saveImageToAttachment(note.noteId, block.bytes, block.name, shrinkImages);
            if (attachmentId) {
                parts.push(`<figure class="image"><img src="api/attachments/${attachmentId}/image/${encodeURIComponent(title)}"></figure>`);
            }
            continue;
        }

        const { attachmentId } = note.saveAttachment({
            role: "file",
            mime: MIME_BY_EXTENSION[ext] ?? "application/octet-stream",
            title: block.name,
            content: block.bytes
        });
        parts.push(`<p><a class="reference-link" href="#root/${note.noteId}?viewMode=attachments&attachmentId=${attachmentId}">${escapeHtml(block.name)}</a></p>`);
    }
    return parts.join("") || "<p></p>";
}

export default { importOneFile };
