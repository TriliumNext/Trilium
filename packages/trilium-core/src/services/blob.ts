import { BlobRow, EMPTY_BLOB_ID, NoteRow } from "@triliumnext/commons";
import becca from "../becca/becca.js";
import { NotFoundError } from "../errors";
import protectedSessionService from "./protected_session.js";
import { getSql } from "./sql/index.js";
import { decodeUtf8 } from "./utils/binary.js";
import { hash, isStringNote } from "./utils/index.js";

function getBlobPojo(entityName: string, entityId: string, opts?: { preview: boolean }) {
    // TODO: Unused opts.
    const entity = becca.getEntity(entityName, entityId);
    if (!entity) {
        throw new NotFoundError(`Entity ${entityName} '${entityId}' was not found.`);
    }

    const blob = becca.getBlob(entity);
    if (!blob) {
        throw new NotFoundError(`Blob ${entity.blobId} for ${entityName} '${entityId}' was not found.`);
    }

    const pojo = blob.getPojo();

    // A sync stub: the blob carries empty content but its (content-derived) blobId is not the hash of
    // empty content — i.e. its real content was withheld by the sync server because it exceeded this
    // device's `syncMaxBlobContentSize`. Detected before content is decoded/nulled below, off the raw
    // stored length. The client shows an "open on server" placeholder instead of empty content.
    const isStubbed = pojo.contentLength === 0 && pojo.blobId !== EMPTY_BLOB_ID;

    if (!entity.hasStringContent()) {
        pojo.content = null;
    } else {
        pojo.content = processContent(pojo.content, !!entity.isProtected, true) as string | Uint8Array;
    }

    return { ...pojo, isStubbed };
}

/**
 * Produces a blob POJO for a soft-deleted (not-yet-erased) note. The normal {@link getBlobPojo}
 * path resolves the note through Becca, which never contains deleted notes — so this reads the
 * soft-deleted `notes` row and its blob directly via SQL instead, without ever loading the note
 * into the cache. Gated on `isDeleted = 1`, so it cannot be used to read live notes.
 *
 * Protected content is decrypted exactly like the normal path: via {@link processContent}, which
 * returns the decrypted content when a protected session is available and an empty string otherwise.
 */
function getDeletedNoteBlobPojo(noteId: string) {
    const sql = getSql();

    const noteRow = sql.getRowOrNull<Pick<NoteRow, "isProtected" | "type" | "mime" | "blobId">>(
        /*sql*/ `SELECT isProtected, type, mime, blobId FROM notes WHERE noteId = ? AND isDeleted = 1`,
        [noteId]
    );

    if (!noteRow || !noteRow.blobId) {
        throw new NotFoundError(`Deleted note '${noteId}' was not found.`);
    }

    const blobRow = sql.getRowOrNull<BlobRow>(/*sql*/ `SELECT *, LENGTH(content) AS contentLength FROM blobs WHERE blobId = ?`, [noteRow.blobId]);

    if (!blobRow) {
        // The note is deleted but its blob has already been erased.
        throw new NotFoundError(`Blob '${noteRow.blobId}' for deleted note '${noteId}' was not found.`);
    }

    const pojo = {
        blobId: blobRow.blobId,
        content: blobRow.content as string | Uint8Array | null,
        contentLength: blobRow.contentLength,
        dateModified: blobRow.dateModified,
        utcDateModified: blobRow.utcDateModified
    };

    const isStubbed = pojo.contentLength === 0 && pojo.blobId !== EMPTY_BLOB_ID;

    if (!isStringNote(noteRow.type, noteRow.mime)) {
        pojo.content = null;
    } else {
        pojo.content = processContent(pojo.content, !!noteRow.isProtected, true);
    }

    return { ...pojo, isStubbed };
}

function processContent(content: Uint8Array | string | null, isProtected: boolean, isStringContent: boolean) {
    if (isProtected) {
        if (protectedSessionService.isProtectedSessionAvailable()) {
            content = content === null ? null : protectedSessionService.decrypt(content as Uint8Array);
        } else {
            content = "";
        }
    }

    if (isStringContent) {
        if (content === null) return "";
        return decodeUtf8(content);
    }
    // see https://github.com/zadam/trilium/issues/3523
    // IIRC a zero-sized buffer can be returned as null from the database
    if (content === null) {
        // this will force de/encryption
        content = new Uint8Array(0);
    }

    return content;
}

function calculateContentHash({ blobId, content, textRepresentation }: Pick<BlobRow, "blobId" | "content" | "textRepresentation">) {
    const textRepresentationSegment = textRepresentation ? `|${textRepresentation}` : "";
    return hash(`${blobId}|${content.toString()}${textRepresentationSegment}`);
}

export default {
    getBlobPojo,
    getDeletedNoteBlobPojo,
    processContent,
    calculateContentHash
};
