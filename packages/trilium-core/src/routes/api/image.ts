import { NOTE_TYPE_IMAGE_ATTACHMENTS } from "@triliumnext/commons";
import type { Request, Response } from "express";
import type { File } from "../../services/import/common.js";

type FileRequest<P> = Omit<Request<P>, "file"> & { file?: File };

import becca from "../../becca/becca.js";
import type BNote from "../../becca/entities/bnote.js";
import type BRevision from "../../becca/entities/brevision.js";
import imageService from "../../services/image.js";
import { sanitizeSvg, SVG_CONTENT_SECURITY_POLICY } from "../../services/utils/index.js";
import { unwrapStringOrBuffer } from "../../services/utils/binary.js";

/** The request bits the caching logic reads; structurally satisfied by any route's typed Request. */
interface ImageRequest {
    query: Record<string, unknown>;
    headers: Record<string, unknown>;
}

function returnImageFromNote(req: Request<{ noteId: string }>, res: Response) {
    const image = becca.getNote(req.params.noteId);

    return returnImageInt(image, req, res);
}

function returnImageFromRevision(req: Request<{ revisionId: string }>, res: Response) {
    const image = becca.getRevision(req.params.revisionId);

    // A revision's content never changes, so its URL is immutable without any version pin.
    return returnImageInt(image, req, res, { immutableUrl: true });
}

function returnImageInt(image: BNote | BRevision | null, req: ImageRequest, res: Response, { immutableUrl = false } = {}) {
    if (!image) {
        res.set("Content-Type", "image/png");
        // return res.send(fs.readFileSync(`${RESOURCE_DIR}/db/image-deleted.png`));
        return res.sendStatus(404);
    } else if (!["image", "canvas", "mermaid", "mindMap", "spreadsheet"].includes(image.type)) {
        return res.sendStatus(400);
    } else if (!image.isContentAvailable()) {
        // Protected content without a protected session: a crisp 404 instead of an empty-bodied 200.
        return res.sendStatus(404);
    }

    if (image.type === "canvas") {
        renderSvgAttachment(image, req, res, NOTE_TYPE_IMAGE_ATTACHMENTS.canvas);
    } else if (image.type === "mermaid") {
        renderSvgAttachment(image, req, res, NOTE_TYPE_IMAGE_ATTACHMENTS.mermaid);
    } else if (image.type === "mindMap") {
        renderSvgAttachment(image, req, res, NOTE_TYPE_IMAGE_ATTACHMENTS.mindMap);
    } else if (image.type === "spreadsheet") {
        renderPngAttachment(image, req, res, NOTE_TYPE_IMAGE_ATTACHMENTS.spreadsheet);
    } else {
        sendImageContent(req, res, {
            mime: image.mime,
            isProtected: !!image.isProtected,
            etagBlobId: image.blobId,
            urlVersionBlobId: image.blobId,
            immutableUrl,
            isSvg: image.mime === "image/svg+xml",
            getContent: () => image.getContent()
        });
    }
}

export function renderSvgAttachment(image: BNote | BRevision, req: ImageRequest, res: Response, attachmentName: string) {
    const attachment = image.getAttachmentByTitle(attachmentName);

    sendImageContent(req, res, {
        mime: "image/svg+xml",
        isProtected: !!image.isProtected,
        // The bytes come from the export attachment when present; sanitization is deterministic,
        // so the backing blobId stays a valid strong validator for the sanitized output.
        etagBlobId: attachment?.blobId ?? image.blobId,
        urlVersionBlobId: image.blobId,
        isSvg: true,
        getContent: () => {
            if (attachment) {
                return attachment.getContent();
            }
            // backwards compatibility, before attachments, the SVG was stored in the main note content as a separate key
            return image.getJsonContentSafely()?.svg ?? `<svg xmlns="http://www.w3.org/2000/svg"></svg>`;
        }
    });
}

export function renderPngAttachment(image: BNote | BRevision, req: ImageRequest, res: Response, attachmentName: string) {
    const attachment = image.getAttachmentByTitle(attachmentName);

    if (!attachment) {
        return res.sendStatus(404);
    }

    sendImageContent(req, res, {
        mime: "image/png",
        isProtected: !!image.isProtected,
        etagBlobId: attachment.blobId,
        urlVersionBlobId: image.blobId,
        getContent: () => attachment.getContent()
    });
}

function returnAttachedImage(req: Request<{ attachmentId: string }>, res: Response) {
    const attachment = becca.getAttachment(req.params.attachmentId);

    if (!attachment) {
        res.set("Content-Type", "image/png");
        // return res.send(fs.readFileSync(`${RESOURCE_DIR}/db/image-deleted.png`));
        return res.sendStatus(404);
    }

    if (!["image"].includes(attachment.role)) {
        return res.setHeader("Content-Type", "text/plain").status(400).send(`Attachment '${attachment.attachmentId}' has role '${attachment.role}', but 'image' was expected.`);
    }

    if (!attachment.isContentAvailable()) {
        return res.sendStatus(404);
    }

    sendImageContent(req, res, {
        mime: attachment.mime,
        isProtected: !!attachment.isProtected,
        etagBlobId: attachment.blobId,
        urlVersionBlobId: attachment.blobId,
        isSvg: attachment.mime === "image/svg+xml",
        getContent: () => attachment.getContent()
    });
}

function updateImage(req: FileRequest<{ noteId: string }>) {
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

/** What backs an image response, and how it may be cached. */
interface ImageContentSource {
    mime: string;
    /** Whether the bytes belong to a protected entity — decrypted content must never be disk-cached. */
    isProtected: boolean;
    /**
     * Content-addressed id of the blob actually backing the bytes (`hashedBlobId`: same blobId ⇔
     * same stored bytes), i.e. a perfect strong validator. Absent → the response stays uncacheable.
     */
    etagBlobId: string | null | undefined;
    /**
     * blobId of the entity the URL addresses — what the client pins in `?v=`. Differs from
     * {@link etagBlobId} for canvas/mermaid/mindMap/spreadsheet notes, whose bytes come from an
     * export attachment while the client versions the URL by the note.
     */
    urlVersionBlobId?: string | null;
    /** The URL itself is immutable (revisions): cache forever without needing a `?v=` match. */
    immutableUrl?: boolean;
    /** SVG responses are sanitized and carry a restrictive CSP. */
    isSvg?: boolean;
    getContent(): string | Uint8Array;
}

/** One year. Versioned URLs change whenever the content does, so the cached copy never goes stale. */
const IMMUTABLE_CACHE_CONTROL = "private, max-age=31536000, immutable";

/**
 * Sends image bytes with cache semantics keyed to the content-addressed blobId:
 *
 * 1. Protected (or validator-less) content: `no-cache, no-store` and no ETag — decrypted bytes must
 *    never persist in a browser/Electron disk cache, and an ETag would leak content-hash equality.
 * 2. The URL pins the current version (`?v=` matches, or the URL is inherently immutable):
 *    `immutable` for a year — gallery navigation and remounts become pure cache hits.
 * 3. Otherwise (no/stale pin, e.g. reference URLs persisted inside note content): `private,
 *    no-cache` + ETag, answering a matching `If-None-Match` with a 304 **before** reading the blob —
 *    no content fetch, no decryption, no SVG sanitization.
 */
export function sendImageContent(req: ImageRequest, res: Response, source: ImageContentSource) {
    res.set("Content-Type", source.mime);

    if (source.isProtected || !source.etagBlobId) {
        res.set("Cache-Control", "no-cache, no-store, must-revalidate");
    } else {
        res.set("ETag", `"${source.etagBlobId}"`);
        const requestedVersion = typeof req.query?.v === "string" ? req.query.v : undefined;
        const pinsCurrentVersion = source.immutableUrl
            || (requestedVersion !== undefined && requestedVersion === source.urlVersionBlobId);
        res.set("Cache-Control", pinsCurrentVersion ? IMMUTABLE_CACHE_CONTROL : "private, no-cache");

        // Contains-check tolerates weak validators (W/"…") and comma-separated lists.
        const ifNoneMatch = req.headers?.["if-none-match"];
        if (typeof ifNoneMatch === "string" && ifNoneMatch.includes(`"${source.etagBlobId}"`)) {
            return res.sendStatus(304);
        }
    }

    if (source.isSvg) {
        sendSanitizedSvg(res, source.getContent());
    } else {
        res.send(source.getContent());
    }
}

function sendSanitizedSvg(res: Response, content: string | Uint8Array) {
    const svgString = unwrapStringOrBuffer(content);
    res.set("Content-Security-Policy", SVG_CONTENT_SECURITY_POLICY);
    res.set("X-Content-Type-Options", "nosniff");
    res.send(sanitizeSvg(svgString));
}
