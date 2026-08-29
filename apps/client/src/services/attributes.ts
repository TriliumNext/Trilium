import { AttributeType, BUILTIN_ATTRIBUTES, type BuiltinLabel, type DefinitionObject, type LabelType, promotedAttributeDefinitionParser } from "@triliumnext/commons";

import type FAttribute from "../entities/fattribute.js";
import type FNote from "../entities/fnote.js";
import froca from "./froca.js";
import type { AttributeRow } from "./load_results.js";
import server from "./server.js";

async function addLabel(noteId: string, name: string, value: string = "", isInheritable = false) {
    await server.put(`notes/${noteId}/attribute`, {
        type: "label",
        name,
        value,
        isInheritable
    });
}

export async function setLabel(noteId: string, name: string, value: string = "", isInheritable = false, componentId?: string) {
    await server.put(`notes/${noteId}/set-attribute`, {
        type: "label",
        name,
        value,
        isInheritable,
    }, componentId);
}

export async function setRelation(noteId: string, name: string, value: string = "", isInheritable = false) {
    await server.put(`notes/${noteId}/set-attribute`, {
        type: "relation",
        name,
        value,
        isInheritable
    });
}

/**
 * Sets a boolean label on the given note, taking inheritance into account. If the desired value matches the inherited
 * value, any owned label will be removed to allow the inherited value to take effect. If the desired value differs
 * from the inherited value, an owned label will be created or updated to reflect the desired value.
 *
 * When checking if the boolean value is set, don't use `note.hasLabel`; instead use `note.isLabelTruthy`.
 *
 * @param note the note on which to set the boolean label.
 * @param labelName the name of the label to set.
 * @param value the boolean value to set for the label.
 */
export async function setBooleanWithInheritance(note: FNote, labelName: string, value: boolean) {
    const actualValue = note.isLabelTruthy(labelName);
    if (actualValue === value) return;
    const hasInheritedValue = !note.hasOwnedLabel(labelName) && note.hasLabel(labelName);

    if (hasInheritedValue) {
        if (value) {
            setLabel(note.noteId, labelName, "");
        } else {
            // Label is inherited - override to false.
            setLabel(note.noteId, labelName, "false");
        }
    } else if (value) {
        setLabel(note.noteId, labelName, "");
    } else {
        removeOwnedLabelByName(note, labelName);
    }
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

export interface AttributeValueState {
    attributeId?: string;
    value: string;
}

/**
 * Sets the labels of one name on a note to exactly `values`, for a field holding a set of them.
 *
 * The labels already there are reused in order, so taking a value out of the middle of a set renames
 * the ones after it rather than deleting and recreating the lot — which keeps their positions, and
 * with them the order the set reads in. Only owned labels are touched: an inherited one belongs to
 * the note it is written on.
 *
 * `current` carries returned state across serialized calls that run before the note cache reloads.
 */
export async function setLabelValues(
    note: FNote,
    name: string,
    values: string[],
    componentId?: string,
    current?: readonly AttributeValueState[]
) {
    return await setAttributeValues(note, "label", name, values, componentId, current);
}

/**
 * Sets the relations of one name on a note to exactly `values` — the targets' noteIds — as
 * {@link setLabelValues} sets a set of labels.
 */
export async function setRelationValues(note: FNote, name: string, values: string[], componentId?: string) {
    await setAttributeValues(note, "relation", name, values, componentId);
}

async function setAttributeValues(
    note: FNote,
    type: "label" | "relation",
    name: string,
    values: string[],
    componentId?: string,
    current?: readonly AttributeValueState[]
) {
    const existing = current
        ?? (type === "label" ? note.getOwnedLabels(name) : note.getOwnedRelations(name));
    const updated: AttributeValueState[] = [];

    for (const [ index, value ] of values.entries()) {
        const attributeId = existing[index]?.attributeId;
        if (existing[index]?.value === value) {
            updated.push(existing[index]);
            continue;
        }
        const response = await server.put<{ attributeId?: string }>(
            `notes/${note.noteId}/attribute`,
            { attributeId, type, name, value },
            componentId
        );
        updated.push({ attributeId: response?.attributeId ?? attributeId, value });
    }

    // Whatever the new set did not fill is no longer held.
    for (const spare of existing.slice(values.length)) {
        if (spare.attributeId) {
            await server.remove(
                `notes/${note.noteId}/attributes/${spare.attributeId}`,
                componentId
            );
        }
    }

    return updated;
}

/**
 * Adds an option to a `select` definition, for a field offering to create the choice being typed
 * into it.
 *
 * Written back to the very attribute the definition was read from — which is to say to whichever
 * note owns it, typically a parent or a template, rather than to the note being edited — so that
 * every note the field reaches offers the new option from now on.
 *
 * @param definitionAttr the `label:foo` attribute declaring the field.
 * @param option the option to add; already offered, it is left as it stands.
 * @returns the definition as it now reads, for a caller holding a parsed copy of its own.
 */
export async function addSelectOption(definitionAttr: FAttribute, option: string, componentId?: string) {
    const definition = definitionAttr.getDefinition();
    const options = definition.selectOptions ?? [];
    if (options.includes(option)) {
        return definition;
    }

    const newDefinition: DefinitionObject = { ...definition, selectOptions: [ ...options, option ] };
    await server.put(
        `notes/${definitionAttr.noteId}/attribute`,
        {
            attributeId: definitionAttr.attributeId,
            type: "label",
            name: definitionAttr.name,
            value: promotedAttributeDefinitionParser.serialize(newDefinition, "label")
        },
        componentId
    );
    return newDefinition;
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
export async function setAttribute(note: FNote, type: "label" | "relation", name: string, value: string | null | undefined, componentId?: string) {
    if (value !== null && value !== undefined) {
        // Create or update the attribute.
        await server.put(`notes/${note.noteId}/set-attribute`, { type, name, value }, componentId);
    } else {
        // Remove the attribute if it exists on the server but we don't define a value for it.
        const attributeId = note.getAttribute(type, name)?.attributeId;
        if (attributeId) {
            await server.remove(`notes/${note.noteId}/attributes/${attributeId}`, componentId);
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

/**
 * Toggles whether a dangerous attribute is enabled or not. When an attribute is disabled, its name is prefixed with `disabled:`.
 *
 * Note that this work for non-dangerous attributes as well.
 *
 * If there are multiple attributes with the same name, all of them will be toggled at the same time.
 *
 * @param note the note whose attribute to change.
 * @param type the type of dangerous attribute (label or relation).
 * @param name the name of the dangerous attribute.
 * @param willEnable whether to enable or disable the attribute.
 * @returns a promise that will resolve when the request to the server completes.
 */
async function toggleDangerousAttribute(note: FNote, type: "label" | "relation", name: string, willEnable: boolean) {
    const attrs = [
        ...note.getOwnedAttributes(type, name),
        ...note.getOwnedAttributes(type, `disabled:${name}`)
    ];

    for (const attr of attrs) {
        const baseName = getNameWithoutDangerousPrefix(attr.name);
        const newName = willEnable ? baseName : `disabled:${baseName}`;
        if (newName === attr.name) continue;

        // We are adding and removing afterwards to avoid a flicker (because for a moment there would be no active content attribute anymore) because the operations are done in sequence and not atomically.
        if (attr.type === "label") {
            await setLabel(note.noteId, newName, attr.value);
        } else {
            await setRelation(note.noteId, newName, attr.value);
        }
        await removeAttributeById(note.noteId, attr.attributeId);
    }
}

/**
 * Returns the name of an attribute without the `disabled:` prefix, or the same name if it's not disabled.
 * @param name the name of an attribute.
 * @returns the name without the `disabled:` prefix.
 */
function getNameWithoutDangerousPrefix(name: string) {
    return name.startsWith("disabled:") ? name.substring(9) : name;
}

/**
 * Whether the name is one Trilium itself attaches a meaning to, rather than one the user invented.
 *
 * Matched exactly, on purpose: a definition (`label:archived`) describes a system attribute without
 * being one, and a disabled one (`disabled:run`) has been deliberately made inert. Both are ordinary
 * attributes as far as the name alone is concerned.
 */
export function isBuiltinAttribute(type: "label" | "relation", name: string) {
    return BUILTIN_ATTRIBUTE_KEYS.has(`${type}:${name}`);
}

/**
 * The built-ins keyed by type and name. There is no ambiguity in joining the two with a colon: the
 * type is always exactly `label` or `relation`, so the first segment of a key is never in doubt.
 */
const BUILTIN_ATTRIBUTE_KEYS = new Set(BUILTIN_ATTRIBUTES.map(({ type, name }) => `${type}:${name}`));

/**
 * What kind of value a built-in label holds, or `undefined` for a name Trilium attaches no meaning to.
 *
 * Matched exactly, as {@link isBuiltinAttribute} is: a `disabled:` attribute is inert and a definition
 * carries a definition string rather than a value of the type it describes.
 */
export function getBuiltinLabelValueType(name: string): LabelType | undefined {
    return BUILTIN_LABELS.get(name)?.valueType;
}

/**
 * The values a built-in label of the `select` type accepts, or `undefined` for every other name —
 * whether it is a label of another type or none of Trilium's at all.
 *
 * The list is what to *offer*, not what to allow: a value outside it is kept and shown, since the sets
 * grow between versions and a note may have been written by a newer one.
 */
export function getBuiltinLabelSelectOptions(name: string): readonly string[] | undefined {
    return BUILTIN_LABELS.get(name)?.selectOptions;
}

const BUILTIN_LABELS = new Map<string, BuiltinLabel>(
    BUILTIN_ATTRIBUTES.flatMap((attr) => attr.type === "label" ? [ [ attr.name, attr ] as const ] : [])
);

export default {
    addLabel,
    setLabel,
    setRelation,
    setAttribute,
    setLabelValues,
    setRelationValues,
    addSelectOption,
    setBooleanWithInheritance,
    removeAttributeById,
    removeOwnedLabelByName,
    removeOwnedRelationByName,
    isAffecting,
    toggleDangerousAttribute,
    getNameWithoutDangerousPrefix
};
