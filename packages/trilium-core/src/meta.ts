import type { AttributeType, NoteType } from "@triliumnext/commons";

export type ExportFormat = "html" | "markdown" | "share";

export interface AttachmentMeta {
    attachmentId?: string;
    title: string;
    role: string;
    mime: string;
    position?: number;
    dataFileName: string;
}

export interface AttributeMeta {
    noteId?: string;
    type: AttributeType;
    name: string;
    value: string;
    isInheritable?: boolean;
    position?: number;
}

export interface NoteMetaFile {
    formatVersion: number;
    appVersion: string;
    files: NoteMeta[];
}

export interface NoteMeta {
    noteId?: string;
    notePath?: string[];
    isClone?: boolean;
    title?: string;
    notePosition?: number;
    prefix?: string | null;
    isExpanded?: boolean;
    type?: NoteType;
    mime?: string;
    /** 'html' or 'markdown', applicable to text notes only */
    format?: ExportFormat;
    dataFileName?: string;
    dirFileName?: string;
    /** this file should not be imported (e.g., HTML navigation) */
    noImport?: boolean;
    isImportRoot?: boolean;
    attributes?: AttributeMeta[];
    attachments?: AttachmentMeta[];
    children?: NoteMeta[];
}
