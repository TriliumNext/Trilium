import { Request, Response } from "express";
import becca from "../../becca/becca";
import { downloadData, downloadNoteInt } from "../helpers";

const downloadFile = (req: Request<{ noteId: string }>, res: Response) => downloadNoteInt(req.params.noteId, res, true);
const openFile = (req: Request<{ noteId: string }>, res: Response) => downloadNoteInt(req.params.noteId, res, false);

const downloadAttachment = (req: Request<{ attachmentId: string }>, res: Response) => downloadAttachmentInt(req.params.attachmentId, res, true);
const openAttachment = (req: Request<{ attachmentId: string }>, res: Response) => downloadAttachmentInt(req.params.attachmentId, res, false);

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
}
