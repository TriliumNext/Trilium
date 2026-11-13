import {
    CANVAS_ATTACHMENT_MIME, getAttachedFileMime, getDrawingPictureTitle, isImageAttachmentRole
} from "@triliumnext/commons";

import { Request, Response } from "../../http_interface";
import becca from "../../becca/becca";
import type BAttachment from "../../becca/entities/battachment";
import type BNote from "../../becca/entities/bnote";
import noteService from "../../services/notes.js";
import { convertOfficeToHtml, convertXlsxToWorkbook } from "../../services/office_preview.js";
import { getPlatform } from "../../services/platform.js";
import protected_session from "../../services/protected_session";
import { downloadData, downloadNoteInt } from "../helpers";
import { serveContentWithRanges } from "../partial_content";

const downloadFile = (req: Request<{ noteId: string }>, res: Response) => downloadNoteInt(req.params.noteId, res, true);
const openFile = (req: Request<{ noteId: string }>, res: Response) => downloadNoteInt(req.params.noteId, res, false);

const downloadAttachment = (req: Request<{ attachmentId: string }>, res: Response) => downloadAttachmentInt(req.params.attachmentId, res, true);
const openAttachment = (req: Request<{ attachmentId: string }>, res: Response) => downloadAttachmentInt(req.params.attachmentId, res, false);

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
        uploaded: true
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
        uploaded: true
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
    const note = becca.getNoteOrThrow(req.params.noteId);
    await sendConversion(req, res, note, "workbook", "application/json; charset=utf-8",
        () => convertXlsxToWorkbook(note.getContent(), note.mime));
}

async function sendOfficePreview(req: Request, res: Response, entity: BNote | BAttachment) {
    const trim = isTrimmed(req);
    await sendConversion(req, res, entity, trim ? "trim" : "full", "text/html; charset=utf-8",
        () => convertOfficeToHtml(entity.getContent(), entity.mime, { trim }));
}

/**
 * Sends what `convert` makes of the entity's content, under an ETag the server knows before
 * converting anything, so a browser that already holds it gets a 304 without the document being
 * parsed again. `variant` tells apart the conversions of one entity.
 */
async function sendConversion(req: Request, res: Response, entity: BNote | BAttachment, variant: string,
    contentType: string, convert: () => Promise<string>) {
    if (entity.isProtected) {
        // Decrypted content must not reach the browser's disk cache.
        res.setHeader("Cache-Control", "no-store");
    } else {
        const etag = getConversionEtag(entity, variant);
        res.setHeader("Cache-Control", "no-cache");
        res.setHeader("ETag", etag);
        if (matchesEtag(req.headers["if-none-match"], etag)) {
            res.status(304).send();
            return;
        }
    }

    const body = await convert();
    res.setHeader("Content-Type", contentType);
    res.send(body);
}

/**
 * Changes whenever the conversion could: with the content (`blobId` is its hash), the MIME type
 * that picks the converter, the variant, and the server process, since a restart can bring a
 * different converter.
 */
function getConversionEtag(entity: BNote | BAttachment, variant: string) {
    const mime = encodeURIComponent(entity.mime);
    return `"${entity.blobId}-${mime}-${variant}-${PROCESS_TOKEN}"`;
}

const PROCESS_TOKEN = Date.now().toString(36);

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

function downloadAttachmentInt(attachmentId: string, res: Response, contentDisposition = true) {
    const attachment = becca.getAttachment(attachmentId);

    if (!attachment) {
        return res.setHeader("Content-Type", "text/plain").status(404).send(`Attachment '${attachmentId}' doesn't exist.`);
    }

    return downloadData(attachment, res, contentDisposition);
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
}
