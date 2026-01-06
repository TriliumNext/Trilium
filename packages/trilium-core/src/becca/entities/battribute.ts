"use strict";

import BNote from "./bnote.js";
import AbstractBeccaEntity from "./abstract_becca_entity.js";
import dateUtils from "../../services/utils/date";
import promotedAttributeDefinitionParser from "../../services/promoted_attribute_definition_parser.js";
import type { AttributeRow, AttributeType } from "@triliumnext/commons";
import { sanitizeAttributeName } from "src/services/utils/index.js";

interface SavingOpts {
    skipValidation?: boolean;
}

/**
 * Attribute is an abstract concept which has two real uses - label (key - value pair)
 * and relation (representing named relationship between source and target note)
 */
class BAttribute extends AbstractBeccaEntity<BAttribute> {
    static get entityName() {
        return "attributes";
    }
    static get primaryKeyName() {
        return "attributeId";
    }
    static get hashedProperties() {
        return ["attributeId", "noteId", "type", "name", "value", "isInheritable"];
    }

    attributeId!: string;
    noteId!: string;
    type!: AttributeType;
    name!: string;
    position!: number;
    value!: string;
    isInheritable!: boolean;

    constructor(row?: AttributeRow) {
        super();

        if (!row) {
            return;
        }

        this.updateFromRow(row);
        this.init();
    }

    updateFromRow(row: AttributeRow) {
        this.update([row.attributeId, row.noteId, row.type, row.name, row.value, row.isInheritable, row.position, row.utcDateModified]);
    }

    update([attributeId, noteId, type, name, value, isInheritable, position, utcDateModified]: any) {
        this.attributeId = attributeId;
        this.noteId = noteId;
        this.type = type;
        this.name = name;
        this.position = position;
        this.value = value || "";
        this.isInheritable = !!isInheritable;
        this.utcDateModified = utcDateModified;

        return this;
    }

    override init() {
        if (this.attributeId) {
            this.becca.attributes[this.attributeId] = this;
        }

        if (!(this.noteId in this.becca.notes)) {
            // entities can come out of order in sync, create skeleton which will be filled later
            this.becca.addNote(this.noteId, new BNote({ noteId: this.noteId }));
        }

        this.becca.notes[this.noteId].ownedAttributes.push(this);

        const key = `${this.type}-${this.name.toLowerCase()}`;
        this.becca.attributeIndex[key] = this.becca.attributeIndex[key] || [];
        this.becca.attributeIndex[key].push(this);

        const targetNote = this.targetNote;

        if (targetNote) {
            targetNote.targetRelations.push(this);
        }
    }

    validate() {
        if (!["label", "relation"].includes(this.type)) {
            throw new Error(`Invalid attribute type '${this.type}' in attribute '${this.attributeId}' of note '${this.noteId}'`);
        }

        if (!this.name?.trim()) {
            throw new Error(`Invalid empty name in attribute '${this.attributeId}' of note '${this.noteId}'`);
        }

        if (this.type === "relation" && !(this.value in this.becca.notes)) {
            throw new Error(`Cannot save relation '${this.name}' of note '${this.noteId}' since it targets not existing note '${this.value}'.`);
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

    get note() {
        return this.becca.notes[this.noteId];
    }

    get targetNote() {
        if (this.type === "relation") {
            return this.becca.notes[this.value];
        }
    }

    getNote() {
        const note = this.becca.getNote(this.noteId);

        if (!note) {
            throw new Error(`Note '${this.noteId}' of attribute '${this.attributeId}', type '${this.type}', name '${this.name}' does not exist.`);
        }

        return note;
    }

    getTargetNote() {
        if (this.type !== "relation") {
            throw new Error(`Attribute '${this.attributeId}' is not a relation.`);
        }

        if (!this.value) {
            return null;
        }

        return this.becca.getNote(this.value);
    }

    isDefinition() {
        return this.type === "label" && (this.name.startsWith("label:") || this.name.startsWith("relation:"));
    }

    getDefinition() {
        return promotedAttributeDefinitionParser.parse(this.value);
    }

    getDefinedName() {
        if (this.type === "label" && this.name.startsWith("label:")) {
            return this.name.substr(6);
        } else if (this.type === "label" && this.name.startsWith("relation:")) {
            return this.name.substr(9);
        } else {
            return this.name;
        }
    }

    override get isDeleted() {
        return !(this.attributeId in this.becca.attributes);
    }

    override beforeSaving(opts: SavingOpts = {}) {
        if (!opts.skipValidation) {
            this.validate();
        }

        this.name = sanitizeAttributeName(this.name);

        if (!this.value) {
            // null value isn't allowed
            this.value = "";
        }

        if (this.position === undefined || this.position === null) {
            const maxExistingPosition = this.getNote()
                .getAttributes()
                .reduce((maxPosition, attr) => Math.max(maxPosition, attr.position || 0), 0);

            this.position = maxExistingPosition + 10;
        }

        if (!this.isInheritable) {
            this.isInheritable = false;
        }

        this.utcDateModified = dateUtils.utcNowDateTime();

        super.beforeSaving();

        this.becca.attributes[this.attributeId] = this;
    }

    getPojo() {
        return {
            attributeId: this.attributeId,
            noteId: this.noteId,
            type: this.type,
            name: this.name,
            position: this.position,
            value: this.value,
            isInheritable: this.isInheritable,
            utcDateModified: this.utcDateModified,
            isDeleted: false
        };
    }

    createClone(type: AttributeType, name: string, value: string, isInheritable?: boolean) {
        return new BAttribute({
            noteId: this.noteId,
            type: type,
            name: name,
            value: value,
            position: this.position,
            isInheritable: isInheritable,
            utcDateModified: this.utcDateModified
        });
    }
}

export default BAttribute;
