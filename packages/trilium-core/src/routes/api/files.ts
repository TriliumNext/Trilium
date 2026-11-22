import {
    CANVAS_ATTACHMENT_MIME, getAttachedFileMime, getDrawingPictureTitle, isImageAttachmentRole
} from "@triliumnext/commons";

import { Request, Response } from "../../http_interface";
import becca from "../../becca/becca";
import type BAttachment from "../../becca/entities/battachment";
import type BNote from "../../becca/entities/bnote";
import appInfo from "../../services/app_info.js";
import noteService from "../../services/notes.js";
import { convertOfficeToHtml, convertXlsxToWorkbook } from "../../services/office_preview.js";
import { getPlatform } from "../../services/platform.js";
import protected_session from "../../services/protected_session";
import type { TocPassOutcome } from "../../services/toc/epub.js";
import { getTocFormatOf, markTocHeadings } from "../../services/toc/index.js";
import { isDev } from "../../services/utils/index.js";
import { downloadData, downloadNoteInt } from "../helpers";
import { serveContentWithRanges } from "../partial_content";

const downloadFile = (req: Request<{ noteId: string }>, res: Response) => downloadNoteInt(req.params.noteId, res, true);
const openFile = (req: Request<{ noteId: string }>, res: Response) =>
    downloadNoteInt(req.params.noteId, res, false, getExpectedBlobId(req));

const downloadAttachment = (req: Request<{ attachmentId: string }>, res: Response) => downloadAttachmentInt(req.params.attachmentId, res, true);
const openAttachment = (req: Request<{ attachmentId: string }>, res: Response) =>
    downloadAttachmentInt(req.params.attachmentId, res, false, getExpectedBlobId(req));

/**
 * Serves a note's content with byte-range support, which is what an `<audio>`/`<video>` element
 * streams from: it seeks by asking for the range it needs instead of downloading the whole file.
 */
function openPartialFile(req: Request<{ noteId: string }>, res: Response) {
    const note = becca.getNote(req.params.noteId);

    if (!note) {
        return res.setHeader("Content-Type", "text/plain").status(404).send(`Note '${req.params.noteId}' doesn't exist.`);
    }

    return openPartialInt(note, req, res);
}

/** The attachment counterpart of {@link openPartialFile}. */
function openPartialAttachment(req: Request<{ attachmentId: string }>, res: Response) {
    const attachment = becca.getAttachment(req.params.attachmentId);

    if (!attachment) {
        return res.setHeader("Content-Type", "text/plain").status(404).send(`Attachment '${req.params.attachmentId}' doesn't exist.`);
    }

    return openPartialInt(attachment, req, res);
}

/**
 * Writes an uploaded file over a file note's content: what "upload new revision" sends, and what the
 * PDF viewer saves annotations through. `replace=1` writes straight over the content — for an editor
 * saving its own work, where a revision per save would bury the note in them.
 */
function updateFile(req: Request<{ noteId: string }>) {
    const note = becca.getNoteOrThrow(req.params.noteId);

    const file = req.file;
    if (!file) {
        return {
            uploaded: false,
            message: `Missing file.`
        };
    }

    if (req.query.replace !== "1") {
        note.saveRevision();
    }

    note.mime = file.mimetype.toLowerCase();
    note.save();

    note.setContent(file.buffer);

    note.setLabel("originalFileName", file.originalname);

    void noteService.asyncPostProcessContent(note, file.buffer);

    return {
        uploaded: true,
        blobId: note.blobId
    };
}

/** The attachment counterpart of {@link updateFile}: replacing an attachment's file with another. */
function updateAttachment(req: Request<{ attachmentId: string }>) {
    const attachment = becca.getAttachmentOrThrow(req.params.attachmentId);
    const file = req.file;
    if (!file) {
        return {
            uploaded: false,
            message: `Missing file.`
        };
    }

    const note = attachment.getNote();
    const wasDrawing = attachment.mime === CANVAS_ATTACHMENT_MIME;
    note.saveRevision();

    attachment.mime = getAttachedFileMime(file.originalname, file.mimetype.toLowerCase());
    attachment.setContent(file.buffer, { forceSave: true });
    if (wasDrawing) {
        // A shared page links the drawing until an edit saves a picture of the new file.
        const picture = note.getAttachmentByTitle(getDrawingPictureTitle(req.params.attachmentId));
        if (picture && isImageAttachmentRole(picture.role)) {
            picture.markAsDeleted();
        }
    }

    return {
        uploaded: true,
        blobId: attachment.blobId
    };
}

/**
 * Converts an office document note/attachment to an embeddable HTML fragment for the
 * inline preview shown by the client. The returned HTML is unsanitized — the client
 * sanitizes it before injecting it into the DOM.
 *
 * The fragment is sent as the response body rather than wrapped in a JSON object: a
 * spreadsheet preview runs to megabytes, and an envelope would escape every attribute
 * quote and make the client parse the whole document before it can use it.
 *
 * `?trim=1` answers with the corner of a workbook instead of the whole of it, for a caller
 * showing a card rather than the document.
 *
 * A preview carries an ETag the server knows before converting anything, so a browser that
 * already holds it gets a 304 without the document being parsed again.
 */
async function getNoteOfficePreview(req: Request<{ noteId: string }>, res: Response) {
    await sendOfficePreview(req, res, becca.getNoteOrThrow(req.params.noteId));
}

async function getAttachmentOfficePreview(req: Request<{ attachmentId: string }>, res: Response) {
    await sendOfficePreview(req, res, becca.getAttachmentOrThrow(req.params.attachmentId));
}

/**
 * Parses an XLSX file note into the workbook JSON a spreadsheet note stores, which the client
 * shows in a read-only spreadsheet. Answers 400 for anything that is not a workbook.
 */
async function getNoteSpreadsheetWorkbook(req: Request<{ noteId: string }>, res: Response) {
    await sendWorkbook(req, res, becca.getNoteOrThrow(req.params.noteId));
}

async function getAttachmentSpreadsheetWorkbook(req: Request<{ attachmentId: string }>, res: Response) {
    await sendWorkbook(req, res, becca.getAttachmentOrThrow(req.params.attachmentId));
}

async function sendWorkbook(req: Request, res: Response, entity: BNote | BAttachment) {
    const source = takeSnapshot(entity);
    await sendConversion(req, res, source, "workbook", "application/json; charset=utf-8",
        (content) => convertXlsxToWorkbook(content, source.mime));
}

/**
 * Sends the preview of an office document, with the ids of its headings written in when its ToC
 * format reads them. The format depends on the note's type or the attachment's role as well as on
 * the MIME type, so the variant names it. A preview whose ToC pass failed is sent uncached, since
 * the next request can mark it. With `?blobId=`, responds with 409 `{ reason: "changed" }` without
 * converting anything when the document has another blob.
 */
async function sendOfficePreview(req: Request, res: Response, entity: BNote | BAttachment) {
    const trim = isTrimmed(req);
    const source = takeSnapshot(entity);
    const expectedBlobId = getExpectedBlobId(req);
    if (expectedBlobId !== undefined && expectedBlobId !== source.blobId) {
        const message = "The document changed since its blob was read.";
        res.status(409).send({ reason: "changed", message });
        return;
    }
    const format = getTocFormatOf(entity);
    const variant = [ trim ? "trim" : "full", format?.name ].filter(Boolean).join("-");
    await sendConversion(req, res, source, variant, "text/html; charset=utf-8", async (content) => {
        let tocPass: TocPassOutcome | undefined;
        const html = await convertOfficeToHtml(content, source.mime, {
            trim,
            onTocPass: (outcome) => {
                tocPass = outcome;
            }
        });
        const { blobId, isProtected } = source;
        const body = await markTocHeadings(format, html, { blobId, isProtected, content, tocPass });
        return tocPass?.status === "failed" ? { body, isCacheable: false } : body;
    });
}

/** What a conversion reads of a note or attachment, read in one synchronous step. */
interface ConversionSource {
    entity: BNote | BAttachment;
    mime: string;
    blobId: string;
    isProtected: boolean;
}

/**
 * The parts of `entity` that a conversion depends on, as they are now. A note is becca's one
 * `BNote`, which a request can change while a conversion awaits.
 */
function takeSnapshot(entity: BNote | BAttachment): ConversionSource {
    const { mime, blobId, isProtected } = entity;
    return { entity, mime, blobId: String(blobId), isProtected: !!isProtected };
}

/**
 * Sends what `convert` makes of the content of `source`, under an ETag the server knows before
 * converting anything, so a browser that already holds it gets a 304 without the document being
 * parsed again. `variant` tells apart the conversions of one entity. The content is read in the
 * same synchronous step as `source`, so the body is the conversion of the blob that the ETag names.
 *
 * A protected entity's body, and one that `convert` marks not cacheable, is sent with `no-store`
 * and without any ETag: it goes out through `write()` and `end()`, since Express's `send()` adds a
 * weak ETag of its own and answers 304 to a request that names it.
 */
async function sendConversion(
    req: Request, res: Response, source: ConversionSource, variant: string, contentType: string,
    convert: (content: string | Uint8Array) => Promise<string | UncacheableBody>
) {
    if (!source.isProtected) {
        const etag = getConversionEtag(source, variant);
        res.setHeader("Cache-Control", "no-cache");
        res.setHeader("ETag", etag);
        if (matchesEtag(req.headers["if-none-match"], etag)) {
            res.status(304).send();
            return;
        }
    }

    const result = await convert(source.entity.getContent());
    res.setHeader("Content-Type", contentType);
    if (typeof result === "string" && !source.isProtected) {
        res.send(result);
        return;
    }
    // Decrypted content must not reach the browser's disk cache, and a preview whose ToC pass
    // failed must not stay in it.
    res.setHeader("Cache-Control", "no-store");
    res.removeHeader("ETag");
    res.write(typeof result === "string" ? result : result.body);
    res.end();
}

/** A conversion that the browser must not keep, such as a preview whose ToC pass failed. */
interface UncacheableBody {
    body: string;
    isCacheable: false;
}

/**
 * Changes whenever the conversion could: with the content (`blobId` is its hash), the MIME type
 * that picks the converter, the variant, and the code that converts.
 */
function getConversionEtag({ blobId, mime }: ConversionSource, variant: string) {
    return `"${blobId}-${encodeURIComponent(mime)}-${variant}-${getConverterToken()}"`;
}

/**
 * Identifies the code that converts. A build carries its version and the commit it was built
 * from, which outlive a restart. A dev checkout's build info is a placeholder that stays the same
 * as the converter changes, so it uses the time the server started instead.
 */
function getConverterToken() {
    return isDev() ? DEV_SERVER_START : `${appInfo.appVersion}-${appInfo.buildRevision}`;
}

const DEV_SERVER_START = Date.now().toString(36);

/** Whether an `If-None-Match` header names `etag`, compared weakly as RFC 9110 requires for it. */
function matchesEtag(header: string | string[] | undefined, etag: string) {
    const values = (Array.isArray(header) ? header.join(",") : header ?? "")
        .split(",")
        .map((value) => value.trim().replace(/^W\//, ""));
    return values.includes(etag) || values.includes("*");
}

/**
 * Whether the caller asked for the corner of the document rather than all of it, which a note
 * list does for every card it shows. The answer varies with the query, and so does the URL, so a
 * trimmed preview and a whole one never share a cache entry.
 */
function isTrimmed(req: Request): boolean {
    return req.query.trim === "1";
}

/** The blob that the caller requests with `?blobId=`, if any. */
function getExpectedBlobId(req: Request) {
    const { blobId } = req.query;
    return typeof blobId === "string" ? blobId : undefined;
}

/** The most a `bytes=N-` request for media is answered with in standalone. */
const STANDALONE_OPEN_RANGE_LENGTH = 8 * 1024 * 1024;

function openPartialInt(noteOrAttachment: BNote | BAttachment, req: Request, res: Response) {
    if (noteOrAttachment.isProtected && !protected_session.isProtectedSessionAvailable()) {
        return res.status(401).send("Protected session not available");
    }

    return serveContentWithRanges(req, res, {
        content: noteOrAttachment.getContent(),
        fileName: noteOrAttachment.getFileName(),
        mimeType: noteOrAttachment.mime,
        // blobId is a content hash, so it is a stable ETag that changes only when the content does.
        etag: noteOrAttachment.blobId,
        // In standalone every response is buffered whole on the page and, in the mobile shells,
        // copied through a native bridge, so the rest of a large video cannot go out at once.
        maxOpenRangeLength: getPlatform().isStandalone ? STANDALONE_OPEN_RANGE_LENGTH : undefined
    });
}

function downloadAttachmentInt(
    attachmentId: string, res: Response, contentDisposition = true, expectedBlobId?: string
) {
    const attachment = becca.getAttachment(attachmentId);

    if (!attachment) {
        return res.setHeader("Content-Type", "text/plain").status(404).send(`Attachment '${attachmentId}' doesn't exist.`);
    }

    return downloadData(attachment, res, contentDisposition, expectedBlobId);
}

export default {
    openFile,
    downloadFile,
    openPartialFile,
    openPartialAttachment,
    updateFile,
    updateAttachment,
    openAttachment,
    downloadAttachment,
    getNoteOfficePreview,
    getAttachmentOfficePreview,
    getNoteSpreadsheetWorkbook,
    getAttachmentSpreadsheetWorkbook,
}
