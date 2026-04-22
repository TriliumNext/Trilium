/**
 * Shared helpers for LLM tools — content conversion, metadata building, and previews.
 */

import becca from "../../../becca/becca.js";
import type BAttachment from "../../../becca/entities/battachment.js";
import type BNote from "../../../becca/entities/bnote.js";
import markdownExport from "../../export/markdown.js";
import markdownImport from "../../import/markdown.js";

const CONTENT_PREVIEW_MAX_LENGTH = 500;
const ATTACHMENT_PREVIEW_MAX_LENGTH = 200;
/** Skip expensive content loading/conversion for notes larger than this. */
const CONTENT_PREVIEW_SIZE_THRESHOLD = 10_000;

/** Note IDs that must not be deleted, moved, or cloned by the LLM. */
export const PROTECTED_SYSTEM_NOTES = new Set(["root", "_hidden", "_share", "_lbRoot", "_globalNoteMap"]);

/**
 * Return `true` if the value is truthy, otherwise `undefined`.
 * Since `undefined` values are omitted from JSON serialization,
 * this effectively includes the field only when true.
 * Usage: `{ isInheritable: flag(attr.isInheritable) }`
 */
export function flag(value: boolean | undefined): true | undefined {
    return value ? true : undefined;
}

/**
 * Convert note content to a format suitable for LLM consumption.
 * Text notes are converted from HTML to Markdown to reduce token usage.
 */
export function getNoteContentForLlm(note: BNote) {
    const content = note.getContent();
    if (typeof content !== "string") {
        // For binary content (images, files), use extracted text if available.
        const blob = note.blobId ? becca.getBlob({ blobId: note.blobId }) : null;
        if (blob?.textRepresentation) {
            return `[extracted text from ${note.type}]\n${blob.textRepresentation}`;
        }
        return "[binary content]";
    }
    if (note.type === "text") {
        return markdownExport.toMarkdown(content);
    }
    return content;
}

/**
 * Convert LLM-provided content to a format suitable for storage.
 * For text notes, converts Markdown to HTML.
 */
export function setNoteContentFromLlm(note: BNote, content: string) {
    if (note.type === "text") {
        note.setContent(markdownImport.renderToHtml(content, note.title));
    } else {
        note.setContent(content);
    }
}

/**
 * Return a short plain-text content preview for a note, truncated to
 * {@link CONTENT_PREVIEW_MAX_LENGTH} characters. Useful for giving an LLM a
 * glimpse of the content without sending the full body.
 *
 * For large notes (>{@link CONTENT_PREVIEW_SIZE_THRESHOLD} bytes), returns a
 * size hint instead of loading and converting the full content.
 */
export function getContentPreview(note: BNote): string | null {
    if (!note.isContentAvailable()) {
        return null;
    }

    // Check content size before loading to avoid expensive conversion for large notes
    const blob = note.blobId ? becca.getBlob({ blobId: note.blobId }) : null;
    if (blob && blob.contentLength > CONTENT_PREVIEW_SIZE_THRESHOLD) {
        const sizeKb = Math.round(blob.contentLength / 1024);
        return `[${sizeKb}KB - use get_note_content for full text]`;
    }

    const full = getNoteContentForLlm(note);
    if (!full || full === "[binary content]") {
        return null;
    }

    if (full.length <= CONTENT_PREVIEW_MAX_LENGTH) {
        return full;
    }

    return `${full.slice(0, CONTENT_PREVIEW_MAX_LENGTH)}…`;
}

/**
 * Return a short content preview for an attachment, or null if no readable
 * content is available. For text attachments the raw content is used; for
 * binary attachments (PDF, images) the OCR/extracted text is used when present.
 */
export function getAttachmentContentPreview(att: BAttachment): string | null {
    let text: string | null = null;

    if (att.hasStringContent()) {
        const content = att.getContent();
        text = typeof content === "string" ? content : content.toString("utf-8");
    } else {
        const blob = att.blobId ? becca.getBlob({ blobId: att.blobId }) : null;
        text = blob?.textRepresentation ?? null;
    }

    if (!text) {
        return null;
    }

    if (text.length <= ATTACHMENT_PREVIEW_MAX_LENGTH) {
        return text;
    }

    return `${text.slice(0, ATTACHMENT_PREVIEW_MAX_LENGTH)}…`;
}

/** Limits for collections returned in system prompt context. */
export const SYSTEM_PROMPT_LIMITS = {
    childNotes: 20,
    attributes: 20,
    attachments: 20
} as const;

/** Limits for collections returned by the get_note tool. */
export const TOOL_LIMITS = {
    childNotes: 50,
    attributes: 50,
    attachments: 50
} as const;

interface NoteMetaLimits {
    childNotes: number;
    attributes: number;
    attachments: number;
}

/**
 * Truncate an array and return it with total count metadata.
 * If the array exceeds `limit`, only the first `limit` items are returned.
 */
function truncated<T>(items: T[], limit: number) {
    return {
        totalCount: items.length,
        results: items.slice(0, limit)
    };
}

/**
 * Build the full metadata object for a note. Used by both the `get_note` tool
 * and the system prompt.
 *
 * @param limits — controls how many child notes, attributes, and attachments
 *   are included. Use {@link SYSTEM_PROMPT_LIMITS} for the system prompt and
 *   {@link TOOL_LIMITS} for the `get_note` tool.
 */
export function getNoteMeta(note: BNote, limits: NoteMetaLimits) {
    const allChildNotes = note.getChildNotes().map((ch) => ({
        noteId: ch.noteId,
        title: ch.getTitleOrProtected()
    }));

    const allAttributes = note.getAttributes().map((attr) => ({
        attributeId: attr.attributeId,
        type: attr.type,
        name: attr.name,
        value: attr.value,
        isInheritable: flag(attr.isInheritable)
    }));

    const allAttachments = note.getAttachments().map((att) => ({
        attachmentId: att.attachmentId,
        role: att.role,
        mime: att.mime,
        title: att.title,
        contentLength: att.contentLength,
        contentPreview: getAttachmentContentPreview(att)
    }));

    return {
        noteId: note.noteId,
        isProtected: flag(note.isProtected),
        title: note.getTitleOrProtected(),
        type: note.type,
        mime: note.mime,
        dateCreated: note.dateCreated,
        dateModified: note.dateModified,
        parentNoteIds: note.getParentNotes().map((p) => p.noteId),
        childNotes: truncated(allChildNotes, limits.childNotes),
        attributes: truncated(allAttributes, limits.attributes),
        contentPreview: getContentPreview(note),
        attachments: truncated(allAttachments, limits.attachments)
    };
}
