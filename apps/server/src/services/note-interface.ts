import type { AttributeRow, NoteType } from "@triliumnext/commons";

export interface NoteParams {
    /** optionally can force specific noteId */
    noteId?: string;
    branchId?: string;
    parentNoteId: string;
    templateNoteId?: string;
    title: string;
    content: string | Buffer;
    /** text, code, file, image, search, book, relationMap, canvas, webView */
    type: NoteType;
    /** default value is derived from default mimes for type */
    mime?: string;
    /** default is false */
    isProtected?: boolean;
    /** default is false */
    isExpanded?: boolean;
    /** default is empty string */
    prefix?: string;
    /** default is the last existing notePosition in a parent + 10 */
    notePosition?: number;
    dateCreated?: string;
    utcDateCreated?: string;
    ignoreForbiddenParents?: boolean;
    target?: "into";
    /** Attributes to be set on the note. These are set atomically on note creation, so entity changes are not sent for attributes defined here. */
    attributes?: Omit<AttributeRow, "noteId" | "attributeId">[];
}
