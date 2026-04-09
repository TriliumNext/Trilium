/**
 * LLM tools for attachment operations.
 */

import { z } from "zod";

import becca from "../../../becca/becca.js";
import { defineTools } from "./tool_registry.js";

export const attachmentTools = defineTools({
    get_attachment: {
        description: "Get metadata for a single attachment by its ID.",
        inputSchema: z.object({
            attachmentId: z.string().describe("The ID of the attachment to retrieve")
        }),
        execute: ({ attachmentId }) => {
            const attachment = becca.getAttachment(attachmentId);
            if (!attachment) {
                return { error: "Attachment not found" };
            }

            return {
                attachmentId: attachment.attachmentId,
                ownerId: attachment.ownerId,
                role: attachment.role,
                mime: attachment.mime,
                title: attachment.title,
                dateModified: attachment.dateModified,
                contentLength: attachment.contentLength
            };
        }
    },

    get_attachment_content: {
        description: "Read the text content of an attachment. Works for text-based attachments (code, SVG, plain text) and binary attachments that have OCR/extracted text (PDF, images). Attachments with a null contentPreview in get_note_attachments have no readable content.",
        inputSchema: z.object({
            attachmentId: z.string().describe("The ID of the attachment to read")
        }),
        execute: ({ attachmentId }) => {
            const attachment = becca.getAttachment(attachmentId);
            if (!attachment) {
                return { error: "Attachment not found" };
            }

            if (attachment.hasStringContent()) {
                const content = attachment.getContent();
                return {
                    attachmentId: attachment.attachmentId,
                    source: "text" as const,
                    content: typeof content === "string" ? content : content.toString("utf-8")
                };
            }

            // For binary attachments, try OCR/extracted text from the blob.
            const blob = attachment.blobId ? becca.getBlob({ blobId: attachment.blobId }) : null;
            if (blob?.textRepresentation) {
                return {
                    attachmentId: attachment.attachmentId,
                    source: "ocr" as const,
                    content: blob.textRepresentation
                };
            }

            return { error: "Attachment has no readable text content" };
        }
    }
});
