import { isSvgMime } from "@triliumnext/commons";
import { ContentNotAvailableError, DetailedConflictError, NotFoundError } from "../errors";
import { Response } from "../http_interface";
import becca from "../becca/becca";
import BNote from "../becca/entities/bnote";
import noteService from "../services/notes";
import protected_session from "../services/protected_session";
import BAttachment from "../becca/entities/battachment";
import { unwrapStringOrBuffer } from "../services/utils/binary";
import { getContentDisposition, getInlineContentHeaders, sanitizeSvg, SVG_CONTENT_SECURITY_POLICY } from "../services/utils/index";

/** The result of `fn`, or the answer of 409 with the details of a {@link DetailedConflictError}. */
export function answerConflict<T>(fn: () => T): T | [number, object] {
    try {
        return fn();
    } catch (e) {
        if (e instanceof DetailedConflictError) {
            return [ 409, e.details ];
        }
        throw e;
    }
}

/**
 * The result of `read`, or `{ status: "unavailable" }` when it throws `NotFoundError` or
 * `ContentNotAvailableError`. A client cannot read the status of a failed request.
 */
export function answerUnavailable<T>(read: () => Promise<T>): Promise<T | UnavailableAnswer>;
export function answerUnavailable<T>(read: () => T): T | UnavailableAnswer;
export function answerUnavailable<T>(read: () => T | Promise<T>) {
    try {
        const result = read();
        return result instanceof Promise ? result.catch(toUnavailable) : result;
    } catch (e) {
        return toUnavailable(e);
    }
}

/** What `answerUnavailable()` returns for a document that is gone or not available. */
export interface UnavailableAnswer {
    status: "unavailable";
}

function toUnavailable(e: unknown): UnavailableAnswer {
    if (e instanceof NotFoundError || e instanceof ContentNotAvailableError) {
        return { status: "unavailable" };
    }
    throw e;
}

export function downloadNoteInt(
    noteId: string, res: Response, contentDisposition = true, expectedBlobId?: string
) {
    const note = becca.getNote(noteId);

    if (!note) {
        return res.setHeader("Content-Type", "text/plain").status(404).send(`Note '${noteId}' doesn't exist.`);
    }

    return downloadData(note, res, contentDisposition, expectedBlobId);
}

/**
 * Sends the content of a note or attachment. With `expectedBlobId`, responds with 409 without the
 * content when the entity has another blob, so a viewer never shows bytes it did not request.
 */
export function downloadData(
    noteOrAttachment: BNote | BAttachment, res: Response, contentDisposition: boolean,
    expectedBlobId?: string
) {
    if (noteOrAttachment.isProtected && !protected_session.isProtectedSessionAvailable()) {
        return res.status(401).send("Protected session not available");
    }

    if (expectedBlobId !== undefined && noteOrAttachment.blobId !== expectedBlobId) {
        return res.setHeader("Content-Type", "text/plain").status(409).send("The content changed.");
    }

    if (contentDisposition) {
        const fileName = noteOrAttachment.getFileName();

        res.setHeader("Content-Disposition", getContentDisposition(fileName));
    }

    res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
    res.setHeader("Content-Type", noteOrAttachment.mime);

    // Without a Content-Disposition the browser renders the response instead of saving it, and an SVG
    // or HTML document runs its scripts in Trilium's origin. A download is left byte-for-byte:
    // `getContentDisposition()` marks it `attachment`, which never renders, and the file the user
    // asked for has to reach the disk as it was stored.
    if (!contentDisposition) {
        if (isSvgMime(noteOrAttachment.mime)) {
            return sendSanitizedSvg(res, noteOrAttachment.getContent());
        }

        setHeaders(res, getInlineContentHeaders(noteOrAttachment.mime));
    }

    res.send(noteService.getPortableContent(noteOrAttachment));
}

/** Serves stored content inline: an SVG sanitized, anything else as is under {@link getInlineContentHeaders}. */
export function sendInlineContent(res: Response, mime: string, content: string | Uint8Array) {
    if (isSvgMime(mime)) {
        return sendSanitizedSvg(res, content);
    }

    setHeaders(res, getInlineContentHeaders(mime));
    res.send(content);
}

/**
 * Serves SVG content stripped of everything that executes, behind a Content-Security-Policy that
 * blocks scripting even if a payload survives {@link sanitizeSvg}, and `nosniff` so the response
 * cannot be re-typed into something scriptable.
 */
export function sendSanitizedSvg(res: Response, content: string | Uint8Array) {
    const svgString = unwrapStringOrBuffer(content);
    res.setHeader("Content-Security-Policy", SVG_CONTENT_SECURITY_POLICY);
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.send(sanitizeSvg(svgString));
}

function setHeaders(res: Response, headers: Record<string, string>) {
    for (const [ name, value ] of Object.entries(headers)) {
        res.setHeader(name, value);
    }
}
