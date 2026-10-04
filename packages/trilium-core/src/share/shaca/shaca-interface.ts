import type SAttachment from "./entities/sattachment.js";
import type SAttribute from "./entities/sattribute.js";
import type SBranch from "./entities/sbranch.js";
import type SNote from "./entities/snote.js";

export default class Shaca {
    notes!: Record<string, SNote>;
    branches!: Record<string, SBranch>;
    childParentToBranch!: Record<string, SBranch>;
    attributes!: Record<string, SAttribute>;
    attachments!: Record<string, SAttachment>;
    aliasToNote!: Record<string, SNote>;
    shareRootNote!: SNote | null;
    /** true if the index of all shared subtrees is enabled */
    shareIndexEnabled!: boolean;
    loaded!: boolean;

    constructor() {
        this.reset();
    }

    reset() {
        this.notes = {};
        this.branches = {};
        this.childParentToBranch = {};
        this.attributes = {};
        this.attachments = {};
        this.aliasToNote = {};

        this.shareRootNote = null;

        this.shareIndexEnabled = false;

        this.loaded = false;
    }

    getNote(noteId: string) {
        return this.notes[noteId];
    }

    hasNote(noteId: string) {
        return noteId in this.notes;
    }

    getNotes(noteIds: string[], ignoreMissing = false) {
        const filteredNotes: SNote[] = [];

        for (const noteId of noteIds) {
            const note = this.notes[noteId];

            if (!note) {
                if (ignoreMissing) {
                    continue;
                }

                throw new Error(`Note '${noteId}' was not found in shaca.`);
            }

            filteredNotes.push(note);
        }

        return filteredNotes;
    }

    getBranch(branchId: string) {
        return this.branches[branchId];
    }

    getBranchFromChildAndParent(childNoteId: string, parentNoteId: string) {
        return this.childParentToBranch[`${childNoteId}-${parentNoteId}`];
    }

    getAttribute(attributeId: string) {
        return this.attributes[attributeId];
    }

    getAttachment(attachmentId: string) {
        return this.attachments[attachmentId];
    }

    getEntity(entityName: string, entityId: string) {
        if (!entityName || !entityId) {
            return null;
        }

        const camelCaseEntityName = entityName.toLowerCase().replace(/(_[a-z])/g, (group) => group.toUpperCase().replace("_", ""));

        return (this as any)[camelCaseEntityName][entityId];
    }
}
