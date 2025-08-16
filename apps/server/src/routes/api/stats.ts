import sql from "../../services/sql.js";
import becca from "../../becca/becca.js";
import type { Request } from "express";

function getNoteSize(req: Request) {
    const { noteId } = req.params;

    const blobSizes = sql.getMap<string, number>(
        `
        SELECT blobs.blobId, blobs.contentLength
        FROM blobs
        LEFT JOIN notes ON notes.blobId = blobs.blobId AND notes.noteId = ? AND notes.isDeleted = 0
        LEFT JOIN attachments ON attachments.blobId = blobs.blobId AND attachments.ownerId = ? AND attachments.isDeleted = 0
        LEFT JOIN revisions ON revisions.blobId = blobs.blobId AND revisions.noteId = ?
        WHERE notes.noteId IS NOT NULL
            OR attachments.attachmentId IS NOT NULL
            OR revisions.revisionId IS NOT NULL`,
        [noteId, noteId, noteId]
    );

    const noteSize = Object.values(blobSizes).reduce((acc, blobSize) => acc + blobSize, 0);

    return {
        noteSize
    };
}

function getSubtreeSize(req: Request) {
    const note = becca.getNoteOrThrow(req.params.noteId);

    const subTreeNoteIds = note.getSubtreeNoteIds();

    sql.fillParamList(subTreeNoteIds);

    const blobSizes = sql.getMap<string, number>(`
        SELECT blobs.blobId, blobs.contentLength
        FROM param_list
        JOIN notes ON notes.noteId = param_list.paramId AND notes.isDeleted = 0
        LEFT JOIN attachments ON attachments.ownerId = param_list.paramId AND attachments.isDeleted = 0
        LEFT JOIN revisions ON revisions.noteId = param_list.paramId
        JOIN blobs ON blobs.blobId = notes.blobId OR blobs.blobId = attachments.blobId OR blobs.blobId = revisions.blobId`);

    const subTreeSize = Object.values(blobSizes).reduce((acc, blobSize) => acc + blobSize, 0);

    return {
        subTreeSize,
        subTreeNoteCount: subTreeNoteIds.length
    };
}

export default {
    getNoteSize,
    getSubtreeSize
};
