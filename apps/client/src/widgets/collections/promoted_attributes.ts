import type { BulkAction } from "@triliumnext/commons";

import type FAttribute from "../../entities/fattribute";
import type FNote from "../../entities/fnote";
import { t } from "../../services/i18n";

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
    /**
     * What the reader sees: the definition's alias, or the name behind the kind that defines it
     * where it gives none. See {@link defaultTitle}.
     */
    title: string;
    /** The name the definition gives it, absent where it gives none. */
    promotedAlias?: string;
    /** Whether the attribute is kept off the items. */
    hidden: boolean;
    /**
     * Whether the collection draws it itself, a board's grouping label being drawn as its columns.
     * Such an attribute is listed and arranged like the rest, but never shown on an item and never
     * offered to be: it is already on the screen, in the shape the collection gives it.
     */
    drawnByCollection: boolean;
    /** The definition as stored, which the attribute editor is handed to edit. */
    definitionValue: string;
    /** What the field holds: `text`, `date`, `boolean` and the rest. Absent for a relation. */
    labelType?: string;
    /** The values a `select` field offers, in the order it offers them. */
    selectOptions?: string[];
    /** Whether the note that defines it is the collection itself rather than an ancestor. */
    isOwned: boolean;
    /**
     * Whether only the items define it, through a template or another parent, and the collection
     * note does not. `PromotedAttributesCard` shows no edit or delete button for it.
     */
    isDefinedByItems: boolean;
    /**
     * Whether an item defines it with another type or other select options than the listed
     * definition. Sorting then compares its values as text, and `buildAttributeMenuItems()` leaves
     * it out.
     */
    isConflicting: boolean;
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
 * Only the inheritable definitions of `note` are listed, because a non-inheritable one applies to
 * the collection note alone.
 *
 * The definitions of `items` are appended after those of `note`, inheritable or not, because
 * `UserAttributesDisplay` shows every definition an item has.
 */
export function resolvePromotedAttributes(
    note: FNote | null | undefined,
    settings: PromotedAttributeSetting[] | undefined,
    /** Names the collection draws itself, such as the label a board groups by. */
    drawnByCollection: string[] = [],
    /** The notes the collection shows, such as the cards of a board. */
    items: Iterable<FNote> = []
): PromotedAttribute[] {
    const defined = new Map<string, PromotedAttribute>();

    const add = (definition: FAttribute, isDefinedByItems: boolean) => {
        const [ type, name ] = definition.name.split(":", 2);
        if ((type !== "label" && type !== "relation") || !name
                || (!isDefinedByItems && !definition.isInheritable)) {
            return;
        }

        const parsed = definition.getDefinition();
        const existing = defined.get(name);
        if (existing) {
            // An item inheriting the collection's definition reads the same one back; only an item
            // that defines the name itself, or through a template, can differ.
            if (isDefinedByItems
                    && (existing.type !== type
                        || (existing.labelType ?? "text") !== (parsed?.labelType ?? "text")
                        || !sameOptions(existing.selectOptions, parsed?.selectOptions))) {
                existing.isConflicting = true;
            }
            return;
        }

        defined.set(name, {
            name,
            definitionName: definition.name,
            type,
            title: parsed?.promotedAlias || defaultTitle(type, name),
            promotedAlias: parsed?.promotedAlias,
            labelType: parsed?.labelType,
            selectOptions: parsed?.selectOptions,
            hidden: false,
            drawnByCollection: drawnByCollection.includes(name),
            definitionValue: definition.value,
            isOwned: definition.noteId === note?.noteId,
            isDefinedByItems,
            isConflicting: false,
            isInheritable: definition.isInheritable
        });
    };

    for (const definition of note?.getAttributeDefinitions() ?? []) {
        add(definition, false);
    }

    for (const item of items) {
        for (const definition of item.getAttributeDefinitions()) {
            add(definition, true);
        }
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

/** Returns whether two select definitions offer the same options in the same order. */
function sameOptions(a: string[] | undefined, b: string[] | undefined) {
    const left = a ?? [];
    const right = b ?? [];
    return left.length === right.length && left.every((option, index) => option === right[index]);
}

/**
 * What an attribute with no alias is listed as: the name behind the kind that defines it, so a bare
 * `dueDate` reads as the field it is rather than as a name someone chose.
 */
function defaultTitle(type: "label" | "relation", name: string) {
    return type === "relation"
        ? t("promoted_attributes.relation_name", { name })
        : t("promoted_attributes.label_name", { name });
}

/** The attributes drawn on an item, in order, for a view showing their values. */
export function visiblePromotedAttributeNames(attributes: PromotedAttribute[]) {
    return attributes
        .filter((attribute) => !attribute.hidden && !attribute.drawnByCollection)
        .map((attribute) => attribute.name);
}

/** What a collection stores for the attributes it has resolved. */
export function storedPromotedAttributes(attributes: PromotedAttribute[]): PromotedAttributeSetting[] {
    return attributes.map(({ name, hidden }) => hidden ? { name, hidden } : { name });
}

/**
 * Renames an attribute on the collection and everything under it, so the values follow the
 * definition they were written against.
 */
export async function renameAttributeInSubtree(
    parentNoteId: string, type: "label" | "relation", oldName: string, newName: string
) {
    const action: BulkAction = type === "label"
        ? { name: "renameLabel", oldLabelName: oldName, newLabelName: newName }
        : { name: "renameRelation", oldRelationName: oldName, newRelationName: newName };

    const { executeBulkActions } = await import("../../services/bulk_action");
    return executeBulkActions([ parentNoteId ], [ action ], { includeDescendants: true });
}

/**
 * Deletes an attribute from the collection and everything under it. Silent: the attribute leaving
 * the list and the items reports it, and a toast over the dialog reads as something else.
 */
export async function deleteAttributeInSubtree(
    parentNoteId: string, type: "label" | "relation", name: string
) {
    const action: BulkAction = type === "label"
        ? { name: "deleteLabel", labelName: name }
        : { name: "deleteRelation", relationName: name };

    const { executeBulkActions } = await import("../../services/bulk_action");
    return executeBulkActions(
        [ parentNoteId ], [ action ], { includeDescendants: true, silent: true });
}
