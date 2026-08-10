

import type { Response } from "express";
import html from "html";
import mimeTypes from "mime-types";

import becca from "../../becca/becca.js";
import type BBranch from "../../becca/entities/bbranch.js";
import type BNote from "../../becca/entities/bnote.js";
import { ValidationError } from "../../errors.js";
import type TaskContext from "../task_context.js";
import { escapeHtml,getContentDisposition } from "../utils/index.js";
import mdService from "./markdown.js";
import { stripListItemIds } from "./strip_list_item_ids.js";
import { ExportFormat } from "../../meta.js";
import { encodeBase64 } from "../utils/binary.js";

function exportSingleNote(taskContext: TaskContext<"export">, branch: BBranch, format: ExportFormat, res: Response) {
    const note = branch.getNote();

    // These are thrown rather than returned: the export route writes straight to `res` and has no
    // result handler, so a returned [status, body] tuple was silently dropped and the request was
    // left unanswered. Throwing reaches the route's catch, which both answers the request and
    // reports the failure to the task context (i.e. to the client's export progress UI).
    if (note.type === "image" || note.type === "file") {
        throw new ValidationError(`Note type '${note.type}' cannot be exported as single file.`);
    }

    if (format !== "html" && format !== "markdown") {
        throw new ValidationError(`Unrecognized format '${format}'`);
    }

    const { payload, extension, mime } = mapByNoteType(note, note.getContent(), format);
    const fileName = `${note.title}.${extension}`;

    res.setHeader("Content-Disposition", getContentDisposition(fileName));
    res.setHeader("Content-Type", `${mime}; charset=UTF-8`);

    res.send(payload);

    taskContext.increaseProgressCount();
    taskContext.taskSucceeded(null);
}

/**
 * Extension fallback for MIME types the `mime-types` package doesn't recognize —
 * mostly Trilium's `text/x-` custom MIMEs.
 */
export function mapCodeMimeToExtension(mime: string): string | null {
    switch (mime) {
        case "text/x-markdown":
        case "text/markdown":
        case "text/x-gfm":
            return "md";
        default:
            return null;
    }
}

export function mapByNoteType(note: BNote, content: string | Uint8Array, format: ExportFormat) {
    let payload, extension, mime;

    if (typeof content !== "string") {
        throw new Error("Unsupported content type for export.");
    }

    if (note.type === "text") {
        // Drop CKEditor's editor-only per-list-item bookkeeping from both HTML and Markdown output.
        content = stripListItemIds(content);

        if (format === "html") {
            content = inlineAttachments(content);

            if (!content.toLowerCase().includes("<html")) {
                content = `<html><head><meta charset="utf-8"></head><body>${content}</body></html>`;
            }

            payload = content.length < 100_000 ? html.prettyPrint(content, { indent_size: 2 }) : content;

            extension = "html";
            mime = "text/html";
        } else if (format === "markdown") {
            payload = mdService.toMarkdown(content);
            extension = "md";
            mime = "text/x-markdown";
        }
    } else if (note.type === "code") {
        payload = content;
        // Our own map wins over the `mime-types` lookup so markdown MIMEs get
        // the conventional `.md` rather than `.mkd` (what the lib returns for
        // `text/x-markdown`) or `.code` (what the fallback produced when the
        // lib didn't recognize `text/markdown` at all).
        extension = mapCodeMimeToExtension(note.mime) || mimeTypes.extension(note.mime) || "code";
        mime = note.mime;
    } else if (note.type === "canvas") {
        payload = content;
        extension = "excalidraw";
        mime = "application/json";
    } else if (note.type === "mermaid") {
        payload = content;
        extension = "mermaid";
        mime = "text/vnd.mermaid";
    } else if (note.type === "spreadsheet") {
        // Lossless raw dump of the stored Univer workbook JSON — no conversion (the editor's own
        // CSV/XLSX buttons cover interchange). `.triliumsheet` round-trips back via single import.
        payload = content;
        extension = "triliumsheet";
        mime = "application/json";
    } else if (note.type === "relationMap" || note.type === "search") {
        payload = content;
        extension = "json";
        mime = "application/json";
    } else {
        // Any other note type: dump the raw content with a generic extension, so single-note export
        // produces a real (if opaque) file rather than a zero-byte `.undefined`. Mirrors the `dat`
        // fallback the zip export uses for unrecognised MIME types.
        payload = content;
        extension = "dat";
        mime = note.mime || "application/octet-stream";
    }

    return { payload, extension, mime };
}

/**
 * Carries every picture and file the content points at into the content itself, as base64 `data:`
 * URIs — the whole point of a single-file export being that the one file stands alone.
 *
 * Anything left un-inlined leaves behind a reference to `api/attachments/<id>` or `api/images/<id>`,
 * which is not merely unresolvable outside this instance but actively misleading: the ids are this
 * database's, so the file names an attachment that exists, somewhere else, belonging to someone
 * else's note. Hence no bail-out here is by choice — each one is a case that could not be encoded.
 */
function inlineAttachments(content: string) {
    content = content.replace(/src="[^"]*api\/images\/([a-zA-Z0-9_]+)\/?[^"]+"/g, (match, noteId) => {
        const note = becca.getNote(noteId);
        if (!note || !note.mime.startsWith("image/")) {
            return match;
        }

        const base64Content = encodeBase64(note.getContent());
        const srcValue = `data:${note.mime};base64,${base64Content}`;

        return `src="${srcValue}"`;
    });

    // `data-image` and `data-favicon` are where link previews (section.link-embed,
    // span.link-mention) keep their two picture references; inlining them keeps the exported file
    // self-contained just like an <img> src.
    content = content.replace(/(src|data-image|data-favicon)="[^"]*api\/attachments\/([a-zA-Z0-9_]+)\/image\/?[^"]+"/g, (match, attrName, attachmentId) => {
        const attachment = becca.getAttachment(attachmentId);
        if (!attachment || !attachment.mime.startsWith("image/")) {
            return match;
        }

        const base64Content = encodeBase64(attachment.getContent());
        const srcValue = `data:${attachment.mime};base64,${base64Content}`;

        return `${attrName}="${srcValue}"`;
    });

    content = content.replace(/href="[^"]*#root[^"]*attachmentId=([a-zA-Z0-9_]+)\/?"/g, (match, attachmentId) => {
        const attachment = becca.getAttachment(attachmentId);
        if (!attachment) {
            return match;
        }

        const base64Content = encodeBase64(attachment.getContent());
        const hrefValue = `data:${attachment.mime};base64,${base64Content}`;

        return `href="${hrefValue}" download="${escapeHtml(attachment.title)}"`;
    });

    return content;
}

export default {
    exportSingleNote
};
