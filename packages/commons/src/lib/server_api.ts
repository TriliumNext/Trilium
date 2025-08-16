import { AttributeRow, NoteType } from "./rows.js";

type Response = {
    success: true,
    message?: string;
} | {
    success: false;
    message: string;
}

export interface AppInfo {
    appVersion: string;
    dbVersion: number;
    nodeVersion: string;
    syncVersion: number;
    buildDate: string;
    buildRevision: string;
    dataDirectory: string;
    clipperProtocolVersion: string;
    /** for timezone inference */
    utcDateTime: string;
}

export interface DeleteNotesPreview {
    noteIdsToBeDeleted: string[];
    brokenRelations: AttributeRow[];
}

export interface RevisionItem {
    noteId: string;
    revisionId?: string;
    dateLastEdited?: string;
    contentLength?: number;
    type: NoteType;
    title: string;
    isProtected?: boolean;
    mime: string;
}

export interface RevisionPojo {
    revisionId?: string;
    noteId: string;
    type: NoteType;
    mime: string;
    isProtected?: boolean;
    title: string;
    blobId?: string;
    dateLastEdited?: string;
    dateCreated?: string;
    utcDateLastEdited?: string;
    utcDateCreated?: string;
    utcDateModified?: string;
    content?: string | Buffer<ArrayBufferLike>;
    contentLength?: number;
}

export interface RecentChangeRow {
    noteId: string;
    current_isDeleted: boolean;
    current_deleteId: string;
    current_title: string;
    current_isProtected: boolean;
    title: string;
    utcDate: string;
    date: string;
    canBeUndeleted?: boolean;
}

export interface BulkActionAffectedNotes {
    affectedNoteCount: number;
}

export interface DatabaseCheckIntegrityResponse {
    results: {
        integrity_check: string;
    }[];
}

export interface DatabaseAnonymizeResponse {
    success: boolean;
    anonymizedFilePath: string;
}

export interface AnonymizedDbResponse {
    filePath: string;
    fileName: string;
}

export type SyncTestResponse = Response;

export interface EtapiToken {
    name: string;
    utcDateCreated: string;
    etapiTokenId?: string;
}

export interface PostTokensResponse {
    authToken: string;
}

export interface BackupDatabaseNowResponse {
    backupFile: string;
}

export interface DatabaseBackup {
    fileName: string;
    filePath: string;
    mtime: Date;
}

export type ChangePasswordResponse = Response;
