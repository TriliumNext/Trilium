import becca from "../../becca/becca.js";
import blobService from "../../services/blob.js";
import ValidationError from "../../errors/validation_error.js";
import imageService from "../../services/image.js";
import type { Request } from "express";
import { ConvertAttachmentToNoteResponse } from "@triliumnext/commons";

function getAttachmentBlob(req: Request) {
    const preview = req.query.preview === "true";

    return blobService.getBlobPojo("attachments", req.params.attachmentId, { preview });
}

function getAttachments(req: Request) {
    const note = becca.getNoteOrThrow(req.params.noteId);

    return note.getAttachments();
}

function getAttachment(req: Request) {
    const { attachmentId } = req.params;

    return becca.getAttachmentOrThrow(attachmentId);
}

function getAllAttachments(req: Request) {
    const { attachmentId } = req.params;
    // one particular attachment is requested, but return all note's attachments

    const attachment = becca.getAttachmentOrThrow(attachmentId);
    return attachment.getNote()?.getAttachments() || [];
}

function saveAttachment(req: Request) {
    const { noteId } = req.params;
    const { attachmentId, role, mime, title, content } = req.body;
    const matchByQuery = req.query.matchBy
    const isValidMatchBy = (typeof matchByQuery === "string") && (matchByQuery === "attachmentId" || matchByQuery === "title");
    const matchBy = isValidMatchBy ? matchByQuery : undefined;

    const note = becca.getNoteOrThrow(noteId);
    note.saveAttachment({ attachmentId, role, mime, title, content }, matchBy);
}

function uploadAttachment(req: Request) {
    const { noteId } = req.params;
    const { file } = req;

    if (!file) {
        return {
            uploaded: false,
            message: `Missing attachment data.`
        };
    }

    const note = becca.getNoteOrThrow(noteId);
    let url;

    if (["image/png", "image/jpg", "image/jpeg", "image/gif", "image/webp", "image/svg+xml"].includes(file.mimetype)) {
        const attachment = imageService.saveImageToAttachment(noteId, file.buffer, file.originalname, true, true);
        url = `api/attachments/${attachment.attachmentId}/image/${encodeURIComponent(attachment.title)}`;
    } else {
        const attachment = note.saveAttachment({
            role: "file",
            mime: file.mimetype,
            title: file.originalname,
            content: file.buffer
        });

        url = `#root/${noteId}?viewMode=attachments&attachmentId=${attachment.attachmentId}`;
    }

    return {
        uploaded: true,
        url
    };
}

function renameAttachment(req: Request) {
    const { title } = req.body;
    const { attachmentId } = req.params;

    const attachment = becca.getAttachmentOrThrow(attachmentId);

    if (!title?.trim()) {
        throw new ValidationError("Title must not be empty");
    }

    attachment.title = title;
    attachment.save();
}

function deleteAttachment(req: Request) {
    const { attachmentId } = req.params;

    const attachment = becca.getAttachment(attachmentId);

    if (attachment) {
        attachment.markAsDeleted();
    }
}

function convertAttachmentToNote(req: Request) {
    const { attachmentId } = req.params;

    const attachment = becca.getAttachmentOrThrow(attachmentId);
    return attachment.convertToNote() satisfies ConvertAttachmentToNoteResponse;
}

export default {
    getAttachmentBlob,
    getAttachments,
    getAttachment,
    getAllAttachments,
    saveAttachment,
    uploadAttachment,
    renameAttachment,
    deleteAttachment,
    convertAttachmentToNote
};
