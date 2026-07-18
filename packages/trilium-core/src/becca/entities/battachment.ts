

import type { AttachmentRow } from "@triliumnext/commons";

import dateUtils from "../../services/utils/date";
import { getLog } from "../../services/log.js";
import noteService from "../../services/notes.js";
import protectedSessionService from "../../services/protected_session.js";
import AbstractBeccaEntity from "./abstract_becca_entity.js";
import type BBranch from "./bbranch.js";
import type BNote from "./bnote.js";
import { getSql } from "../../services/sql/index.js";
import { escapeRegExp, formatDownloadTitle, isStringNote, replaceAll } from "../../services/utils";

const attachmentRoleToNoteTypeMapping = {
    image: "image",
    file: "file"
};

interface ContentOpts {
    // TODO: Found in bnote.ts, to check if it's actually used and not a typo.
    forceSave?: boolean;

    /** will also save this BAttachment entity */
    forceFullSave?: boolean;
    /** override frontend heuristics on when to reload, instruct to reload */
    forceFrontendReload?: boolean;
}

/**
 * Attachment represent data related/attached to the note. Conceptually similar to attributes, but intended for
 * larger amounts of data and generally not accessible to the user.
 */
class BAttachment extends AbstractBeccaEntity<BAttachment> {
    static get entityName() {
        return "attachments";
    }
    static get primaryKeyName() {
        return "attachmentId";
    }
    static get hashedProperties() {
        return ["attachmentId", "ownerId", "role", "mime", "title", "blobId", "utcDateScheduledForErasureSince"];
    }

    noteId?: number;
    attachmentId?: string;
    /** either noteId or revisionId to which this attachment belongs */
    ownerId!: string;
    role!: string;
    mime!: string;
    title!: string;
    type?: keyof typeof attachmentRoleToNoteTypeMapping;
    position?: number;
    utcDateScheduledForErasureSince?: string | null;
    /** optionally added to the entity */
    contentLength?: number;
    isDecrypted?: boolean;

    constructor(row: AttachmentRow) {
        super();

        this.updateFromRow(row);
        this.decrypt();
    }

    updateFromRow(row: AttachmentRow): void {
        if (!row.ownerId?.trim()) {
            throw new Error("'ownerId' must be given to initialize a Attachment entity");
        } else if (!row.role?.trim()) {
            throw new Error("'role' must be given to initialize a Attachment entity");
        } else if (!row.mime?.trim()) {
            throw new Error("'mime' must be given to initialize a Attachment entity");
        } else if (!row.title?.trim()) {
            throw new Error("'title' must be given to initialize a Attachment entity");
        }

        this.attachmentId = row.attachmentId;
        this.ownerId = row.ownerId;
        this.role = row.role;
        this.mime = row.mime;
        this.title = row.title;
        this.position = row.position;
        this.blobId = row.blobId;
        this.isProtected = !!row.isProtected;
        this.dateModified = row.dateModified;
        this.utcDateModified = row.utcDateModified;
        this.utcDateScheduledForErasureSince = row.utcDateScheduledForErasureSince;
        this.contentLength = row.contentLength;
    }

    copy(): BAttachment {
        return new BAttachment({
            ownerId: this.ownerId,
            role: this.role,
            mime: this.mime,
            title: this.title,
            blobId: this.blobId,
            isProtected: this.isProtected
        });
    }

    getNote(): BNote {
        return this.becca.notes[this.ownerId];
    }

    /** @returns true if the note has string content (not binary) */
    override hasStringContent(): boolean {
        return isStringNote(this.type, this.mime); // here was !== undefined && utils.isStringNote(this.type, this.mime); I dont know why we need !=undefined. But it filters out canvas libary items
    }

    isContentAvailable() {
        return (
            !this.attachmentId || // new attachment which was not encrypted yet
            !this.isProtected ||
            protectedSessionService.isProtectedSessionAvailable()
        );
    }

    getTitleOrProtected() {
        return this.isContentAvailable() ? this.title : "[protected]";
    }

    decrypt() {
        if (!this.isProtected || !this.attachmentId) {
            this.isDecrypted = true;
            return;
        }

        if (!this.isDecrypted && protectedSessionService.isProtectedSessionAvailable()) {
            try {
                this.title = protectedSessionService.decryptString(this.title) || "";
                this.isDecrypted = true;
            } catch (e: any) {
                getLog().error(`Could not decrypt attachment ${this.attachmentId}: ${e.message} ${e.stack}`);
            }
        }
    }

    getContent(): Uint8Array {
        return this._getContent() as Uint8Array;
    }

    setContent(content: string | Uint8Array, opts?: ContentOpts) {
        this._setContent(content, opts);
    }

    convertToNote(): { note: BNote; branch: BBranch } {
        // TODO: can this ever be "search"?
        if ((this.type as string) === "search") {
            throw new Error(`Note of type search cannot have child notes`);
        }

        if (!this.getNote()) {
            throw new Error("Cannot find note of this attachment. It is possible that this is note revision's attachment. " + "Converting note revision's attachments to note is not (yet) supported.");
        }

        if (!(this.role in attachmentRoleToNoteTypeMapping)) {
            throw new Error(`Mapping from attachment role '${this.role}' to note's type is not defined`);
        }

        if (!this.isContentAvailable()) {
            // isProtected is the same for attachment
            throw new Error(`Cannot convert protected attachment outside of protected session`);
        }

        const { note, branch } = noteService.createNewNote({
            parentNoteId: this.ownerId,
            title: this.title,
            type: (attachmentRoleToNoteTypeMapping as any)[this.role],
            mime: this.mime,
            content: this.getContent(),
            isProtected: this.isProtected
        });

        const attachmentId = this.attachmentId;

        this.markAsDeleted();

        const parentNote = this.getNote();

        if (parentNote.type === "text") {
            const origContent = parentNote.getContent();

            if (typeof origContent !== "string") {
                throw new Error(`Note with ID '${note.noteId}' has a text type but non-string content.`);
            }

            let fixedContent = origContent;

            if (this.role === "image") {
                // Rewrite embedded images (`<img src="api/attachments/{attachmentId}/image/...">`)
                // to point at the new image note.
                const oldAttachmentUrl = `api/attachments/${attachmentId}/image/`;
                const newNoteUrl = `api/images/${note.noteId}/`;

                fixedContent = replaceAll(fixedContent, oldAttachmentUrl, newNoteUrl);
            }

            // Rewrite reference links to the attachment so they point at the new note instead of
            // resolving to "[missing attachment]" once the attachment is gone. These links are stored
            // as `<a href="#root/{ownerId}?viewMode=attachments&attachmentId={attachmentId}">` (the `&`
            // may be HTML-encoded as `&amp;`), which we collapse to a plain note link `#root/{noteId}`.
            if (attachmentId) {
                fixedContent = fixedContent.replace(
                    new RegExp(`href="[^"]*attachmentId=${escapeRegExp(attachmentId)}[^"]*"`, "g"),
                    `href="#root/${note.noteId}"`
                );
            }

            if (fixedContent !== origContent) {
                parentNote.setContent(fixedContent);
            }

            // Re-scan the parent (not the new image/file note, which has no scannable links) so its
            // link relations are updated to reflect the rewritten URLs and reference links.
            noteService.asyncPostProcessContent(parentNote, fixedContent);
        }

        return { note, branch };
    }

    getFileName() {
        const type = this.role === "image" ? "image" : "file";

        return formatDownloadTitle(this.title, type, this.mime);
    }

    override beforeSaving() {
        super.beforeSaving();

        if (this.position === undefined || this.position === null) {
            this.position =
                10 +
                getSql().getValue<number>(
                    /*sql*/`SELECT COALESCE(MAX(position), 0)
                                                        FROM attachments
                                                        WHERE ownerId = ?`,
                    [this.noteId]
                );
        }

        this.dateModified = dateUtils.localNowDateTime();
        this.utcDateModified = dateUtils.utcNowDateTime();
    }

    getPojo() {
        return {
            attachmentId: this.attachmentId,
            ownerId: this.ownerId,
            role: this.role,
            mime: this.mime,
            title: this.title || undefined,
            position: this.position,
            blobId: this.blobId,
            isProtected: !!this.isProtected,
            isDeleted: false,
            dateModified: this.dateModified,
            utcDateModified: this.utcDateModified,
            utcDateScheduledForErasureSince: this.utcDateScheduledForErasureSince,
            contentLength: this.contentLength
        };
    }

    override getPojoToSave() {
        const pojo = this.getPojo();
        delete pojo.contentLength;

        if (pojo.isProtected) {
            if (this.isDecrypted) {
                pojo.title = protectedSessionService.encrypt(pojo.title || "") || undefined;
            } else {
                // updating protected note outside of protected session means we will keep original ciphertexts
                delete pojo.title;
            }
        }

        return pojo;
    }
}

export default BAttachment;
