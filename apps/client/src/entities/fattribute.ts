import type { Froca } from "../services/froca-interface.js";
import promotedAttributeDefinitionParser from "../services/promoted_attribute_definition_parser.js";

/**
 * There are currently only two types of attributes, labels or relations.
 */
export type AttributeType = "label" | "relation";

export interface FAttributeRow {
    attributeId: string;
    noteId: string;
    type: AttributeType;
    name: string;
    value: string;
    position: number;
    isInheritable: boolean;
}

/**
 * Attribute is an abstract concept which has two real uses - label (key - value pair)
 * and relation (representing named relationship between source and target note)
 */
class FAttribute {
    private froca: Froca;
    attributeId!: string;
    noteId!: string;
    type!: AttributeType;
    name!: string;
    value!: string;
    position!: number;
    isInheritable!: boolean;

    constructor(froca: Froca, row: FAttributeRow) {
        this.froca = froca;

        this.update(row);
    }

    update(row: FAttributeRow) {
        this.attributeId = row.attributeId;
        this.noteId = row.noteId;
        this.type = row.type;
        this.name = row.name;
        this.value = row.value;
        this.position = row.position;
        this.isInheritable = !!row.isInheritable;
    }

    getNote() {
        return this.froca.notes[this.noteId];
    }

    async getTargetNote() {
        const targetNoteId = this.targetNoteId;

        return await this.froca.getNote(targetNoteId, true);
    }

    get targetNoteId() {
        // alias
        if (this.type !== "relation") {
            throw new Error(`Attribute ${this.attributeId} is not a relation`);
        }

        return this.value;
    }

    get isAutoLink() {
        if (this.type === "relation") {
            return ["internalLink", "imageLink", "relationMapLink", "includeNoteLink"].includes(this.name);
        }

        if (this.type === "label") {
            return this.name === "internalBookmark";
        }

        return false;
    }

    get toString() {
        return `FAttribute(attributeId=${this.attributeId}, type=${this.type}, name=${this.name}, value=${this.value})`;
    }

    isDefinition() {
        return this.type === "label" && (this.name.startsWith("label:") || this.name.startsWith("relation:"));
    }

    getDefinition() {
        return promotedAttributeDefinitionParser.parse(this.value);
    }

    isDefinitionFor(attr: FAttribute) {
        return this.type === "label" && this.name === `${attr.type}:${attr.name}`;
    }

    get dto(): Omit<FAttribute, "froca"> {
        const dto: any = Object.assign({}, this);
        delete dto.froca;

        return dto;
    }
}

export default FAttribute;
