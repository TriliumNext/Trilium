import {
    ConvertAttachmentToNoteResponse, getAttachedFileMime, isAcceptedImageMime,
    type SaveConflictResponse, type SavedAttachmentBase
} from "@triliumnext/commons";
import { DetailedConflictError, ValidationError } from "../../errors";
import type { Request } from "../../http_interface";

import becca from "../../becca/becca.js";
import type BAttachment from "../../becca/entities/battachment.js";
import type BNote from "../../becca/entities/bnote.js";
import { answerConflict } from "../helpers.js";
import blobService from "../../services/blob.js";
import imageService from "../../services/image.js";
import { wrapStringOrBuffer } from "../../services/utils/binary.js";

function getAttachmentBlob(req: Request<{ attachmentId: string }>) {
    const preview = req.query.preview === "true";

    return blobService.getBlobPojo("attachments", req.params.attachmentId, { preview });
}

function getAttachments(req: Request<{ noteId: string }>) {
    const note = becca.getNoteOrThrow(req.params.noteId);

    return note.getAttachments();
}

function getAttachment(req: Request<{ attachmentId: string }>) {
    const { attachmentId } = req.params;

    return becca.getAttachmentOrThrow(attachmentId);
}

function getAllAttachments(req: Request<{ attachmentId: string }>) {
    const { attachmentId } = req.params;
    // one particular attachment is requested, but return all note's attachments

    const attachment = becca.getAttachmentOrThrow(attachmentId);
    return attachment.getNote()?.getAttachments() || [];
}

/**
 * Saves an attachment of a note. With a `blobId`, the blob that the attachment it replaces was
 * read at, the save is refused with 409 when that attachment has another blob now, and the answer
 * is the attachment as saved; with `keepOther` as well, the note keeps its version as a revision
 * first. Without a `blobId`, the save is unconditional, with an empty answer.
 */
function saveAttachment(req: Request<{ noteId: string }>) {
    const { noteId } = req.params;
    const { attachmentId, role, mime, title, content, blobId, keepOther } = req.body;
    const matchByQuery = req.query.matchBy;
    const isValidMatchBy = (typeof matchByQuery === "string") && (matchByQuery === "attachmentId" || matchByQuery === "title");
    const matchBy = isValidMatchBy ? matchByQuery : undefined;
    const row = { attachmentId, role, mime, title, content };

    const note = becca.getNoteOrThrow(noteId);
    if (blobId === undefined) {
        if (keepOther !== undefined && keepOther !== false) {
            throw new ValidationError("A save that keeps its version needs its 'blobId'.");
        }
        note.saveAttachment(row, matchBy);
        return;
    }
    if (typeof blobId !== "string") {
        throw new ValidationError("Expected the 'blobId' that the attachment was read at.");
    }

    return answerConflict(() => {
        const replaced = matchBy === "title"
            ? note.getAttachmentByTitle(title)
            : (attachmentId ? becca.getAttachment(attachmentId) : null);
        if (replaced && replaced.blobId !== blobId) {
            throw createAttachmentConflict(note, replaced);
        }
        if (keepOther === true && note.isVersioned()) {
            note.saveRevision();
        }
        return toSavedAttachment(note.saveAttachment(row, matchBy));
    });
}

async function uploadAttachment(req: Request<{ noteId: string }>) {
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

    // Convert buffer to Uint8Array (Buffer extends Uint8Array, string needs encoding)
    const buffer = wrapStringOrBuffer(file.buffer as string | Uint8Array);

    // With `link=true`, the response links to the attachment and a picture is stored as uploaded.
    const isLinkRequested = req.query.link === "true";

    if (isAcceptedImageMime(file.mimetype)) {
        // Always the user's own image: the pictures the app fetches for itself — a link preview's
        // favicon and cover — are stored by the code that fetched them, never uploaded through here.
        const attachment = imageService.saveImageToAttachment(
            noteId,
            buffer,
            file.originalname,
            !isLinkRequested,
            !isLinkRequested
        );

        // The URL below is fetched the moment this answers — the editor puts it straight into the
        // document as the source of an image. Answering before the bytes are stored hands it the
        // address of an empty attachment, which draws as a broken image and stays broken until
        // something reloads the note. So this one image is waited for; nothing else is.
        await imageService.awaitImageWrite(attachment.attachmentId);

        const { attachmentId, title } = attachment;
        url = isLinkRequested
            ? getAttachmentLinkUrl(noteId, attachmentId)
            : `api/attachments/${attachmentId}/image/${encodeURIComponent(title)}`;
    } else {
        const attachment = note.saveAttachment({
            role: "file",
            mime: getAttachedFileMime(file.originalname, file.mimetype),
            title: file.originalname,
            content: file.buffer
        });

        url = getAttachmentLinkUrl(noteId, attachment.attachmentId);
    }

    return {
        uploaded: true,
        url
    };
}

function getAttachmentLinkUrl(noteId: string, attachmentId: string | undefined) {
    return `#root/${noteId}?viewMode=attachments&attachmentId=${attachmentId}`;
}

/** The answer of 409 to a save of an attachment based on a blob that `attachment` has not. */
function createAttachmentConflict(note: BNote, attachment: BAttachment) {
    const message = `Attachment '${attachment.attachmentId}' of note '${note.noteId}' has `
        + "changed since the version that the save is based on.";
    return new DetailedConflictError<SaveConflictResponse>(message, {
        reason: "version",
        message,
        blobId: note.blobId as string,
        type: note.type,
        mime: note.mime,
        isVersioned: note.isVersioned(),
        attachments: [ toSavedAttachment(attachment) ]
    });
}

/** `attachment` as a save left it, which it has an ID and a blob after. */
function toSavedAttachment({ attachmentId, title, blobId }: BAttachment): SavedAttachmentBase {
    return { attachmentId: attachmentId as string, title, blobId: blobId as string };
}

function renameAttachment(req: Request<{ attachmentId: string }>) {
    const { title } = req.body;
    const { attachmentId } = req.params;

    const attachment = becca.getAttachmentOrThrow(attachmentId);

    if (!title?.trim()) {
        throw new ValidationError("Title must not be empty");
    }

    attachment.title = title;
    attachment.save();
}

function deleteAttachment(req: Request<{ attachmentId: string }>) {
    const { attachmentId } = req.params;

    const attachment = becca.getAttachment(attachmentId);

    if (attachment) {
        attachment.markAsDeleted();
    }
}

function convertAttachmentToNote(req: Request<{ attachmentId: string }>) {
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
