import { type AttributeRow, BUILTIN_ATTRIBUTES } from "@triliumnext/commons";

import becca from "../becca/becca.js";
import BAttribute from "../becca/entities/battribute.js";
import type BNote from "../becca/entities/bnote.js";
import attributeFormatter from "./attribute_formatter.js";
import searchService from "./search/services/search.js";
import sql from "./sql.js";

const ATTRIBUTE_TYPES = new Set(["label", "relation"]);

function getNotesWithLabel(name: string, value?: string): BNote[] {
    const query = attributeFormatter.formatAttrForSearch({ type: "label", name, value }, value !== undefined);
    return searchService.searchNotes(query, {
        includeArchivedNotes: true,
        ignoreHoistedNote: true
    });
}

// TODO: should be in search service
function getNoteWithLabel(name: string, value?: string): BNote | null {
    // optimized version (~20 times faster) without using normal search, useful for e.g., finding date notes
    const attrs = becca.findAttributes("label", name);

    if (value === undefined) {
        return attrs[0]?.getNote();
    }

    value = value?.toLowerCase();

    for (const attr of attrs) {
        if (attr.value.toLowerCase() === value) {
            return attr.getNote();
        }
    }

    return null;
}

function createLabel(noteId: string, name: string, value: string = "") {
    return createAttribute({
        noteId,
        type: "label",
        name,
        value
    });
}

function createRelation(noteId: string, name: string, targetNoteId: string) {
    return createAttribute({
        noteId,
        type: "relation",
        name,
        value: targetNoteId
    });
}

function createAttribute(attribute: AttributeRow) {
    return new BAttribute(attribute).save();
}

function getAttributeNames(type: string, nameLike: string) {
    nameLike = nameLike.toLowerCase();

    let names = sql.getColumn<string>(
        /*sql*/`SELECT DISTINCT name
            FROM attributes
            WHERE isDeleted = 0
                AND type = ?
                AND name LIKE ?`,
        [type, `%${nameLike}%`]
    );

    for (const attr of BUILTIN_ATTRIBUTES) {
        if (attr.type === type && attr.name.toLowerCase().includes(nameLike) && !names.includes(attr.name)) {
            names.push(attr.name);
        }
    }

    names = names.filter((name) => !["internalLink", "imageLink", "includeNoteLink", "relationMapLink"].includes(name));

    names.sort((a, b) => {
        const aPrefix = a.toLowerCase().startsWith(nameLike);
        const bPrefix = b.toLowerCase().startsWith(nameLike);

        if (aPrefix !== bPrefix) {
            return aPrefix ? -1 : 1;
        }

        return a < b ? -1 : 1;
    });

    return names;
}

function isAttributeType(type: string): boolean {
    return ATTRIBUTE_TYPES.has(type);
}

function isAttributeDangerous(type: string, name: string): boolean {
    return BUILTIN_ATTRIBUTES.some((attr) => attr.type === type && attr.name.toLowerCase() === name.trim().toLowerCase() && attr.isDangerous);
}

export default {
    getNotesWithLabel,
    getNoteWithLabel,
    createLabel,
    createRelation,
    createAttribute,
    getAttributeNames,
    isAttributeType,
    isAttributeDangerous
};
