import server from "./server.js";
import froca from "./froca.js";
import type FNote from "../entities/fnote.js";
import type { AttributeRow } from "./load_results.js";
import { AttributeType } from "@triliumnext/commons";

async function addLabel(noteId: string, name: string, value: string = "", isInheritable = false) {
    await server.put(`notes/${noteId}/attribute`, {
        type: "label",
        name: name,
        value: value,
        isInheritable
    });
}

export async function setLabel(noteId: string, name: string, value: string = "", isInheritable = false) {
    await server.put(`notes/${noteId}/set-attribute`, {
        type: "label",
        name: name,
        value: value,
        isInheritable
    });
}

export async function setRelation(noteId: string, name: string, value: string = "", isInheritable = false) {
    await server.put(`notes/${noteId}/set-attribute`, {
        type: "relation",
        name: name,
        value: value,
        isInheritable
    });
}

async function removeAttributeById(noteId: string, attributeId: string) {
    await server.remove(`notes/${noteId}/attributes/${attributeId}`);
}

export async function removeOwnedAttributesByNameOrType(note: FNote, type: AttributeType, name: string) {
    for (const attr of note.getOwnedAttributes()) {
        if (attr.type === type && attr.name === name) {
            await server.remove(`notes/${note.noteId}/attributes/${attr.attributeId}`);
        }
    }
}

/**
 * Removes a label identified by its name from the given note, if it exists. Note that the label must be owned, i.e.
 * it will not remove inherited attributes.
 *
 * @param note the note from which to remove the label.
 * @param labelName the name of the label to remove.
 * @returns `true` if an attribute was identified and removed, `false` otherwise.
 */
function removeOwnedLabelByName(note: FNote, labelName: string) {
    const label = note.getOwnedLabel(labelName);
    if (label) {
        removeAttributeById(note.noteId, label.attributeId);
        return true;
    }
    return false;
}

/**
 * Removes a relation identified by its name from the given note, if it exists. Note that the relation must be owned, i.e.
 * it will not remove inherited attributes.
 *
 * @param note the note from which to remove the relation.
 * @param relationName the name of the relation to remove.
 * @returns `true` if an attribute was identified and removed, `false` otherwise.
 */
function removeOwnedRelationByName(note: FNote, relationName: string) {
    const relation = note.getOwnedRelation(relationName);
    if (relation) {
        removeAttributeById(note.noteId, relation.attributeId);
        return true;
    }
    return false;
}

/**
 * Sets the attribute of the given note to the provided value if its truthy, or removes the attribute if the value is falsy.
 * For an attribute with an empty value, pass an empty string instead.
 *
 * @param note the note to set the attribute to.
 * @param type the type of attribute (label or relation).
 * @param name the name of the attribute to set.
 * @param value the value of the attribute to set.
 */
export async function setAttribute(note: FNote, type: "label" | "relation", name: string, value: string | null | undefined) {
    if (value !== null && value !== undefined) {
        // Create or update the attribute.
        await server.put(`notes/${note.noteId}/set-attribute`, { type, name, value });
    } else {
        // Remove the attribute if it exists on the server but we don't define a value for it.
        const attributeId = note.getAttribute(type, name)?.attributeId;
        if (attributeId) {
            await server.remove(`notes/${note.noteId}/attributes/${attributeId}`);
        }
    }
}

/**
 * @returns - returns true if this attribute has the potential to influence the note in the argument.
 *         That can happen in multiple ways:
 *         1. attribute is owned by the note
 *         2. attribute is owned by the template of the note
 *         3. attribute is owned by some note's ancestor and is inheritable
 */
function isAffecting(attrRow: AttributeRow, affectedNote: FNote | null | undefined) {
    if (!affectedNote || !attrRow) {
        return false;
    }

    const attrNote = attrRow.noteId && froca.notes[attrRow.noteId];

    if (!attrNote) {
        // the note (owner of the attribute) is not even loaded into the cache, so it should not affect anything else
        return false;
    }

    const owningNotes = [affectedNote, ...affectedNote.getNotesToInheritAttributesFrom()];

    for (const owningNote of owningNotes) {
        if (owningNote.noteId === attrNote.noteId) {
            return true;
        }
    }

    if (attrRow.isInheritable) {
        for (const owningNote of owningNotes) {
            if (owningNote.hasAncestor(attrNote.noteId, true)) {
                return true;
            }
        }
    }

    return false;
}

export default {
    addLabel,
    setLabel,
    setRelation,
    setAttribute,
    removeAttributeById,
    removeOwnedLabelByName,
    removeOwnedRelationByName,
    isAffecting
};
