import type { MenuItem } from "../../menus/context_menu";
import { menuName } from "../../menus/context_menu_utils";
import { t } from "../../services/i18n";
import { promotedAttributeIcon } from "../attribute_widgets/attribute_types";
import type { PromotedAttribute } from "./promoted_attributes";
import {
    DEFAULT_SORT, type SortKey, sortedAttributeName, type StoredSortKey
} from "./sorting";

export interface SortMenuOptions {
    /** What the collection sorts by now, absent while it keeps the order the user arranged. */
    orderBy: StoredSortKey | undefined;
    /** Whether that order runs backwards. */
    isDescending: boolean;
    /** The fields offered besides the title and the creation date, in the order they are shown. */
    attributes: PromotedAttribute[];
    /** What the entry for no sorting is called. "None" unless the caller names it. */
    noneTitle?: string;
    /** What the {@link DEFAULT_SORT} entry is called. "Default" unless the caller names it. */
    defaultTitle?: string;
    /**
     * Drops the {@link DEFAULT_SORT} entry. Set it on the menu that edits the collection's own
     * order, which has no order above it to fall back to.
     */
    hideDefault?: boolean;
    /** Called with the key picked, or `undefined` for the order the user arranges by hand. */
    onSelect: (orderBy: StoredSortKey | undefined) => void;
    onDirectionChange: (isDescending: boolean) => void;
}

/** One order a collection can be put in, however it is offered. */
export interface SortEntry {
    /** Tells the entries apart in a list: the stored key, or the direction it names. */
    key: string;
    title: string;
    icon: string;
    /** Whether the collection is in this order now. */
    isSelected: boolean;
    /** Whether it can be picked. The direction is off while nothing is sorted. */
    isEnabled: boolean;
    /** Whether the title is the user's own text, which a menu escapes and clips. */
    isUserNamed: boolean;
    pick: () => void;
}

/**
 * Builds the orders a collection offers and the two directions, for {@link buildSortMenuItems} and
 * `SortDropdown` to draw. Both read these entries, so an order offered in one is offered in the
 * other.
 */
export function sortEntries({
    orderBy, isDescending, attributes, noneTitle, defaultTitle, hideDefault, onSelect,
    onDirectionChange
}: SortMenuOptions): { orders: SortEntry[], directions: SortEntry[] } {
    const order = (
        key: StoredSortKey | undefined, title: string, icon: string, isUserNamed = false
    ): SortEntry => ({
        key: key ?? "none",
        title,
        icon,
        isSelected: key === orderBy,
        isEnabled: true,
        isUserNamed,
        pick: () => onSelect(key)
    });

    // Off for the manual order, and for DEFAULT_SORT, which brings the direction with it.
    const canPickDirection = !!orderBy && orderBy !== DEFAULT_SORT;
    const direction = (descending: boolean, title: string, icon: string): SortEntry => ({
        key: descending ? "descending" : "ascending",
        title,
        icon,
        isSelected: !!orderBy && isDescending === descending,
        isEnabled: canPickDirection,
        isUserNamed: false,
        pick: () => onDirectionChange(descending)
    });

    return {
        orders: [
            ...(hideDefault ? [] : [ order(
                DEFAULT_SORT, defaultTitle ?? t("sorting.default"), "bx bx-collection") ]),
            order(undefined, noneTitle ?? t("sorting.none"), "bx bx-move-vertical"),
            order("title", t("sorting.title"), "bx bx-text"),
            order("creationDate", t("sorting.creation-date"), "bx bx-calendar-plus"),
            ...attributes.map((attribute) => order(
                `attr:${attribute.name}`,
                attribute.title,
                promotedAttributeIcon(attribute),
                true))
        ],
        directions: [
            direction(false, t("sorting.ascending"), "bx bx-sort-up"),
            direction(true, t("sorting.descending"), "bx bx-sort-down")
        ]
    };
}

/**
 * What the order a collection is sorted by is called, for a control standing in for the menu.
 *
 * A key naming an attribute the collection no longer defines reads as the bare name: it is still
 * what the items are ordered by, and there is no title left to show for it.
 */
export function sortMenuTitle(
    { orderBy, attributes, noneTitle, defaultTitle }:
        Pick<SortMenuOptions, "orderBy" | "attributes" | "noneTitle" | "defaultTitle">
): string {
    const { orders } = sortEntries({
        orderBy,
        attributes,
        noneTitle,
        defaultTitle,
        isDescending: false,
        onSelect: () => {},
        onDirectionChange: () => {}
    });

    const current = orders.find((entry) => entry.isSelected);
    if (current) {
        return current.title;
    }

    return orderBy && orderBy !== DEFAULT_SORT
        ? sortedAttributeName(orderBy) ?? orderBy
        : orders[0].title;
}

/**
 * The entries a collection offers for how it orders its items.
 *
 * A submenu for the caller to hang wherever it belongs. The direction sits at the foot, disabled
 * while nothing is sorted.
 */
export function buildSortMenuItems<T>(options: SortMenuOptions): MenuItem<T>[] {
    const { orders, directions } = sortEntries(options);

    return [
        ...orders.map((entry) => toMenuItem<T>(entry)),
        { kind: "separator" },
        ...directions.map((entry) => toMenuItem<T>(entry))
    ];
}

/** One entry as a menu reads it: a title of markup, the mark at the trailing edge. */
function toMenuItem<T>(entry: SortEntry): MenuItem<T> {
    return {
        title: entry.isUserNamed ? menuName(entry.title) : entry.title,
        uiIcon: entry.icon,
        enabled: entry.isEnabled,
        trailingIcon: entry.isSelected ? "bx bx-check" : undefined,
        handler: () => entry.pick()
    };
}
