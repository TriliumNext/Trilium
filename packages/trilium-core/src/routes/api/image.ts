import { type ImageCompressionOptions, isAcceptedImageMime, isImageAttachmentRole, NOTE_TYPE_IMAGE_ATTACHMENTS } from "@triliumnext/commons";
import type { Request, Response } from "express";
import type { File } from "../../services/import/common.js";

type FileRequest<P> = Omit<Request<P>, "file"> & { file?: File };

import becca from "../../becca/becca.js";
import type BNote from "../../becca/entities/bnote.js";
import type BRevision from "../../becca/entities/brevision.js";
import { ValidationError } from "../../errors.js";
import imageService from "../../services/image.js";
import imageCompressionService from "../../services/image_compression.js";
import imageInfoService from "../../services/image_info.js";
import imageInventoryService from "../../services/image_inventory.js";
import { sanitizeSvg, SVG_CONTENT_SECURITY_POLICY } from "../../services/utils/index.js";
import { unwrapStringOrBuffer } from "../../services/utils/binary.js";

function returnImageFromNote(req: Request<{ noteId: string }>, res: Response) {
    const image = becca.getNote(req.params.noteId);

    return returnImageInt(image, res);
}

function returnImageFromRevision(req: Request<{ revisionId: string }>, res: Response) {
    const image = becca.getRevision(req.params.revisionId);

    return returnImageInt(image, res);
}

function returnImageInt(image: BNote | BRevision | null, res: Response) {
    if (!image) {
        res.set("Content-Type", "image/png");
        // return res.send(fs.readFileSync(`${RESOURCE_DIR}/db/image-deleted.png`));
        return res.sendStatus(404);
    } else if (!["image", "canvas", "mermaid", "mindMap", "spreadsheet"].includes(image.type)) {
        return res.sendStatus(400);
    }

    if (image.type === "canvas") {
        renderSvgAttachment(image, res, NOTE_TYPE_IMAGE_ATTACHMENTS.canvas);
    } else if (image.type === "mermaid") {
        renderSvgAttachment(image, res, NOTE_TYPE_IMAGE_ATTACHMENTS.mermaid);
    } else if (image.type === "mindMap") {
        renderSvgAttachment(image, res, NOTE_TYPE_IMAGE_ATTACHMENTS.mindMap);
    } else if (image.type === "spreadsheet") {
        renderPngAttachment(image, res, NOTE_TYPE_IMAGE_ATTACHMENTS.spreadsheet);
    } else {
        res.set("Content-Type", image.mime);
        res.set("Cache-Control", "no-cache, no-store, must-revalidate");

        if (image.mime === "image/svg+xml") {
            sendSanitizedSvg(res, image.getContent());
        } else {
            res.send(image.getContent());
        }
    }
}

export function renderSvgAttachment(image: BNote | BRevision, res: Response, attachmentName: string) {
    let svgContent: string | Uint8Array = `<svg xmlns="http://www.w3.org/2000/svg"></svg>`;
    const attachment = image.getAttachmentByTitle(attachmentName);

    if (attachment) {
        svgContent = attachment.getContent();
    } else {
        // backwards compatibility, before attachments, the SVG was stored in the main note content as a separate key
        const contentSvg = image.getJsonContentSafely()?.svg;

        if (contentSvg) {
            svgContent = contentSvg;
        }
    }

    res.set("Content-Type", "image/svg+xml");
    res.set("Cache-Control", "no-cache, no-store, must-revalidate");
    sendSanitizedSvg(res, svgContent);
}

export function renderPngAttachment(image: BNote | BRevision, res: Response, attachmentName: string) {
    const attachment = image.getAttachmentByTitle(attachmentName);

    if (attachment) {
        res.set("Content-Type", "image/png");
        res.set("Cache-Control", "no-cache, no-store, must-revalidate");
        res.send(attachment.getContent());
    } else {
        res.sendStatus(404);
    }
}

function returnAttachedImage(req: Request<{ attachmentId: string }>, res: Response) {
    const attachment = becca.getAttachment(req.params.attachmentId);

    if (!attachment) {
        res.set("Content-Type", "image/png");
        // return res.send(fs.readFileSync(`${RESOURCE_DIR}/db/image-deleted.png`));
        return res.sendStatus(404);
    }

    if (!isImageAttachmentRole(attachment.role)) {
        return res.setHeader("Content-Type", "text/plain").status(400)
            .send(`Attachment '${attachment.attachmentId}' has role '${attachment.role}', but a picture was expected.`);
    }

    res.set("Content-Type", attachment.mime);
    res.set("Cache-Control", "no-cache, no-store, must-revalidate");

    if (attachment.mime === "image/svg+xml") {
        sendSanitizedSvg(res, attachment.getContent());
    } else {
        res.send(attachment.getContent());
    }
}

async function updateImage(req: FileRequest<{ noteId: string }>) {
    const { noteId } = req.params;
    const { file } = req;

    const _note = becca.getNoteOrThrow(noteId);

    if (!file) {
        return {
            uploaded: false,
            message: `Missing image data.`
        };
    }

    if (!isAcceptedImageMime(file.mimetype)) {
        return {
            uploaded: false,
            message: `Unknown image type: ${file.mimetype}`
        };
    }

    if (typeof file.buffer === "string") {
        return {
            uploaded: false,
            message: "Invalid image content."
        };
    }

    imageService.updateImage(noteId, file.buffer, file.originalname);

    // The client re-requests the image as soon as this answers, to show what it just uploaded.
    // Answering first would have it fetch the note's old content, or nothing at all.
    await imageService.awaitImageWrite(noteId);

    return { uploaded: true };
}

/** What one image note's own image is: format, size, and how it is stored. */
function getNoteImageInfo(req: Request<{ noteId: string }>) {
    return imageInfoService.getNoteImageInfo(req.params.noteId);
}

/** The same for one image attachment. */
function getAttachmentImageInfo(req: Request<{ attachmentId: string }>) {
    return imageInfoService.getAttachmentImageInfo(req.params.attachmentId);
}

/**
 * What images the note holds and how much of that compressing could reach — the reading the
 * compression dialog opens on, so that it can say whether a run is worth making.
 */
function getImageInventory(req: Request<{ noteId: string }>) {
    const { recursive, maxWidthHeight } = req.query;

    if (recursive !== undefined && recursive !== "true" && recursive !== "false") {
        return [ 400, "recursive must be 'true' or 'false'." ];
    }

    // `Number` of anything unparseable is NaN, which the service rejects along with every other
    // value that is not a whole number of pixels — so a bad query fails rather than falling back.
    return imageInventoryService.getNoteImageInventory(req.params.noteId, {
        recursive: recursive === "true",
        maxWidthHeight: maxWidthHeight === undefined ? undefined : Number(maxWidthHeight)
    });
}

function compressNoteImages(req: Request<{ noteId: string }>) {
    return imageCompressionService.compressNoteImages(req.params.noteId, readCompressionOptions(req));
}

function compressAttachmentImage(req: Request<{ attachmentId: string }>) {
    return imageCompressionService.compressAttachmentImage(req.params.attachmentId, readCompressionOptions(req));
}

/**
 * Calls off a run by the name its caller gave it, and says nothing about whether one was going.
 *
 * There is nothing useful to report either way: a run that has just finished and a name that was
 * never used look the same from here, and neither is a failure — the caller wanted this run stopped
 * and after this it is, or it already was.
 */
function cancelImageCompression(req: Request<{ taskId: string }>) {
    imageCompressionService.cancelImageCompression(req.params.taskId);
}

export default {
    returnImageFromNote,
    returnImageFromRevision,
    returnAttachedImage,
    updateImage,
    getNoteImageInfo,
    getAttachmentImageInfo,
    getImageInventory,
    compressNoteImages,
    compressAttachmentImage,
    cancelImageCompression
};

/**
 * The body is optional — sending none asks for the defaults — but anything that is sent has to be
 * an object, so a stray array or string fails here rather than being silently read as "defaults".
 * The individual fields are validated by the service, which owns their bounds and fallbacks.
 */
function readCompressionOptions(req: Request): ImageCompressionOptions {
    const { body } = req;

    if (body === undefined || body === null) {
        return {};
    }

    if (typeof body !== "object" || Array.isArray(body)) {
        throw new ValidationError("The request body must be an object of compression options.");
    }

    return body as ImageCompressionOptions;
}

function sendSanitizedSvg(res: Response, content: string | Uint8Array) {
    const svgString = unwrapStringOrBuffer(content);
    res.set("Content-Security-Policy", SVG_CONTENT_SECURITY_POLICY);
    res.set("X-Content-Type-Options", "nosniff");
    res.send(sanitizeSvg(svgString));
}
