import type { Request } from "express";
import type { NoteRow, NoteType } from "@triliumnext/commons";

import { NotFoundError } from "../../errors.js";
import blobService from "../../services/blob.js";
import protectedSessionService from "../../services/protected_session.js";
import { getSql } from "../../services/sql/index.js";

/**
 * Read-only metadata for a soft-deleted (not-yet-erased) note. Matches the shape the client's
 * `FNoteRow` expects so a detached, tree-less `DeletedFNote` can be built from it without ever
 * loading the note into Froca/Becca.
 */
interface DeletedNoteMetadata {
    noteId: string;
    title: string;
    type: NoteType;
    mime: string;
    blobId: string;
    isProtected: boolean;
}

/**
 * Returns metadata (title, type, mime, blobId, isProtected) for a single soft-deleted note.
 * Throws `NotFoundError` if the note is live or already erased. Protected note titles are decrypted
 * when a protected session is available, otherwise replaced with a placeholder — mirroring recent-changes.
 */
function getDeletedNoteMetadata(req: Request<{ noteId: string }>): DeletedNoteMetadata {
    const { noteId } = req.params;

    const row = getSql().getRowOrNull<Pick<NoteRow, "noteId" | "title" | "type" | "mime" | "blobId" | "isProtected">>(
        /*sql*/ `SELECT noteId, title, type, mime, blobId, isProtected FROM notes WHERE noteId = ? AND isDeleted = 1`,
        [noteId]
    );

    if (!row || !row.blobId || !row.type) {
        throw new NotFoundError(`Deleted note '${noteId}' was not found.`);
    }

    let title = row.title;
    if (row.isProtected) {
        title = protectedSessionService.isProtectedSessionAvailable()
            ? protectedSessionService.decryptString(title) || "[protected]"
            : "[protected]";
    }

    return {
        noteId: row.noteId,
        title,
        type: row.type,
        mime: row.mime,
        blobId: row.blobId,
        isProtected: !!row.isProtected
    };
}

/**
 * Returns the blob (content) of a single soft-deleted note. Delegates to the SQL-backed,
 * protected-aware reader that bypasses Becca. Throws `NotFoundError` if the note is not
 * soft-deleted or its blob has already been erased.
 */
function getDeletedNoteBlob(req: Request<{ noteId: string }>) {
    return blobService.getDeletedNoteBlobPojo(req.params.noteId);
}

export default {
    getDeletedNoteMetadata,
    getDeletedNoteBlob
};
