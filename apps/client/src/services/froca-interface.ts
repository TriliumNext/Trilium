import type FAttachment from "../entities/fattachment.js";
import type { FAttachmentRow } from "../entities/fattachment.js";
import type FAttribute from "../entities/fattribute.js";
import type { FAttributeRow } from "../entities/fattribute.js";
import type FBlob from "../entities/fblob.js";
import type { FBlobRow } from "../entities/fblob.js";
import type FBranch from "../entities/fbranch.js";
import type { FBranchRow } from "../entities/fbranch.js";
import type FNote from "../entities/fnote.js";
import type { FNoteRow } from "../entities/fnote.js";

/** The rows of notes with their branches and attributes, which `froca.addResp()` takes. */
export interface SubtreeResponse {
    notes: FNoteRow[];
    branches: FBranchRow[];
    attributes: FAttributeRow[];
}

/**
 * Where froca reads the notes, attachments and blobs it does not hold yet. The app reads them from
 * its API; a page hosting an app view outside the app, such as a shared page, sets its own with
 * `froca.setSource()`.
 */
export interface FrocaSource {
    loadNotes(noteIds: string[]): Promise<SubtreeResponse>;
    /** The attachments of the note owning `attachmentId`; rejects if there is no such attachment. */
    getSiblingAttachments(attachmentId: string): Promise<FAttachmentRow[]>;
    getAttachments(noteId: string): Promise<FAttachmentRow[]>;
    getBlob(entityType: string, entityId: string): Promise<FBlobRow>;
}

export interface Froca {
    notes: Record<string, FNote>;
    branches: Record<string, FBranch>;
    attributes: Record<string, FAttribute>;
    attachments: Record<string, FAttachment>;
    blobPromises: Record<string, Promise<void | FBlob | null> | null>;

    getBlob(entityType: string, entityId: string): Promise<FBlob | null>;
    getNote(noteId: string, silentNotFoundError?: boolean): Promise<FNote | null>;
    getNoteFromCache(noteId: string): FNote | undefined;
    getNotesFromCache(noteIds: string[], silentNotFoundError?: boolean): FNote[];
    getNotes(noteIds: string[], silentNotFoundError?: boolean): Promise<FNote[]>;

    getBranch(branchId: string, silentNotFoundError?: boolean): FBranch | undefined;
    getBranches(branchIds: string[], silentNotFoundError?: boolean): FBranch[];

    getAttachmentsForNote(noteId: string): Promise<FAttachment[]>;
}
