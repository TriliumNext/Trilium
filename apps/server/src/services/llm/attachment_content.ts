/**
 * Provider-neutral resolution of multimodal message parts.
 *
 * Both the AI-SDK providers ({@link ./providers/base_provider}) and the Claude Agent
 * provider need the same thing from an attachment part: load the bytes out of
 * Becca and apply the conventions that don't depend on the provider — an SVG is
 * rendered as its XML source (no vision model accepts SVG, but all can read the
 * markup), and a text attachment is inlined as a labelled `<file>` block. Each
 * path then maps the neutral result into its own SDK's block shape.
 */

import type { LlmMessagePart } from "@triliumnext/commons";
import { becca, getLog } from "@triliumnext/core";
import { decodeUtf8 } from "@triliumnext/core/src/services/utils/binary.js";

export type ResolvedAttachment =
    | { kind: "text"; text: string }
    | { kind: "image"; bytes: Uint8Array; mime: string }
    | { kind: "file"; bytes: Uint8Array; mime: string; filename: string };

/**
 * Resolve a single {@link LlmMessagePart} to its provider-neutral form. Returns
 * `null` when the part can't be resolved (missing, protected without an
 * unlocked session, or a corrupt/undecodable blob) — the caller drops it and
 * the rest of the message still reaches the model.
 */
export function resolveAttachmentPart(part: LlmMessagePart): ResolvedAttachment | null {
    if (part.type === "text") {
        return { kind: "text", text: part.text };
    }
    try {
        const attachment = becca.getAttachment(part.attachmentId);
        if (!attachment) {
            getLog().error(`LLM message references missing attachment ${part.attachmentId}`);
            return null;
        }
        if (!attachment.isContentAvailable()) {
            getLog().error(`LLM message references protected attachment ${part.attachmentId} without an unlocked session`);
            return null;
        }
        // Read attachment bytes once — `getContent()` hits the blob store and
        // (for protected attachments) decrypts, so callers shouldn't repeat it.
        const content = attachment.getContent();
        if (part.type === "image") {
            const mime = part.mime || attachment.mime;
            if (mime === "image/svg+xml") {
                const filename = attachment.title || "image.svg";
                return { kind: "text", text: wrapFile(filename, decodeUtf8(content)) };
            }
            return { kind: "image", bytes: content, mime };
        }
        if (part.type === "file") {
            return {
                kind: "file",
                bytes: content,
                mime: part.mime || attachment.mime,
                filename: part.filename || attachment.title
            };
        }
        // type === "text_attachment" — decode the bytes and wrap in a labelled
        // block so the filename gives the model context about what it's reading.
        return { kind: "text", text: wrapFile(part.filename || attachment.title, decodeUtf8(content)) };
    } catch (err) {
        // A single unreadable attachment shouldn't crash the whole chat turn —
        // drop the part and log so the rest of the message still gets through.
        getLog().error(`Failed to resolve message part for attachment ${part.attachmentId}: ${err}`);
        return null;
    }
}

function wrapFile(filename: string, text: string): string {
    return `<file name="${filename}">\n${text}\n</file>`;
}
