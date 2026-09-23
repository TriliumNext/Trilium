import Color from "color";

import type FNote from "../../entities/fnote";
import type { PromotedAttribute } from "./promoted_attributes";

/** What a collection orders its items by. `attr:` names one of its promoted attributes. */
export type SortKey = "title" | "creationDate" | `attr:${string}`;

/** What an item stores to take the collection's own order rather than one of its own. */
export const DEFAULT_SORT = "default";

/**
 * What an item stores to keep the order the reader arranged.
 *
 * Written out because storing nothing means taking the collection's own order: a column is drawn in
 * that until the reader picks something for it, this included.
 */
export const MANUAL_SORT = "manual";

/** What one column of a collection stores: an order of its own, or the collection's. */
export type StoredSortKey = SortKey | typeof DEFAULT_SORT;

/** What the sort needs besides the notes themselves. */
export interface SortContext {
    /** The promoted attributes by name, used to decide how each value compares. */
    definitions: ReadonlyMap<string, PromotedAttribute>;
    /** The creation time of a note in milliseconds, or undefined until it is loaded. */
    creationDate: (noteId: string) => number | undefined;
    /** The title of a relation target, or undefined if that note is not in froca. */
    noteTitle: (noteId: string) => string | undefined;
}

/** A value two items are compared by, or undefined when an item has none. */
type SortValue = string | number | undefined;

const ATTRIBUTE_PREFIX = "attr:";

/**
 * Reads a stored `orderBy` setting.
 *
 * @returns the key to sort by, or undefined when the items keep the order the user arranged.
 */
export function parseSortKey(orderBy: string | null | undefined): SortKey | undefined {
    if (orderBy === "title" || orderBy === "creationDate") {
        return orderBy;
    }

    if (orderBy?.startsWith(ATTRIBUTE_PREFIX) && orderBy.length > ATTRIBUTE_PREFIX.length) {
        return orderBy as SortKey;
    }

    return undefined;
}

/**
 * Reads what one item of a collection stores.
 *
 * @returns the key it sorts by, {@link DEFAULT_SORT} where it takes the collection's own order —
 *          which storing nothing does — and undefined for the manual order.
 */
export function parseStoredSortKey(
    orderBy: string | null | undefined
): StoredSortKey | undefined {
    if (orderBy === MANUAL_SORT) {
        return undefined;
    }

    if (!orderBy || orderBy === DEFAULT_SORT) {
        return DEFAULT_SORT;
    }

    // Anything else the collection cannot order by, such as a key written by a newer version,
    // leaves the items as the reader arranged them.
    return parseSortKey(orderBy);
}

/** The attribute a key sorts by, or undefined when the key names something else. */
export function sortedAttributeName(key: SortKey) {
    return key.startsWith(ATTRIBUTE_PREFIX) ? key.substring(ATTRIBUTE_PREFIX.length) : undefined;
}

/**
 * Orders items by one key, breaking ties on the creation date and then on the given order.
 *
 * An item with no value for the key sorts last in both directions. Returns the same array when the
 * items are already in order, so a caller can compare identities.
 */
export function sortItems<T extends { note: FNote }>(
    items: T[], key: SortKey, isDescending: boolean, context: SortContext
): T[] {
    const direction = isDescending ? -1 : 1;
    const entries = items.map((item, index) => ({
        item,
        index,
        value: sortValueOf(item.note, key, context),
        createdAt: context.creationDate(item.note.noteId)
    }));

    entries.sort((a, b) => {
        const primary = compareValues(a.value, b.value);
        if (primary !== 0) {
            // Only defined values reverse, so an item with no value stays last either way.
            const isDefined = a.value !== undefined && b.value !== undefined;
            return isDefined ? primary * direction : primary;
        }

        return compareValues(a.createdAt, b.createdAt) || a.index - b.index;
    });

    return entries.every((entry, index) => entry.index === index)
        ? items
        : entries.map(({ item }) => item);
}

/** Compares text as the user reads it, so "Task 10" sorts after "Task 9". */
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: "base" });

function compareValues(a: SortValue, b: SortValue) {
    if (a === undefined || b === undefined) {
        return a === b ? 0 : (a === undefined ? 1 : -1);
    }

    if (typeof a === "number" && typeof b === "number") {
        return a - b;
    }

    return collator.compare(String(a), String(b));
}

function sortValueOf(note: FNote, key: SortKey, context: SortContext): SortValue {
    if (key === "title") {
        return note.title;
    }

    if (key === "creationDate") {
        return context.creationDate(note.noteId);
    }

    const name = sortedAttributeName(key) ?? "";
    const definition = context.definitions.get(name);

    if (definition?.type === "relation") {
        const targetId = note.getRelationValue(name);
        return targetId ? context.noteTitle(targetId) ?? targetId : undefined;
    }

    // The first value of a multi-value attribute, which is the one an item draws.
    const label = note.getLabel(name);

    // A boolean has no third state. The editor writes "false" for a box the user unchecked and
    // leaves no label at all on a note nobody has touched, and both draw as an unchecked box, so
    // neither may fall to the undefined group. An empty value is truthy, as `isLabelTruthy` reads
    // it.
    if (definition?.labelType === "boolean") {
        return label && label.value !== "false" ? 1 : 0;
    }

    if (!label) {
        return undefined;
    }

    return label.value ? labelValueOf(label.value, definition) : undefined;
}

function labelValueOf(value: string, definition: PromotedAttribute | undefined): SortValue {
    switch (definition?.labelType) {
        case "number":
            // `Number` rather than `parseFloat`, which would read "1-2" as 1 and sort it among
            // the valid numbers.
            return toNumber(Number(value));
        case "date":
        case "datetime":
            return toNumber(Date.parse(value));
        case "time":
            return secondsOfDay(value);
        case "color":
            return hueOf(value);
        case "select":
            return optionIndex(value, definition.selectOptions);
        default:
            return value;
    }
}

/**
 * Where a value stands among the options a select offers, so `options=Low;Medium;High;Urgent`
 * sorts by rank rather than alphabetically.
 */
function optionIndex(value: string, options: string[] | undefined): SortValue {
    if (!options?.length) {
        // With no options declared there is no order to follow, so the values compare as text.
        return value;
    }

    const at = options.indexOf(value);
    // A value the definition no longer offers sorts after every option it does, rather than with
    // the items that have no value.
    return at >= 0 ? at : options.length;
}

function toNumber(value: number) {
    return Number.isNaN(value) ? undefined : value;
}

/** Converts the `HH:MM` and `HH:MM:SS` values a time field writes into seconds. */
function secondsOfDay(value: string) {
    const parts = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(value.trim());
    if (!parts) {
        return undefined;
    }

    return Number(parts[1]) * 3600 + Number(parts[2]) * 60 + Number(parts[3] ?? 0);
}

/** Below every hue, which runs 0 to 360, for the greys that have none. */
const GREY = -1;

/**
 * The hue of a colour, or {@link GREY} for one with no saturation. A value nothing can be read
 * from has no key at all, which sorts it with the items that carry no colour.
 */
function hueOf(value: string) {
    try {
        const color = Color(value.toLowerCase()).hsl();
        return color.saturationl() > 0 ? color.hue() : GREY;
    } catch {
        return undefined;
    }
}
