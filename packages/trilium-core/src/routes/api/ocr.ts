import type { TextRepresentationResponse } from "@triliumnext/commons";
import type { Request } from "express";

import becca from "../../becca/becca.js";
import blobService from "../../services/blob.js";
import { getSql } from "../../services/sql/index.js";

/** The `[status, body]` tuple the result handler turns into a 404. */
type NotFound = [number, { success: false; message: string }];

/**
 * Reading the text OCR pulled out of a note's file.
 *
 * Only the reads are shared. Extracting the text needs the OCR engine, which lives in the server —
 * but the result is stored on the blob and travels with it, so a client that has only synced the
 * database still has the text and can show (and search) it.
 */
function getNoteOCRText(req: Request<{ noteId: string }>): TextRepresentationResponse | NotFound {
    const note = becca.getNote(req.params.noteId);
    if (!note) {
        return [ 404, { success: false, message: "Note not found" } ];
    }

    return getTextRepresentation(note.blobId, !!note.isProtected);
}

/** The attachment counterpart of {@link getNoteOCRText}. */
function getAttachmentOCRText(req: Request<{ attachmentId: string }>): TextRepresentationResponse | NotFound {
    const attachment = becca.getAttachment(req.params.attachmentId);
    if (!attachment) {
        return [ 404, { success: false, message: "Attachment not found" } ];
    }

    return getTextRepresentation(attachment.blobId, !!attachment.isProtected);
}

/**
 * A protected entity's text is stored encrypted, so it is reported as absent rather than shown when
 * there is no protected session to read it with — the same answer the note's own content gives.
 */
function getTextRepresentation(blobId: string | undefined, isProtected: boolean): TextRepresentationResponse {
    let storedText: string | null = null;

    if (blobId) {
        const result = getSql().getRow<{
            textRepresentation: string | null;
        }>(/*sql*/`
            SELECT textRepresentation
            FROM blobs
            WHERE blobId = ?
        `, [ blobId ]);

        if (result) {
            storedText = result.textRepresentation;
        }
    }

    const ocrText = blobService.decryptTextRepresentation(storedText, isProtected);

    return {
        success: true,
        text: ocrText,
        hasOcr: !!ocrText
    };
}

export default {
    getNoteOCRText,
    getAttachmentOCRText
};
