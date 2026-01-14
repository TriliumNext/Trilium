

import type { BranchRow } from "@triliumnext/commons";

import dateUtils from "../../services/utils/date";
import handlers from "../../services/handlers.js";
import { getLog } from "../../services/log.js";
import TaskContext from "../../services/task_context.js";
import AbstractBeccaEntity from "./abstract_becca_entity.js";
import BNote from "./bnote.js";
import { getHoistedNoteId } from "../../services/context";
import { randomString } from "../../services/utils";

/**
 * Branch represents a relationship between a child note and its parent note. Trilium allows a note to have multiple
 * parents.
 *
 * Note that you should not rely on the branch's identity, since it can change easily with a note's move.
 * Always check noteId instead.
 */
class BBranch extends AbstractBeccaEntity<BBranch> {
    static get entityName() {
        return "branches";
    }
    static get primaryKeyName() {
        return "branchId";
    }
    // notePosition is not part of hash because it would produce a lot of updates in case of reordering
    static get hashedProperties() {
        return ["branchId", "noteId", "parentNoteId", "prefix"];
    }

    branchId?: string;
    noteId!: string;
    parentNoteId!: string;
    prefix!: string | null;
    notePosition!: number;
    isExpanded!: boolean;

    constructor(row?: BranchRow) {
        super();

        if (!row) {
            return;
        }

        this.updateFromRow(row);
        this.init();
    }

    updateFromRow(row: BranchRow) {
        this.update([row.branchId, row.noteId, row.parentNoteId, row.prefix, row.notePosition, row.isExpanded, row.utcDateModified]);
    }

    update([branchId, noteId, parentNoteId, prefix, notePosition, isExpanded, utcDateModified]: any) {
        this.branchId = branchId;
        this.noteId = noteId;
        this.parentNoteId = parentNoteId;
        this.prefix = prefix;
        this.notePosition = notePosition;
        this.isExpanded = !!isExpanded;
        this.utcDateModified = utcDateModified;

        return this;
    }

    override init() {
        if (this.branchId) {
            this.becca.branches[this.branchId] = this;
        }

        this.becca.childParentToBranch[`${this.noteId}-${this.parentNoteId}`] = this;

        const childNote = this.childNote;

        if (!childNote.parentBranches.includes(this)) {
            childNote.parentBranches.push(this);
        }

        if (this.noteId === "root") {
            return;
        }

        const parentNote = this.parentNote;
        if (parentNote) {
            if (!childNote.parents.includes(parentNote)) {
                childNote.parents.push(parentNote);
            }

            if (!parentNote.children.includes(childNote)) {
                parentNote.children.push(childNote);
            }
        }
    }

    get childNote(): BNote {
        if (!(this.noteId in this.becca.notes)) {
            // entities can come out of order in sync/import, create skeleton which will be filled later
            this.becca.addNote(this.noteId, new BNote({ noteId: this.noteId }));
        }

        return this.becca.notes[this.noteId];
    }

    getNote(): BNote {
        return this.childNote;
    }

    /** @returns root branch will have undefined parent, all other branches have to have a parent note */
    get parentNote(): BNote | undefined {
        if (!(this.parentNoteId in this.becca.notes) && this.parentNoteId !== "none") {
            // entities can come out of order in sync/import, create skeleton which will be filled later
            this.becca.addNote(this.parentNoteId, new BNote({ noteId: this.parentNoteId }));
        }

        return this.becca.notes[this.parentNoteId];
    }

    override get isDeleted() {
        return this.branchId == undefined || !(this.branchId in this.becca.branches);
    }

    /**
     * Branch is weak when its existence should not hinder deletion of its note.
     * As a result, note with only weak branches should be immediately deleted.
     * An example is shared or bookmarked clones - they are created automatically and exist for technical reasons,
     * not as user-intended actions. From user perspective, they don't count as real clones and for the purpose
     * of deletion should not act as a clone.
     */
    get isWeak() {
        return ["_share", "_lbBookmarks"].includes(this.parentNoteId);
    }

    /**
     * Delete a branch. If this is a last note's branch, delete the note as well.
     *
     * @param deleteId - optional delete identified
     *
     * @returns true if note has been deleted, false otherwise
     */
    deleteBranch(deleteId?: string, taskContext?: TaskContext<"deleteNotes">): boolean {
        if (!deleteId) {
            deleteId = randomString(10);
        }

        if (!taskContext) {
            taskContext = new TaskContext("no-progress-reporting", "deleteNotes", null);
        }

        taskContext.increaseProgressCount();

        const note = this.getNote();

        if (!taskContext.noteDeletionHandlerTriggered) {
            const parentBranches = note.getParentBranches();

            if (parentBranches.length === 1 && parentBranches[0] === this) {
                // needs to be run before branches and attributes are deleted and thus attached relations disappear
                handlers.runAttachedRelations(note, "runOnNoteDeletion", note);
            }
        }

        if ((this.noteId === "root" || this.noteId === getHoistedNoteId()) && !this.isWeak) {
            throw new Error("Can't delete root or hoisted branch/note");
        }

        this.markAsDeleted(deleteId);

        const notDeletedBranches = note.getStrongParentBranches();

        if (notDeletedBranches.length === 0) {
            for (const weakBranch of note.getParentBranches()) {
                weakBranch.markAsDeleted(deleteId);
            }

            for (const childBranch of note.getChildBranches()) {
                if (childBranch) {
                    childBranch.deleteBranch(deleteId, taskContext);
                }
            }

            // first delete children and then parent - this will show up better in recent changes

            getLog().info(`Deleting note '${note.noteId}'`);

            this.becca.notes[note.noteId].isBeingDeleted = true;

            for (const attribute of note.getOwnedAttributes().slice()) {
                attribute.markAsDeleted(deleteId);
            }

            for (const relation of note.getTargetRelations()) {
                relation.markAsDeleted(deleteId);
            }

            for (const attachment of note.getAttachments()) {
                attachment.markAsDeleted(deleteId);
            }

            note.markAsDeleted(deleteId);

            return true;
        }
        return false;

    }

    override beforeSaving() {
        if (!this.noteId || !this.parentNoteId) {
            throw new Error(`noteId and parentNoteId are mandatory properties for Branch`);
        }

        this.branchId = `${this.parentNoteId}_${this.noteId}`;

        if (this.notePosition === undefined || this.notePosition === null) {
            let maxNotePos = 0;

            if (this.parentNote) {
                for (const childBranch of this.parentNote.getChildBranches()) {
                    if (!childBranch) {
                        continue;
                    }

                    if (
                        maxNotePos < childBranch.notePosition &&
                        childBranch.noteId !== "_hidden" // hidden has a very large notePosition to always stay last
                    ) {
                        maxNotePos = childBranch.notePosition;
                    }
                }
            }

            this.notePosition = maxNotePos + 10;
        }

        if (!this.isExpanded) {
            this.isExpanded = false;
        }

        if (!this.prefix?.trim()) {
            this.prefix = null;
        }

        this.utcDateModified = dateUtils.utcNowDateTime();

        super.beforeSaving();

        this.becca.branches[this.branchId] = this;
    }

    getPojo() {
        return {
            branchId: this.branchId,
            noteId: this.noteId,
            parentNoteId: this.parentNoteId,
            prefix: this.prefix,
            notePosition: this.notePosition,
            isExpanded: this.isExpanded,
            isDeleted: false,
            utcDateModified: this.utcDateModified
        };
    }

    createClone(parentNoteId: string, notePosition?: number) {
        const existingBranch = this.becca.getBranchFromChildAndParent(this.noteId, parentNoteId);

        if (existingBranch) {
            if (notePosition) {
                existingBranch.notePosition = notePosition;
            }
            return existingBranch;
        }
        return new BBranch({
            noteId: this.noteId,
            parentNoteId,
            notePosition: notePosition || null,
            prefix: this.prefix,
            isExpanded: this.isExpanded
        });

    }

    getParentNote() {
        return this.parentNote;
    }

}

export default BBranch;
