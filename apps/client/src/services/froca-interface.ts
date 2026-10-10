import type { NoteMapPostResponse, RelationMapPostResponse } from "@triliumnext/commons";

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

/** The relations a note map draws or leaves out, by name; an empty `includeRelations` draws all. */
export interface NoteMapFilters {
    excludeRelations: string[];
    includeRelations: string[];
}

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
    /** The ids of the notes below `ancestorNoteId` that match the search `query`. */
    searchNoteIds(query: string, ancestorNoteId: string): Promise<string[]>;
    /** The notes and the links of the note map of `mapRootNoteId`, as a tree or as its relations. */
    getNoteMap(mapRootNoteId: string, mapType: "tree" | "link", filters: NoteMapFilters): Promise<NoteMapPostResponse>;
    /** The relations the relation map note `relationMapNoteId` draws between the notes `noteIds`. */
    getRelationMap(relationMapNoteId: string, noteIds: string[]): Promise<RelationMapPostResponse>;
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
    searchNoteIds(query: string, ancestorNoteId: string): Promise<string[]>;
    getNoteMap(mapRootNoteId: string, mapType: "tree" | "link", filters: NoteMapFilters): Promise<NoteMapPostResponse>;
    getRelationMap(relationMapNoteId: string, noteIds: string[]): Promise<RelationMapPostResponse>;
}
