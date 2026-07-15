import type { Froca } from "../services/froca-interface.js";

export interface FAttachmentRow {
    attachmentId: string;
    ownerId: string;
    role: string;
    mime: string;
    title: string;
    /** Content-addressed id of the backing blob; changes exactly when the content does. */
    blobId?: string;
    dateModified: string;
    utcDateModified: string;
    utcDateScheduledForErasureSince: string;
    contentLength: number;
}

/**
 * Attachment is a file directly tied into a note without
 * being a hidden child.
 */
class FAttachment {
    private froca: Froca;
    attachmentId!: string;
    ownerId!: string;
    role!: string;
    mime!: string;
    title!: string;
    blobId?: string;
    isProtected!: boolean; // TODO: Is this used?
    private dateModified!: string;
    utcDateModified!: string;
    utcDateScheduledForErasureSince!: string;
    /**
     * optionally added to the entity
     */
    contentLength!: number;

    constructor(froca: Froca, row: FAttachmentRow) {
        /** @type {Froca} */
        this.froca = froca;

        this.update(row);
    }

    update(row: FAttachmentRow) {
        this.attachmentId = row.attachmentId;
        this.ownerId = row.ownerId;
        this.role = row.role;
        this.mime = row.mime;
        this.title = row.title;
        this.blobId = row.blobId;
        this.dateModified = row.dateModified;
        this.utcDateModified = row.utcDateModified;
        this.utcDateScheduledForErasureSince = row.utcDateScheduledForErasureSince;
        this.contentLength = row.contentLength;

        this.froca.attachments[this.attachmentId] = this;
    }

    getNote() {
        return this.froca.notes[this.ownerId];
    }

    async getBlob() {
        return await this.froca.getBlob("attachments", this.attachmentId);
    }
}

export default FAttachment;
