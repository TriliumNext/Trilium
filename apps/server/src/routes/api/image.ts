"use strict";

import imageService from "../../services/image.js";
import becca from "../../becca/becca.js";
import fs from "fs";
import type { Request, Response } from "express";
import type BNote from "../../becca/entities/bnote.js";
import type BRevision from "../../becca/entities/brevision.js";
import { RESOURCE_DIR } from "../../services/resource_dir.js";
import { sanitizeSvg, setSvgHeaders } from "../../services/svg_sanitizer.js";

function returnImageFromNote(req: Request, res: Response) {
    const image = becca.getNote(req.params.noteId);

    return returnImageInt(image, res);
}

function returnImageFromRevision(req: Request, res: Response) {
    const image = becca.getRevision(req.params.revisionId);

    return returnImageInt(image, res);
}

function returnImageInt(image: BNote | BRevision | null, res: Response) {
    if (!image) {
        res.set("Content-Type", "image/png");
        return res.send(fs.readFileSync(`${RESOURCE_DIR}/db/image-deleted.png`));
    } else if (!["image", "canvas", "mermaid", "mindMap"].includes(image.type)) {
        return res.sendStatus(400);
    }

    if (image.type === "canvas") {
        renderSvgAttachment(image, res, "canvas-export.svg");
    } else if (image.type === "mermaid") {
        renderSvgAttachment(image, res, "mermaid-export.svg");
    } else if (image.type === "mindMap") {
        renderSvgAttachment(image, res, "mindmap-export.svg");
    } else if (image.mime === "image/svg+xml") {
        // SVG images require sanitization to prevent stored XSS
        const content = image.getContent();
        const sanitized = sanitizeSvg(typeof content === "string" ? content : content?.toString("utf-8") ?? "");
        setSvgHeaders(res);
        res.send(sanitized);
    } else {
        res.set("Content-Type", image.mime);
        res.set("Cache-Control", "no-cache, no-store, must-revalidate");
        res.send(image.getContent());
    }
}

export function renderSvgAttachment(image: BNote | BRevision, res: Response, attachmentName: string) {
    let svg: string | Buffer = `<svg xmlns="http://www.w3.org/2000/svg"></svg>`;
    const attachment = image.getAttachmentByTitle(attachmentName);

    if (attachment) {
        svg = attachment.getContent();
    } else {
        // backwards compatibility, before attachments, the SVG was stored in the main note content as a separate key
        const contentSvg = image.getJsonContentSafely()?.svg;

        if (contentSvg) {
            svg = contentSvg;
        }
    }

    const sanitized = sanitizeSvg(svg);
    setSvgHeaders(res);
    res.send(sanitized);
}

function returnAttachedImage(req: Request, res: Response) {
    const attachment = becca.getAttachment(req.params.attachmentId);

    if (!attachment) {
        res.set("Content-Type", "image/png");
        return res.send(fs.readFileSync(`${RESOURCE_DIR}/db/image-deleted.png`));
    }

    if (!["image"].includes(attachment.role)) {
        return res.setHeader("Content-Type", "text/plain").status(400).send(`Attachment '${attachment.attachmentId}' has role '${attachment.role}', but 'image' was expected.`);
    }

    if (attachment.mime === "image/svg+xml") {
        // SVG attachments require sanitization to prevent stored XSS
        const content = attachment.getContent();
        const sanitized = sanitizeSvg(typeof content === "string" ? content : content?.toString("utf-8") ?? "");
        setSvgHeaders(res);
        res.send(sanitized);
    } else {
        res.set("Content-Type", attachment.mime);
        res.set("Cache-Control", "no-cache, no-store, must-revalidate");
        res.send(attachment.getContent());
    }
}

function updateImage(req: Request) {
    const { noteId } = req.params;
    const { file } = req;

    const _note = becca.getNoteOrThrow(noteId);

    if (!file) {
        return {
            uploaded: false,
            message: `Missing image data.`
        };
    }

    if (!["image/png", "image/jpeg", "image/gif", "image/webp", "image/svg+xml"].includes(file.mimetype)) {
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

    return { uploaded: true };
}

export default {
    returnImageFromNote,
    returnImageFromRevision,
    returnAttachedImage,
    updateImage
};
