import type FAttachment from "../entities/fattachment.js";
import type FAttribute from "../entities/fattribute.js";
import type FBlob from "../entities/fblob.js";
import type FBranch from "../entities/fbranch.js";
import type FNote from "../entities/fnote.js";

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
