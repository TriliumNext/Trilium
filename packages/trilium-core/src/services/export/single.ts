

import type { Response } from "express";
import html from "html";
import mimeTypes from "mime-types";

import becca from "../../becca/becca.js";
import type BBranch from "../../becca/entities/bbranch.js";
import type BNote from "../../becca/entities/bnote.js";
import type TaskContext from "../task_context.js";
import { escapeHtml,getContentDisposition } from "../utils/index.js";
import mdService from "./markdown.js";
import { ExportFormat } from "../../meta.js";
import { encodeBase64 } from "../utils/binary.js";

function exportSingleNote(taskContext: TaskContext<"export">, branch: BBranch, format: ExportFormat, res: Response) {
    const note = branch.getNote();

    if (note.type === "image" || note.type === "file") {
        return [400, `Note type '${note.type}' cannot be exported as single file.`];
    }

    if (format !== "html" && format !== "markdown") {
        return [400, `Unrecognized format '${format}'`];
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
    } else if (note.type === "relationMap" || note.type === "search") {
        payload = content;
        extension = "json";
        mime = "application/json";
    }

    return { payload, extension, mime };
}

function inlineAttachments(content: string) {
    content = content.replace(/src="[^"]*api\/images\/([a-zA-Z0-9_]+)\/?[^"]+"/g, (match, noteId) => {
        const note = becca.getNote(noteId);
        if (!note || !note.mime.startsWith("image/")) {
            return match;
        }

        const imageContent = note.getContent();
        if (typeof imageContent === "string") {
            return match;
        }

        const base64Content = encodeBase64(imageContent);
        const srcValue = `data:${note.mime};base64,${base64Content}`;

        return `src="${srcValue}"`;
    });

    content = content.replace(/src="[^"]*api\/attachments\/([a-zA-Z0-9_]+)\/image\/?[^"]+"/g, (match, attachmentId) => {
        const attachment = becca.getAttachment(attachmentId);
        if (!attachment || !attachment.mime.startsWith("image/")) {
            return match;
        }

        const attachmentContent = attachment.getContent();
        if (typeof attachmentContent === "string") {
            return match;
        }

        const base64Content = encodeBase64(attachmentContent);
        const srcValue = `data:${attachment.mime};base64,${base64Content}`;

        return `src="${srcValue}"`;
    });

    content = content.replace(/href="[^"]*#root[^"]*attachmentId=([a-zA-Z0-9_]+)\/?"/g, (match, attachmentId) => {
        const attachment = becca.getAttachment(attachmentId);
        if (!attachment) {
            return match;
        }

        const attachmentContent = attachment.getContent();
        if (typeof attachmentContent === "string") {
            return match;
        }

        const base64Content = encodeBase64(attachmentContent);
        const hrefValue = `data:${attachment.mime};base64,${base64Content}`;

        return `href="${hrefValue}" download="${escapeHtml(attachment.title)}"`;
    });

    return content;
}

export default {
    exportSingleNote
};
