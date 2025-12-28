import { AttachmentRow, AttributeRow, BranchRow, NoteRow, NoteType } from "./rows.js";

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
    dateCreated?: string;
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

export interface TOTPStatus {
    set: boolean;
}

export interface TOTPGenerate {
    success: boolean;
    message: string;
}

export interface TOTPRecoveryKeysResponse {
    success: boolean;
    recoveryCodes?: string[];
    keysExist?: boolean;
    usedRecoveryCodes?: string[];
}

export interface OAuthStatus {
    enabled: boolean;
    name?: string;
    email?: string;
    missingVars?: string[];
}

// Interface for the Ollama model response
export interface OllamaModelResponse {
    success: boolean;
    models: Array<{
        name: string;
        model: string;
        details?: {
            family?: string;
            parameter_size?: string;
        }
    }>;
}


export interface OpenAiOrAnthropicModelResponse {
    success: boolean;
    chatModels: Array<{
        id: string;
        name: string;
        type: string;
    }>;
}

export type ToggleInParentResponse = {
    success: true;
} | {
    success: false;
    message: string;
}

export type EditedNotesResponse = {
    noteId: string;
    isDeleted: boolean;
    title?: string;
    notePath?: string[] | null;
}[];

export interface MetadataResponse {
    dateCreated: string | undefined;
    utcDateCreated: string;
    dateModified: string | undefined;
    utcDateModified: string | undefined;
}

export interface NoteSizeResponse {
    noteSize: number;
}

export interface SubtreeSizeResponse {
    subTreeNoteCount: number;
    subTreeSize: number;
}

export interface SimilarNote {
    score: number;
    notePath: string[];
    noteId: string;
}

export type SimilarNoteResponse = (SimilarNote[] | undefined);

export type SaveSearchNoteResponse = CloneResponse;

export interface CloneResponse {
    success: boolean;
    message?: string;
    branchId?: string;
    notePath?: string;
}

export interface ConvertToAttachmentResponse {
    attachment: AttachmentRow;
}

export interface ConvertAttachmentToNoteResponse {
    note: NoteRow;
    branch: BranchRow;
}

export type SaveSqlConsoleResponse = CloneResponse;

export interface BacklinkCountResponse {
    count: number;
}

export type BacklinksResponse = ({
    noteId: string;
    relationName: string;
} | {
    noteId: string;
    excerpts: string[]
})[];


export type SqlExecuteResults = (object[] | object)[];

export interface SqlExecuteResponse {
    success: boolean;
    error?: string;
    results: SqlExecuteResults;
}

export interface CreateChildrenResponse {
    note: NoteRow;
    branch: BranchRow;
}

export interface SchemaResponse {
    name: string;
    columns: {
        name: string;
        type: string;
    }[];
}

export interface RelationMapRelation {
    name: string;
    attributeId: string;
    sourceNoteId: string;
    targetNoteId: string;
}

export interface RelationMapPostResponse {
    noteTitles: Record<string, string>;
    relations: RelationMapRelation[];
    inverseRelations: Record<string, string>;
}

export interface NoteMapLink {
    key: string;
    sourceNoteId: string;
    targetNoteId: string;
    name: string;
}

export interface NoteMapPostResponse {
    notes: string[];
    links: NoteMapLink[];
    noteIdToDescendantCountMap: Record<string, number>;
}

export interface UpdateAttributeResponse {
    attributeId: string;
}

export interface RenderMarkdownResponse {
    htmlContent: string;
}

export interface ToMarkdownResponse {
    markdownContent: string;
}

export interface IconRegistry {
    sources: {
        prefix: string;
        name: string;
        /** An icon class to identify this icon pack. */
        icon: string;
        icons: {
            id: string;
            terms: string[];
        }[]
    }[];
}
