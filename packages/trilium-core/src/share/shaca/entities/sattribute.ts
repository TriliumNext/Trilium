"use strict";

import AbstractShacaEntity from "./abstract_shaca_entity.js";
import type { SAttributeRow } from "./rows.js";
import type SNote from "./snote.js";

class SAttribute extends AbstractShacaEntity {
    attributeId: string;
    private noteId: string;
    type: string;
    name: string;
    private position: number;
    value: string;
    isInheritable: boolean;

    constructor([attributeId, noteId, type, name, value, isInheritable, position]: SAttributeRow) {
        super();

        this.attributeId = attributeId;
        this.noteId = noteId;
        this.type = type;
        this.name = name;
        this.position = position;
        this.value = value;
        this.isInheritable = !!isInheritable;

        this.shaca.attributes[this.attributeId] = this;
        this.shaca.notes[this.noteId].ownedAttributes.push(this);

        const targetNote = this.targetNote;

        if (targetNote) {
            targetNote.targetRelations.push(this);
        }

        if (this.type === "relation" && this.name === "imageLink") {
            const linkedChildNote = this.note.getChildNotes().find((childNote) => childNote.noteId === this.value);

            if (linkedChildNote) {
                const branch = this.shaca.getBranchFromChildAndParent(linkedChildNote.noteId, this.noteId);

                branch.isHidden = true;
            }
        }

        if (this.type === "label" && this.name === "shareAlias" && this.value.trim()) {
            this.shaca.aliasToNote[this.value.trim()] = this.note;
        }

        if (this.type === "label" && this.name === "shareRoot") {
            this.shaca.shareRootNote = this.note;
        }

        if (this.type === "label" && this.name === "shareIndex") {
            this.shaca.shareIndexEnabled = true;
        }
    }

    get isAffectingSubtree() {
        return this.isInheritable || (this.type === "relation" && ["template", "inherit"].includes(this.name));
    }

    get targetNoteId() {
        // alias
        return this.type === "relation" ? this.value : undefined;
    }

    isAutoLink() {
        return this.type === "relation" && ["internalLink", "imageLink", "relationMapLink", "includeNoteLink"].includes(this.name);
    }

    get note(): SNote {
        return this.shaca.notes[this.noteId];
    }

    get targetNote(): SNote | null | undefined {
        if (this.type === "relation") {
            return this.shaca.notes[this.value];
        }
    }

    getNote(): SNote | null {
        return this.shaca.getNote(this.noteId);
    }

    getTargetNote(): SNote | null {
        if (this.type !== "relation") {
            throw new Error(`Attribute '${this.attributeId}' is not relation`);
        }

        if (!this.value) {
            return null;
        }

        return this.shaca.getNote(this.value);
    }

    getPojo() {
        return {
            attributeId: this.attributeId,
            noteId: this.noteId,
            type: this.type,
            name: this.name,
            position: this.position,
            value: this.value,
            isInheritable: this.isInheritable
        };
    }
}

export default SAttribute;
