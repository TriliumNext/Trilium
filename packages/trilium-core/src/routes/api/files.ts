import { Request, Response } from "express";
import becca from "../../becca/becca";
import { convertOfficeToHtml } from "../../services/office_preview.js";
import { downloadData, downloadNoteInt } from "../helpers";

const downloadFile = (req: Request<{ noteId: string }>, res: Response) => downloadNoteInt(req.params.noteId, res, true);
const openFile = (req: Request<{ noteId: string }>, res: Response) => downloadNoteInt(req.params.noteId, res, false);

const downloadAttachment = (req: Request<{ attachmentId: string }>, res: Response) => downloadAttachmentInt(req.params.attachmentId, res, true);
const openAttachment = (req: Request<{ attachmentId: string }>, res: Response) => downloadAttachmentInt(req.params.attachmentId, res, false);

/**
 * Converts an office document note/attachment to an embeddable HTML fragment for the
 * inline preview shown by the client. The returned HTML is unsanitized — the client
 * sanitizes it before injecting it into the DOM.
 */
async function getNoteOfficePreview(req: Request<{ noteId: string }>) {
    const note = becca.getNoteOrThrow(req.params.noteId);

    return { html: await convertOfficeToHtml(note.getContent(), note.mime) };
}

async function getAttachmentOfficePreview(req: Request<{ attachmentId: string }>) {
    const attachment = becca.getAttachmentOrThrow(req.params.attachmentId);

    return { html: await convertOfficeToHtml(attachment.getContent(), attachment.mime) };
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
    openAttachment,
    downloadAttachment,
    getNoteOfficePreview,
    getAttachmentOfficePreview,
}
