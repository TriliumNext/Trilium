"use strict";

import sql from "../../sql.js";
import utils from "../../../services/utils.js";
import blobStorageService from "../../../services/blob-storage.js";
import AbstractShacaEntity from "./abstract_shaca_entity.js";
import type SNote from "./snote.js";
import type { Blob } from "../../../services/blob-interface.js";
import type { SAttachmentRow } from "./rows.js";

class SAttachment extends AbstractShacaEntity {
    private attachmentId: string;
    ownerId: string;
    title: string;
    role: string;
    mime: string;
    private blobId: string;
    /** used for caching of images */
    private utcDateModified: string;

    constructor([attachmentId, ownerId, role, mime, title, blobId, utcDateModified]: SAttachmentRow) {
        super();

        this.attachmentId = attachmentId;
        this.ownerId = ownerId;
        this.title = title;
        this.role = role;
        this.mime = mime;
        this.blobId = blobId;
        this.utcDateModified = utcDateModified;

        this.shaca.attachments[this.attachmentId] = this;
        this.shaca.notes[this.ownerId].attachments.push(this);
    }

    get note(): SNote {
        return this.shaca.notes[this.ownerId];
    }

    getContent(silentNotFoundError = false) {
        const row = sql.getRow<Pick<Blob, "content" | "contentLocation">>(/*sql*/`SELECT content, contentLocation FROM blobs WHERE blobId = ?`, [this.blobId]);

        if (!row) {
            if (silentNotFoundError) {
                return undefined;
            } else {
                throw new Error(`Cannot find blob for attachment '${this.attachmentId}', blob '${this.blobId}'`);
            }
        }

        const content = blobStorageService.getContent(row);

        if (this.hasStringContent()) {
            return content === null ? "" : content.toString("utf-8");
        } else {
            return content;
        }
    }

    /** @returns true if the attachment has string content (not binary) */
    hasStringContent() {
        return utils.isStringNote(undefined, this.mime);
    }

    getPojo() {
        return {
            attachmentId: this.attachmentId,
            role: this.role,
            mime: this.mime,
            title: this.title,
            blobId: this.blobId,
            utcDateModified: this.utcDateModified
        };
    }
}

export default SAttachment;
