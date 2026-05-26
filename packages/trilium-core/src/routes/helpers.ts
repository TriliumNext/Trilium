import { Response } from "express";
import becca from "../becca/becca";
import BNote from "../becca/entities/bnote";
import protected_session from "../services/protected_session";
import BAttachment from "../becca/entities/battachment";
import { getContentDisposition } from "../services/utils/index";

export function downloadNoteInt(noteId: string, res: Response, contentDisposition = true) {
    const note = becca.getNote(noteId);

    if (!note) {
        return res.setHeader("Content-Type", "text/plain").status(404).send(`Note '${noteId}' doesn't exist.`);
    }

    return downloadData(note, res, contentDisposition);
}

export function downloadData(noteOrAttachment: BNote | BAttachment, res: Response, contentDisposition: boolean) {
    if (noteOrAttachment.isProtected && !protected_session.isProtectedSessionAvailable()) {
        return res.status(401).send("Protected session not available");
    }

    if (contentDisposition) {
        const fileName = noteOrAttachment.getFileName();

        res.setHeader("Content-Disposition", getContentDisposition(fileName));
    }

    res.setHeader("Cache-Control", "no-cache, no-store, must-revalidate");
    res.setHeader("Content-Type", noteOrAttachment.mime);

    res.send(noteOrAttachment.getContent());
}
