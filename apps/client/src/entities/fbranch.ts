import type { Froca } from "../services/froca-interface.js";

export interface FBranchRow {
    branchId: string;
    noteId: string;
    parentNoteId: string;
    notePosition: number;
    prefix?: string;
    isExpanded?: boolean;
    fromSearchNote: boolean;
    isDeleted?: boolean;
}

/**
 * Branch represents a relationship between a child note and its parent note. Trilium allows a note to have multiple
 * parents.
 */
class FBranch {
    private froca: Froca;

    branchId!: string;
    noteId!: string;
    parentNoteId!: string;
    notePosition!: number;
    prefix?: string;
    isExpanded?: boolean;
    fromSearchNote!: boolean;

    constructor(froca: Froca, row: FBranchRow) {
        this.froca = froca;

        this.update(row);
    }

    update(row: FBranchRow) {
        /**
         * primary key
         */
        this.branchId = row.branchId;
        this.noteId = row.noteId;
        this.parentNoteId = row.parentNoteId;
        this.notePosition = row.notePosition;
        this.prefix = row.prefix;
        this.isExpanded = !!row.isExpanded;
        this.fromSearchNote = !!row.fromSearchNote;
    }

    async getNote() {
        return this.froca.getNote(this.noteId);
    }

    getNoteFromCache() {
        return this.froca.getNoteFromCache(this.noteId);
    }

    async getParentNote() {
        return this.froca.getNote(this.parentNoteId);
    }

    isTopLevel() {
        return this.parentNoteId === "root";
    }

    get toString() {
        return `FBranch(branchId=${this.branchId})`;
    }

    get pojo(): Omit<FBranch, "froca"> {
        const pojo = { ...this } as any;
        delete pojo.froca;
        return pojo;
    }
}

export default FBranch;
