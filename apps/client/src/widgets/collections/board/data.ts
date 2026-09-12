import FBranch from "../../../entities/fbranch";
import FNote from "../../../entities/fnote";
import type LoadResults from "../../../services/load_results";
import type { PromotedAttribute } from "../promoted_attributes";
import {
    DEFAULT_SORT, parseStoredSortKey, sortedAttributeName, sortItems, type SortContext,
    type SortKey
} from "../sorting";
import { readColumns, writeColumns } from "./column_storage";
import { INBOX_COLUMN, resolveBoardColumns } from "./columns";
import { BoardColumnData, BoardViewData } from "./index";

export interface ColumnItem {
    branch: FBranch;
    note: FNote;
}

export type ColumnMap = Map<string, ColumnItem[]>;

/**
 * The columns as they stand once cards have moved, for drawing the outcome before the writes land.
 *
 * A card crossing columns is written twice, the value first and the branch after, and each lands a
 * redraw of its own. The first shows the card in its new column at whatever place its old branch
 * gives it, which is above every card already there.
 *
 * The cards keep the order `noteIds` lists them in, wherever they came from, and land together.
 * A card the board does not hold is left out; where that is all of them, the map is handed back as
 * it stands.
 *
 * @param index where the cards go, counting the target column as it stands at the moment of the
 *              drop, the cards being moved included where they do not leave that column.
 */
export function applyCardMoves(
    byColumn: ColumnMap, noteIds: string[], to: string, index: number
): ColumnMap {
    const moving = new Set(noteIds);
    const next: ColumnMap = new Map();
    const picked = new Map<string, ColumnItem>();

    for (const [ column, items ] of byColumn) {
        const kept: ColumnItem[] = [];
        for (const item of items) {
            if (moving.has(item.note.noteId)) {
                picked.set(item.note.noteId, item);
            } else {
                kept.push(item);
            }
        }

        next.set(column, kept);
    }

    if (!picked.size) {
        return byColumn;
    }

    // Taking the cards out shifts everything below them up, so a place counted with them still in
    // the column names one card earlier for each of them standing above it.
    const above = (byColumn.get(to) ?? []).slice(0, index)
        .filter((item) => moving.has(item.note.noteId)).length;
    const target = next.get(to) ?? [];
    target.splice(index - above, 0,
        ...noteIds.flatMap((noteId) => picked.get(noteId) ?? []));
    next.set(to, target);

    return next;
}

/**
 * The columns with only the cards in `shownNoteIds`, keeping their order relative to each other.
 * Every column is kept, since a filter narrows what is drawn and nothing else.
 */
export function filterColumnMap(
    byColumn: ColumnMap, shownNoteIds: Set<string> | null
): ColumnMap {
    if (!shownNoteIds) {
        return byColumn;
    }

    const filtered: ColumnMap = new Map();
    for (const [ column, items ] of byColumn) {
        filtered.set(column, items.filter(item => shownNoteIds.has(item.note.noteId)));
    }
    return filtered;
}

/** How one column orders its cards. */
export interface ColumnSort {
    orderBy: SortKey;
    isDescending: boolean;
}

/** What a sorted board reads, so it can be reloaded and watched for changes. */
export interface SortWatch {
    /** The cards in sorted columns, whose creation dates the tie-break reads. */
    noteIds: Set<string>;
    /** The relation targets whose titles a column sorts by. */
    targetNoteIds: Set<string>;
    /** The attribute names the columns sort by. */
    attributeNames: Set<string>;
}

/**
 * What each column sorts by, leaving out every column that keeps the manual order.
 *
 * @param defaultSort the order the board holds, which a column takes until it is given one of its
 *                    own. Such a column keeps the manual order while the board holds none.
 * @param drawnColumns every column the board shows, since one the config says nothing about takes
 *                     the board's order like the rest.
 */
export function resolveColumnSorts(
    columns: BoardColumnData[] | undefined, defaultSort?: ColumnSort, drawnColumns?: string[]
) {
    const sorts = new Map<string, ColumnSort>();
    const stored = new Map((columns ?? []).map(column => [ column.value, column ]));

    for (const value of new Set([ ...drawnColumns ?? [], ...stored.keys() ])) {
        const entry = stored.get(value);
        const key = parseStoredSortKey(entry?.orderBy);

        if (key === DEFAULT_SORT) {
            if (defaultSort) {
                sorts.set(value, defaultSort);
            }
        } else if (key) {
            sorts.set(value, { orderBy: key, isDescending: !!entry?.descendingOrder });
        }
    }

    return sorts;
}

/**
 * The columns with each sorted one in its own order.
 *
 * Returns the same map, and the same array per column, where nothing moves. `Column` reads a fresh
 * array as its cards having moved and re-measures every one of them, so the identities matter.
 */
export function sortColumnMap(
    byColumn: ColumnMap, sorts: ReadonlyMap<string, ColumnSort>, context: SortContext
): ColumnMap {
    let sorted: ColumnMap | undefined;

    for (const [ column, { orderBy, isDescending } ] of sorts) {
        const items = byColumn.get(column);
        if (!items) {
            continue;
        }

        const ordered = sortItems(items, orderBy, isDescending, context);
        if (ordered !== items) {
            sorted ??= new Map(byColumn);
            sorted.set(column, ordered);
        }
    }

    return sorted ?? byColumn;
}

/**
 * The notes a sorted board reads, and the attributes it reads off them.
 *
 * @param definitions the board's promoted attributes by name, which say which keys are relations.
 */
export function resolveSortWatch(
    byColumn: ColumnMap | undefined,
    sorts: ReadonlyMap<string, ColumnSort>,
    definitions: ReadonlyMap<string, PromotedAttribute>
): SortWatch {
    const noteIds = new Set<string>();
    const targetNoteIds = new Set<string>();
    const attributeNames = new Set<string>();

    for (const [ column, { orderBy } ] of sorts) {
        const name = sortedAttributeName(orderBy);
        const relation = name && definitions.get(name)?.type === "relation" ? name : undefined;
        if (name) {
            attributeNames.add(name);
        }

        for (const { note } of byColumn?.get(column) ?? []) {
            noteIds.add(note.noteId);

            const target = relation && note.getRelationValue(relation);
            if (target) {
                targetNoteIds.add(target);
            }
        }
    }

    return { noteIds, targetNoteIds, attributeNames };
}

/**
 * Whether a change can move a card in a sorted column.
 *
 * Deliberately broad: an autosave reports a note row just as a rename does, and
 * {@link sortColumnMap} returns the same arrays when nothing moves, so a needless re-sort renders
 * nothing.
 */
export function affectsSortOrder(loadResults: LoadResults, watch: SortWatch) {
    if (!watch.noteIds.size) {
        return false;
    }

    const isWatched = (noteId: string) =>
        watch.noteIds.has(noteId) || watch.targetNoteIds.has(noteId);
    if (loadResults.getNoteIds().some(isWatched)) {
        return true;
    }

    return loadResults.getAttributeRows().some(attr =>
        watch.attributeNames.has(attr.name ?? "") && watch.noteIds.has(attr.noteId ?? ""));
}

/**
 * Where a card dropped among the cards on screen goes in the full column.
 *
 * @param shown the target column as it is drawn, counting the moved card where it stays in place.
 * @param all the same column with every card it holds.
 * @param index where the card goes among the ones drawn.
 */
export function unfilteredCardIndex(shown: ColumnItem[], all: ColumnItem[], index: number) {
    const placeOf = (item: ColumnItem | undefined) => (item
        ? all.findIndex(other => other.branch.branchId === item.branch.branchId)
        : -1);

    const before = placeOf(shown[index]);
    if (before >= 0) {
        return before;
    }

    // Dropped past the last card on screen, which is what the move is written against; a hidden
    // card below it stays below.
    const after = placeOf(shown.at(-1));
    return after >= 0 ? after + 1 : all.length;
}

/**
 * @param definitionOptions the choices the board's group-by definition offers, empty when it has no
 *                          select definition of its own to lead the column order.
 * @param pendingRenames the columns the board is in the middle of renaming or deleting. Read
 *                       only: which of them have landed comes back as `settledRenames`, for the
 *                       caller to drop once it knows the answer is still about the board it asked
 *                       about.
 */
export async function getBoardData(
    parentNote: FNote,
    groupByColumn: string,
    persistedData: BoardViewData,
    includeArchived: boolean,
    definitionOptions: string[] = [],
    pendingRenames: ReadonlyMap<string, string | undefined> = new Map(),
    /** Whether the board keeps an inbox, which decides whether unassigned notes are collected. */
    inboxEnabled = false
) {
    const byColumn: ColumnMap = new Map();
    const storedColumns = readColumns(persistedData, groupByColumn) ?? [];
    const storedColumnValues = storedColumns.map(c => c.value);
    // Turning the inbox on adds it to the board, at the front. After that the entry belongs to
    // the config: it keeps its icon, colour and position, and turning the inbox off leaves it in
    // place.
    const persistedColumns = inboxEnabled && !storedColumnValues.includes(INBOX_COLUMN)
        ? [ INBOX_COLUMN, ...storedColumnValues ]
        : storedColumnValues;

    // Only a board with an inbox has somewhere to put an unassigned note; on any other board such
    // a note is not shown at all, as before.
    const inbox = inboxEnabled
        ? { nested: !!storedColumns.find(col => col.value === INBOX_COLUMN)?.nested }
        : undefined;

    // First, scan all notes to find what columns actually exist
    await recursiveGroupBy(
        parentNote.getChildBranches(), byColumn, groupByColumn, includeArchived,
        new Set<string>(), inbox, 0);

    const discoveredValues = [ ...byColumn.keys() ];
    const columns = resolveBoardColumns(
        definitionOptions, persistedColumns, discoveredValues, pendingRenames);

    // A value no source lists any more has finished being renamed, and holding it back further
    // would only block a column created under the same name.
    const settledRenames = [ ...pendingRenames.keys() ].filter(oldValue =>
        ![ definitionOptions, persistedColumns, discoveredValues ]
            .some(source => source.includes(oldValue)));

    // A card the bulk action has not reached yet is still filed under the old value, and belongs to
    // the column that replaced it rather than to one `columns` no longer lists.
    regroupRenamedCards(byColumn, pendingRenames);

    // A column the notes have nothing in is still a column, so every resolved one gets an entry.
    for (const column of columns) {
        if (!byColumn.has(column)) {
            byColumn.set(column, []);
        }
    }

    // The attachment mirrors the resolved list, so a board whose columns now come from its definition
    // stays readable by anything still reading the attachment. Written only when it actually differs,
    // or every refresh would save.
    const hasChanges = storedColumnValues.length !== columns.length
        || storedColumnValues.some((value, index) => columns[index] !== value);
    const byResolvedName = indexColumnsByResolvedName(storedColumns, pendingRenames);

    return {
        byColumn,
        columns,
        settledRenames,
        newPersistedData: hasChanges
            ? writeColumns(persistedData, groupByColumn,
                columns.map(value => byResolvedName.get(value) ?? { value }))
            : undefined,
        isInRelationMode: groupByColumn.startsWith("~")
    };
}

/**
 * The stored column entries, each under the name it now resolves to.
 *
 * An entry holds more than the name, so rebuilding the config from the resolved names alone would
 * drop the icon of every column on any refresh that rewrites it. A rename carries the entry across
 * to the new name, the same substitution {@link resolveBoardColumns} makes.
 */
function indexColumnsByResolvedName(
    storedColumns: BoardColumnData[],
    pendingRenames: ReadonlyMap<string, string | undefined>
) {
    const byName = new Map<string, BoardColumnData>();

    for (const column of storedColumns) {
        const { value } = column;
        const name = pendingRenames.has(value) ? pendingRenames.get(value) : value;
        if (name !== undefined) {
            byName.set(name, { ...column, value: name });
        }
    }

    return byName;
}

/** Moves the cards of a renamed column over to its new name, keeping the order they were in. */
function regroupRenamedCards(
    byColumn: ColumnMap,
    pendingRenames: ReadonlyMap<string, string | undefined>
) {
    for (const [ oldValue, newValue ] of pendingRenames) {
        const items = byColumn.get(oldValue);
        if (!items || !newValue) continue;

        byColumn.delete(oldValue);
        byColumn.set(newValue, [ ...(byColumn.get(newValue) ?? []), ...items ]);
    }
}

/**
 * @param inbox where unassigned notes are collected, absent if the board has no inbox.
 * @param depth how deep below the board the branches are, the board's own children being 0.
 */
async function recursiveGroupBy(
    branches: FBranch[], byColumn: ColumnMap, groupByColumn: string, includeArchived: boolean,
    seenNoteIds: Set<string>, inbox: { nested: boolean } | undefined, depth: number
) {
    for (const branch of branches) {
        const note = await branch.getNote();
        if (!note || (!includeArchived && note.isArchived)) continue;

        // A template is what a card is made from, not a card. One made from the board's own
        // properties is filed under it, and the inbox would otherwise collect it as one.
        const isTemplate = note.hasLabel("template");

        if (note.type !== "search" && note.hasChildren()) {
            await recursiveGroupBy(
                note.getChildBranches(), byColumn, groupByColumn, includeArchived,
                seenNoteIds, inbox, depth + 1);
        }

        // A note with no value goes to the inbox, if the board has one and reaches this deep.
        // Anything below the board's own children is a card's child, collected only when nested.
        const value = note.getLabelOrRelation(groupByColumn);
        const group = value || (inbox && (depth === 0 || inbox.nested) ? INBOX_COLUMN : undefined);
        if (group === undefined || isTemplate || seenNoteIds.has(note.noteId)) {
            continue;
        }

        if (!byColumn.has(group)) {
            byColumn.set(group, []);
        }

        byColumn.get(group)!.push({
            branch,
            note
        });
        seenNoteIds.add(note.noteId);
    }
}
