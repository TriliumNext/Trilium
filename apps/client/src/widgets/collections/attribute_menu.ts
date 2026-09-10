import type FNote from "../../entities/fnote";
import type { MenuCommandItem, MenuItem } from "../../menus/context_menu";
import { menuName } from "../../menus/context_menu_utils";
import { t } from "../../services/i18n";
import { clearLabelOnNotes, setLabelOnNotes, shared } from "../../services/note_set";
import { promotedAttributeIcon } from "../attribute_widgets/attribute_types";
import type { PromotedAttribute } from "./promoted_attributes";

/** Marks the value an item holds, at the trailing edge as the other menus place it. */
const CHECK = "bx bx-check";

/** What a promoted `boolean` holds when it is set, which is what its checkbox writes. */
const TRUE = "true";
const FALSE = "false";

export interface AttributeMenuOptions {
    /**
     * The items whose values the entries read and write. One note for a menu opened on a single
     * item, every selected note for a menu opened on a selection: an entry is marked only where
     * they all hold the same value, and picking one writes it to each of them.
     */
    notes: FNote[];
    /** The attributes the collection shows on its items, in the order it shows them. */
    attributes: PromotedAttribute[];
    /** What the section is called. "Attributes" unless the caller names it. */
    title?: string;
}

/**
 * Builds the section a collection's item menu uses to set the values shown on an item, so a flag or
 * a state changes without opening the note.
 *
 * Lists the attributes the items draw, in the order they are drawn, and only the two types a menu
 * can hold: `boolean`, which the entry marks and toggles, and `select`, whose options open in a
 * submenu. The other types need a field to type into and stay in the attribute editor.
 *
 * Returns an empty array when no attribute qualifies, so a caller can spread the result without
 * checking for an empty section.
 */
export function buildAttributeMenuItems<T>({
    notes, attributes, title
}: AttributeMenuOptions): MenuItem<T>[] {
    const items = attributes.flatMap<MenuItem<T>>((attribute) => {
        if (attribute.hidden || attribute.type !== "label") {
            return [];
        }

        if (attribute.labelType === "boolean") {
            return [ buildBooleanItem<T>(notes, attribute) ];
        }

        // A select without options is skipped: its submenu would hold "Not set" alone.
        if (attribute.labelType === "select" && attribute.selectOptions?.length) {
            return [ buildSelectItem<T>(notes, attribute, attribute.selectOptions) ];
        }

        return [];
    });

    if (!items.length) {
        return [];
    }

    return [ { kind: "header", title: title ?? t("attribute_menu.attributes") }, ...items ];
}

/**
 * A `boolean`, marked while it is set and toggled when the entry is picked.
 *
 * Read and written as `"true"` and `"false"`, the values the field's own checkbox stores, so the
 * entry says what the item draws. A value stored any other way counts as unset, as it does on the
 * item.
 *
 * Notes that disagree leave the entry unmarked, and picking it sets them all, which is the only
 * move that ends with them agreeing.
 */
function buildBooleanItem<T>(notes: FNote[], attribute: PromotedAttribute): MenuCommandItem<T> {
    const state = shared(notes, (note) => note.getLabelValue(attribute.name) === TRUE);
    const isSet = state.agreed && state.value;

    return {
        ...attributeEntry<T>(attribute),
        trailingIcon: isSet ? CHECK : undefined,
        handler: () => {
            void setLabelOnNotes(notes, attribute.name, isSet ? FALSE : TRUE);
        }
    };
}

/**
 * A `select`, its options in a submenu in the order the definition lists them, with the value the
 * item holds marked. A value the definition no longer lists marks nothing, and so do notes holding
 * different values.
 */
function buildSelectItem<T>(
    notes: FNote[], attribute: PromotedAttribute, options: string[]
): MenuCommandItem<T> {
    const current = shared(notes, (note) => note.getLabelValue(attribute.name));

    return {
        ...attributeEntry<T>(attribute),
        // The options carry no icon: they are the user's own words, and one icon would repeat
        // across every option.
        items: [
            {
                // Boxed like the options: a menu row is a flex line, so a bare title keeps the
                // space that separates it from the icon and renders as indented.
                title: menuName(t("attribute_menu.not-set")),
                trailingIcon: current.agreed && !current.value ? CHECK : undefined,
                handler: () => { void clearLabelOnNotes(notes, attribute.name); }
            },
            ...options.map<MenuItem<T>>((option) => ({
                title: menuName(option),
                trailingIcon: current.agreed && current.value === option ? CHECK : undefined,
                handler: () => { void setLabelOnNotes(notes, attribute.name, option); }
            }))
        ]
    };
}

/** What every entry carries: the attribute's display name, under the icon of its type. */
function attributeEntry<T>(attribute: PromotedAttribute): MenuCommandItem<T> {
    return {
        title: menuName(attribute.title),
        uiIcon: promotedAttributeIcon(attribute)
    };
}
