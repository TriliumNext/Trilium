/**
 * What one named image is: its format, its dimensions, what it weighs, and how it is stored.
 *
 * The counterpart to the inventory, which answers the same question over a whole note. Both read
 * headers only and neither decodes, so opening either costs a blob read and nothing else.
 */

import { IMAGE_COMPRESSIBLE_FORMATS, type ImageInfoResponse } from "@triliumnext/commons";

import becca from "../becca/becca.js";
import type BAttachment from "../becca/entities/battachment.js";
import type BNote from "../becca/entities/bnote.js";
import { ForbiddenError, NotFoundError, ValidationError } from "../errors.js";
import { inspectImage } from "./image_inspect.js";
import { estimateJpegQuality } from "./jpeg_quality.js";
import { wrapStringOrBuffer } from "./utils/binary.js";

/** Describes an image note's own image. */
export function getNoteImageInfo(noteId: string): ImageInfoResponse {
    const note = becca.getNote(noteId);

    if (!note) {
        throw new NotFoundError(`Note '${noteId}' was not found.`);
    }

    if (note.type !== "image") {
        throw new ValidationError(`Note '${noteId}' is of type '${note.type}', but 'image' was expected.`);
    }

    return describe("note", noteId, note.title, note.mime, note);
}

/** Describes one image attachment. */
export function getAttachmentImageInfo(attachmentId: string): ImageInfoResponse {
    const attachment = becca.getAttachment(attachmentId);

    if (!attachment) {
        throw new NotFoundError(`Attachment '${attachmentId}' was not found.`);
    }

    if (attachment.role !== "image") {
        throw new ValidationError(`Attachment '${attachmentId}' has role '${attachment.role}', but 'image' was expected.`);
    }

    return describe("attachment", attachmentId, attachment.title, attachment.mime, attachment);
}

function describe(
    entityType: "note" | "attachment",
    entityId: string,
    title: string,
    mime: string,
    entity: BNote | BAttachment
): ImageInfoResponse {
    if (!entity.isContentAvailable()) {
        // Nothing here can be read without the content, and answering with a row of nulls would
        // pass for an image that simply says nothing about itself.
        throw new ForbiddenError(`Content of '${entityId}' is protected and no protected session is open.`);
    }

    const content = wrapStringOrBuffer(entity.getContent());
    const inspected = inspectImage(content);

    return {
        entityType,
        entityId,
        title,
        mime,
        format: inspected.format,
        detectedMime: inspected.mime,
        size: content.byteLength,
        width: inspected.width,
        height: inspected.height,
        bitDepth: inspected.bitDepth,
        channels: inspected.channels,
        hasAlpha: inspected.hasAlpha,
        indexed: inspected.indexed,
        // Only a JPEG carries the quantization tables this is read from; for everything else the
        // question does not arise, which is a different thing from an unreadable answer.
        quality: inspected.format === "jpg" ? estimateJpegQuality(content) : null,
        compressible: (IMAGE_COMPRESSIBLE_FORMATS as readonly string[]).includes(inspected.format)
    };
}

export default { getNoteImageInfo, getAttachmentImageInfo };
