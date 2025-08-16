"use strict";

import protectedSessionService from "../../services/protected_session.js";
import utils from "../../services/utils.js";
import dateUtils from "../../services/date_utils.js";
import becca from "../becca.js";
import AbstractBeccaEntity from "./abstract_becca_entity.js";
import sql from "../../services/sql.js";
import BAttachment from "./battachment.js";
import type { AttachmentRow, NoteType, RevisionRow } from "@triliumnext/commons";
import eraseService from "../../services/erase.js";

interface ContentOpts {
    /** will also save this BRevision entity */
    forceSave?: boolean;
}

interface GetByIdOpts {
    includeContentLength?: boolean;
}

/**
 * Revision represents a snapshot of note's title and content at some point in the past.
 * It's used for seamless note versioning.
 */
class BRevision extends AbstractBeccaEntity<BRevision> {
    static get entityName() {
        return "revisions";
    }
    static get primaryKeyName() {
        return "revisionId";
    }
    static get hashedProperties() {
        return ["revisionId", "noteId", "title", "isProtected", "dateLastEdited", "dateCreated", "utcDateLastEdited", "utcDateCreated", "utcDateModified", "blobId"];
    }

    revisionId?: string;
    noteId!: string;
    type!: NoteType;
    mime!: string;
    title!: string;
    dateLastEdited?: string;
    utcDateLastEdited?: string;
    contentLength?: number;
    content?: string | Buffer;

    constructor(row: RevisionRow, titleDecrypted = false) {
        super();

        this.updateFromRow(row);
        if (this.isProtected && !titleDecrypted) {
            const decryptedTitle = protectedSessionService.isProtectedSessionAvailable() ? protectedSessionService.decryptString(this.title) : null;
            this.title = decryptedTitle || "[protected]";
        }
    }

    updateFromRow(row: RevisionRow) {
        this.revisionId = row.revisionId;
        this.noteId = row.noteId;
        this.type = row.type;
        this.mime = row.mime;
        this.isProtected = !!row.isProtected;
        this.title = row.title;
        this.blobId = row.blobId;
        this.dateLastEdited = row.dateLastEdited;
        this.dateCreated = row.dateCreated;
        this.utcDateLastEdited = row.utcDateLastEdited;
        this.utcDateCreated = row.utcDateCreated;
        this.utcDateModified = row.utcDateModified;
        this.contentLength = row.contentLength;
    }

    getNote() {
        return becca.notes[this.noteId];
    }

    /** @returns true if the note has string content (not binary) */
    override hasStringContent(): boolean {
        return utils.isStringNote(this.type, this.mime);
    }

    isContentAvailable() {
        return (
            !this.revisionId || // new note which was not encrypted yet
            !this.isProtected ||
            protectedSessionService.isProtectedSessionAvailable()
        );
    }

    /*
     * Note revision content has quite special handling - it's not a separate entity, but a lazily loaded
     * part of Revision entity with its own sync. The reason behind this hybrid design is that
     * content can be quite large, and it's not necessary to load it / fill memory for any note access even
     * if we don't need a content, especially for bulk operations like search.
     *
     * This is the same approach as is used for Note's content.
     */
    getContent(): string | Buffer {
        return this._getContent();
    }

    /**
     * @throws Error in case of invalid JSON */
    getJsonContent(): {} | null {
        const content = this.getContent();

        if (!content || typeof content !== "string" || !content.trim()) {
            return null;
        }

        return JSON.parse(content);
    }

    /** @returns valid object or null if the content cannot be parsed as JSON */
    getJsonContentSafely(): {} | null {
        try {
            return this.getJsonContent();
        } catch (e) {
            return null;
        }
    }

    setContent(content: string | Buffer, opts: ContentOpts = {}) {
        this._setContent(content, opts);
    }

    getAttachments(): BAttachment[] {
        return sql
            .getRows<AttachmentRow>(
                `
                SELECT attachments.*
                FROM attachments
                WHERE ownerId = ?
                AND isDeleted = 0`,
                [this.revisionId]
            )
            .map((row) => new BAttachment(row));
    }

    getAttachmentById(attachmentId: String, opts: GetByIdOpts = {}): BAttachment | null {
        opts.includeContentLength = !!opts.includeContentLength;

        const query = opts.includeContentLength
            ? /*sql*/`SELECT attachments.*, blobs.contentLength AS contentLength
                FROM attachments
                JOIN blobs USING (blobId)
                WHERE ownerId = ? AND attachmentId = ? AND isDeleted = 0`
            : /*sql*/`SELECT * FROM attachments WHERE ownerId = ? AND attachmentId = ? AND isDeleted = 0`;

        return sql.getRows<AttachmentRow>(query, [this.revisionId, attachmentId]).map((row) => new BAttachment(row))[0];
    }

    getAttachmentsByRole(role: string): BAttachment[] {
        return sql
            .getRows<AttachmentRow>(
                `
                SELECT attachments.*
                FROM attachments
                WHERE ownerId = ?
                AND role = ?
                AND isDeleted = 0
                ORDER BY position`,
                [this.revisionId, role]
            )
            .map((row) => new BAttachment(row));
    }

    getAttachmentByTitle(title: string): BAttachment {
        // cannot use SQL to filter by title since it can be encrypted
        return this.getAttachments().filter((attachment) => attachment.title === title)[0];
    }

    /**
     * Revisions are not soft-deletable, they are immediately hard-deleted (erased).
     */
    eraseRevision() {
        if (this.revisionId) {
            eraseService.eraseRevisions([this.revisionId]);
        }
    }

    override beforeSaving() {
        super.beforeSaving();

        this.utcDateModified = dateUtils.utcNowDateTime();
    }

    getPojo() {
        return {
            revisionId: this.revisionId,
            noteId: this.noteId,
            type: this.type,
            mime: this.mime,
            isProtected: this.isProtected,
            title: this.title,
            blobId: this.blobId,
            dateLastEdited: this.dateLastEdited,
            dateCreated: this.dateCreated,
            utcDateLastEdited: this.utcDateLastEdited,
            utcDateCreated: this.utcDateCreated,
            utcDateModified: this.utcDateModified,
            content: this.content, // used when retrieving full note revision to frontend
            contentLength: this.contentLength
        };
    }

    override getPojoToSave() {
        const pojo = this.getPojo();
        delete pojo.content; // not getting persisted
        delete pojo.contentLength; // not getting persisted

        if (pojo.isProtected) {
            if (protectedSessionService.isProtectedSessionAvailable()) {
                pojo.title = protectedSessionService.encrypt(this.title) ?? "";
            } else {
                // updating protected note outside of protected session means we will keep original ciphertexts
                pojo.title = "";
            }
        }

        return pojo;
    }
}

export default BRevision;
