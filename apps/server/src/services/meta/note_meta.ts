import type { NoteType } from "@triliumnext/commons";
import type AttachmentMeta from "./attachment_meta.js";
import type AttributeMeta from "./attribute_meta.js";
import type { ExportFormat } from "../export/zip/abstract_provider.js";

export interface NoteMetaFile {
    formatVersion: number;
    appVersion: string;
    files: NoteMeta[];
}

export default interface NoteMeta {
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
