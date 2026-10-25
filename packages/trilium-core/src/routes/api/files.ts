import {
    CANVAS_ATTACHMENT_MIME, getAttachedFileMime, getDrawingPictureTitle, isImageAttachmentRole
} from "@triliumnext/commons";

import { Request, Response } from "../../http_interface";
import becca from "../../becca/becca";
import type BAttachment from "../../becca/entities/battachment";
import type BNote from "../../becca/entities/bnote";
import { getContentJobExecutor } from "../../services/content_jobs/executor.js";
import noteService from "../../services/notes.js";
import { assertOfficePreviewable } from "../../services/office_preview.js";
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
 */
async function getNoteOfficePreview(req: Request<{ noteId: string }>) {
    const note = becca.getNoteOrThrow(req.params.noteId);

    return await previewOffice(note.getContent(), note.mime, req);
}

async function getAttachmentOfficePreview(req: Request<{ attachmentId: string }>) {
    const attachment = becca.getAttachmentOrThrow(req.params.attachmentId);

    return await previewOffice(attachment.getContent(), attachment.mime, req);
}

/** Validates here, so that a bad request answers 400, and converts on the content job executor. */
async function previewOffice(content: string | Uint8Array, mime: string, req: Request) {
    const bytes = assertOfficePreviewable(content, mime);
    return await getContentJobExecutor().run({ kind: "officeToHtml", bytes, mime, options: { trim: isTrimmed(req) } });
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
}
