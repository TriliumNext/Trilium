"use strict";

import AbstractShacaEntity from "./abstract_shaca_entity.js";
import type { SBranchRow } from "./rows.js";
import type SNote from "./snote.js";

class SBranch extends AbstractShacaEntity {
    private branchId: string;
    private noteId: string;
    parentNoteId: string;
    private prefix: string;
    private isExpanded: boolean;
    isHidden: boolean;

    constructor([branchId, noteId, parentNoteId, prefix, isExpanded]: SBranchRow) {
        super();

        this.branchId = branchId;
        this.noteId = noteId;
        this.parentNoteId = parentNoteId;
        this.prefix = prefix;
        this.isExpanded = !!isExpanded;
        this.isHidden = false;

        const childNote = this.childNote;
        const parentNote = this.parentNote;

        if (!childNote.parents.includes(parentNote)) {
            childNote.parents.push(parentNote);
        }

        if (!childNote.parentBranches.includes(this)) {
            childNote.parentBranches.push(this);
        }

        if (!parentNote.children.includes(childNote)) {
            parentNote.children.push(childNote);
        }

        this.shaca.branches[this.branchId] = this;
        this.shaca.childParentToBranch[`${this.noteId}-${this.parentNoteId}`] = this;
    }

    get childNote(): SNote {
        return this.shaca.notes[this.noteId];
    }

    getNote() {
        return this.childNote;
    }

    get parentNote(): SNote {
        return this.shaca.notes[this.parentNoteId];
    }

    getParentNote() {
        return this.parentNote;
    }
}

export default SBranch;
