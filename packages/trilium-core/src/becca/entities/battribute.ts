"use strict";

import BNote from "./bnote.js";
import AbstractBeccaEntity from "./abstract_becca_entity.js";
import dateUtils from "../../services/utils/date";
import { promotedAttributeDefinitionParser } from "@triliumnext/commons";
import type { AttributeRow, AttributeType } from "@triliumnext/commons";
import { normalize, sanitizeAttributeName } from "../../services/utils/index.js";
import protectedSessionService from "../../services/protected_session.js";
import { getLog } from "../../services/log.js";

interface SavingOpts {
    skipValidation?: boolean;
}

interface AttributePojo {
    attributeId: string;
    noteId: string;
    type: AttributeType;
    name: string;
    position: number;
    /** Absent when a protected attribute is saved without a session, so the stored ciphertext stays untouched. */
    value?: string;
    isInheritable: boolean;
    /** Absent when a JS migration saves attributes against a schema that predates the column. */
    isProtected?: boolean;
    utcDateModified?: string;
    isDeleted: boolean;
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

    /** Pre-normalized (lowercase, diacritics removed) name for search. */
    normalizedName!: string;
    /** Pre-normalized (lowercase, diacritics removed) value for search. */
    normalizedValue!: string;

    /** `true` when `value` holds plaintext; `false` while a protected value stays encrypted. */
    isDecrypted!: boolean;

    constructor(row?: AttributeRow) {
        super();

        if (!row) {
            return;
        }

        this.updateFromRow(row);
        this.init();
    }

    updateFromRow(row: AttributeRow) {
        this.update([row.attributeId, row.noteId, row.type, row.name, row.value, row.isInheritable, row.position, row.utcDateModified, row.isProtected]);
    }

    update([attributeId, noteId, type, name, value, isInheritable, position, utcDateModified, isProtected]: any) {
        this.attributeId = attributeId;
        this.noteId = noteId;
        this.type = type;
        this.name = name;
        this.position = position;
        this.value = value || "";
        this.isInheritable = !!isInheritable;
        this.isProtected = !!isProtected;
        this.utcDateModified = utcDateModified;

        // Pre-compute normalized forms for search (avoids repeated normalize() calls in hot loops)
        this.normalizedName = normalize(this.name);
        this.normalizedValue = normalize(this.value);

        this.isDecrypted = !this.attributeId || !this.isProtected;

        this.decrypt();

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
        if (this.type === "relation") {
            return ["internalLink", "imageLink", "relationMapLink", "includeNoteLink"].includes(this.name);
        }

        if (this.type === "label") {
            return this.name === "internalBookmark";
        }

        return false;
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
        return this.type === "label" && isDefinitionName(this.name);
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

        // Recompute normalized fields in case name/value were modified directly
        // (e.g., attr.value = "..." followed by attr.save())
        this.normalizedName = normalize(this.name);
        this.normalizedValue = normalize(this.value);

        this.becca.attributes[this.attributeId] = this;
    }

    decrypt() {
        if (this.isProtected && !this.isDecrypted && protectedSessionService.isProtectedSessionAvailable()) {
            try {
                this.value = protectedSessionService.decryptString(this.value) || "";
                this.normalizedValue = normalize(this.value);
                // The owner note's flat text still holds the encrypted value.
                this.becca.dirtyNoteFlatText(this.noteId);

                this.isDecrypted = true;
            } catch (e: any) {
                getLog().error(`Could not decrypt attribute ${this.attributeId}: ${e.message} ${e.stack}`);
            }
        }
    }

    getPojo(): AttributePojo {
        return {
            attributeId: this.attributeId,
            noteId: this.noteId,
            type: this.type,
            name: this.name,
            position: this.position,
            value: this.value,
            isInheritable: this.isInheritable,
            isProtected: this.isProtected,
            utcDateModified: this.utcDateModified,
            isDeleted: false
        };
    }

    override getPojoToSave() {
        const pojo = this.getPojo();

        if (!this.becca.attributesHaveIsProtectedColumn) {
            // A pre-241 JS migration is saving; the row must match that schema.
            delete pojo.isProtected;
            return pojo;
        }

        if (pojo.isProtected) {
            if (this.isDecrypted && pojo.value) {
                pojo.value = protectedSessionService.encrypt(pojo.value) || undefined;
            } else {
                // updating a protected attribute outside of a protected session keeps the original ciphertext
                delete pojo.value;
            }
        }

        return pojo;
    }

    createClone(type: AttributeType, name: string, value: string, isInheritable?: boolean) {
        return new BAttribute({
            noteId: this.noteId,
            type: type,
            name: name,
            value: value,
            position: this.position,
            isInheritable: isInheritable,
            isProtected: this.isProtected,
            utcDateModified: this.utcDateModified
        });
    }
}

const DEFINITION_PREFIXES = [ "label:", "relation:" ];

/**
 * A definition needs an attribute name after its prefix: `#label:` on its own defines nothing, so it
 * is treated as an ordinary label rather than as a definition for a nameless attribute.
 */
export function isDefinitionName(name: string) {
    return DEFINITION_PREFIXES.some((prefix) => name.startsWith(prefix) && name.length > prefix.length);
}

export default BAttribute;
