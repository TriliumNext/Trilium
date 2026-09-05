import type { BulkAction } from "@triliumnext/commons";

import type FNote from "../../entities/fnote";
import { executeBulkActions } from "../../services/bulk_action";

/** How one promoted attribute is shown, as a collection's view config stores it. */
export interface PromotedAttributeSetting {
    /** The attribute name without its `label:` or `relation:` prefix. */
    name: string;
    /** Whether the attribute is kept off the items. Absent while it is shown. */
    hidden?: boolean;
}

/** One promoted attribute a collection offers, resolved against what its view config stores. */
export interface PromotedAttribute {
    /** The name the values are keyed by, `dueDate` for instance. */
    name: string;
    /** The definition the collection note carries, `label:dueDate` for instance. */
    definitionName: string;
    type: "label" | "relation";
    /** What the reader sees: the definition's alias, or the name where it gives none. */
    title: string;
    /** Whether the attribute is kept off the items. */
    hidden: boolean;
    /** The definition as stored, which the attribute editor is handed to edit. */
    definitionValue: string;
    /** What the field holds: `text`, `date`, `boolean` and the rest. Absent for a relation. */
    labelType?: string;
    /** Whether the note that defines it is the collection itself rather than an ancestor. */
    isOwned: boolean;
    /**
     * Whether the definition passes to the notes below. Always true for a resolved attribute, and
     * held so that the editor is handed the definition as it stands.
     */
    isInheritable: boolean;
}

/**
 * The attributes a collection can show on its items, in the order the reader put them.
 *
 * The stored settings lead, in their own order, and anything the note has gained since is appended
 * and shown: an attribute nobody has arranged is one the reader has yet to see. What the settings
 * name but the note no longer defines is left out, so writing the result back prunes the config.
 *
 * Read from `getAttributeDefinitions()` rather than from the promoted ones: a definition that is
 * not promoted is still drawn on an item, only without an alias, and a note carrying
 * `#hidePromotedAttributes` (which a board is usually given) reports no promoted ones at all.
 *
 * Only the inheritable definitions are listed. One that is not describes the collection note alone
 * and never reaches the items, so there is nothing about it for the reader to arrange.
 */
export function resolvePromotedAttributes(
    note: FNote | null | undefined,
    settings: PromotedAttributeSetting[] | undefined,
    /** Names the collection draws itself, such as the label a board groups by. */
    ignored: string[] = []
): PromotedAttribute[] {
    const defined = new Map<string, PromotedAttribute>();

    for (const definition of note?.getAttributeDefinitions() ?? []) {
        const [ type, name ] = definition.name.split(":", 2);
        if ((type !== "label" && type !== "relation") || !name || defined.has(name)
                || ignored.includes(name) || !definition.isInheritable) {
            continue;
        }

        const parsed = definition.getDefinition();
        defined.set(name, {
            name,
            definitionName: definition.name,
            type,
            title: parsed?.promotedAlias || name,
            labelType: parsed?.labelType,
            hidden: false,
            definitionValue: definition.value,
            isOwned: definition.noteId === note?.noteId,
            isInheritable: definition.isInheritable
        });
    }

    const ordered: PromotedAttribute[] = [];
    for (const setting of settings ?? []) {
        const attribute = defined.get(setting.name);
        if (attribute && !ordered.includes(attribute)) {
            attribute.hidden = !!setting.hidden;
            ordered.push(attribute);
        }
    }

    for (const attribute of defined.values()) {
        if (!ordered.includes(attribute)) {
            ordered.push(attribute);
        }
    }

    return ordered;
}

/** The attributes drawn on an item, in order, for a view showing their values. */
export function visiblePromotedAttributeNames(attributes: PromotedAttribute[]) {
    return attributes.filter((attribute) => !attribute.hidden).map((attribute) => attribute.name);
}

/** What a collection stores for the attributes it has resolved. */
export function storedPromotedAttributes(attributes: PromotedAttribute[]): PromotedAttributeSetting[] {
    return attributes.map(({ name, hidden }) => hidden ? { name, hidden } : { name });
}

/**
 * Renames an attribute on the collection and everything under it, so the values follow the
 * definition they were written against.
 */
export function renameAttributeInSubtree(
    parentNoteId: string, type: "label" | "relation", oldName: string, newName: string
) {
    const action: BulkAction = type === "label"
        ? { name: "renameLabel", oldLabelName: oldName, newLabelName: newName }
        : { name: "renameRelation", oldRelationName: oldName, newRelationName: newName };

    return executeBulkActions([ parentNoteId ], [ action ], { includeDescendants: true });
}

/**
 * Deletes an attribute from the collection and everything under it. Silent: the attribute leaving
 * the list and the items reports it, and a toast over the dialog reads as something else.
 */
export function deleteAttributeInSubtree(
    parentNoteId: string, type: "label" | "relation", name: string
) {
    const action: BulkAction = type === "label"
        ? { name: "deleteLabel", labelName: name }
        : { name: "deleteRelation", relationName: name };

    return executeBulkActions(
        [ parentNoteId ], [ action ], { includeDescendants: true, silent: true });
}
