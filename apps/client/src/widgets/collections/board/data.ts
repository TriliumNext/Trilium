import FBranch from "../../../entities/fbranch";
import FNote from "../../../entities/fnote";
import { INBOX_COLUMN, resolveBoardColumns } from "./columns";
import { BoardColumnData, BoardViewData } from "./index";

export type ColumnMap = Map<string, {
    branch: FBranch;
    note: FNote;
}[]>;

/**
 * The columns as they stand once a card has moved, for drawing the outcome before the writes land.
 *
 * A card crossing columns is written twice, the value first and the branch after, and each lands a
 * redraw of its own. The first shows the card in its new column at whatever place its old branch
 * gives it, which is above every card already there.
 *
 * @param index where the card goes, counting the target column as it stands at the moment of the
 *              drop, the card itself included where it does not leave its column.
 */
export function applyCardMove(
    byColumn: ColumnMap, noteId: string, from: string, to: string, index: number
): ColumnMap {
    const source = [ ...(byColumn.get(from) ?? []) ];
    const at = source.findIndex((item) => item.note.noteId === noteId);
    if (at < 0) {
        return byColumn;
    }

    const [ moved ] = source.splice(at, 1);
    const next = new Map(byColumn);
    next.set(from, source);

    const target = from === to ? source : [ ...(byColumn.get(to) ?? []) ];
    // Taking the card out shifts everything after it up one, so a place beyond where it stood
    // names one card earlier in the list left behind.
    target.splice(from === to && index > at ? index - 1 : index, 0, moved);
    next.set(to, target);

    return next;
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
    const storedColumnValues = (persistedData.columns ?? []).map(c => c.value);
    // Turning the inbox on adds it to the board, at the front. After that the entry belongs to
    // the config: it keeps its icon, colour and position, and turning the inbox off leaves it in
    // place.
    const persistedColumns = inboxEnabled && !storedColumnValues.includes(INBOX_COLUMN)
        ? [ INBOX_COLUMN, ...storedColumnValues ]
        : storedColumnValues;

    // Only a board with an inbox has somewhere to put an unassigned note; on any other board such
    // a note is not shown at all, as before.
    const inbox = inboxEnabled
        ? { nested: !!persistedData.columns?.find(col => col.value === INBOX_COLUMN)?.nested }
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
    const storedColumns = indexColumnsByResolvedName(persistedData, pendingRenames);

    return {
        byColumn,
        columns,
        settledRenames,
        newPersistedData: hasChanges
            ? {
                ...persistedData,
                columns: columns.map(value => storedColumns.get(value) ?? { value })
            }
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
    persistedData: BoardViewData,
    pendingRenames: ReadonlyMap<string, string | undefined>
) {
    const byName = new Map<string, BoardColumnData>();

    for (const column of persistedData.columns ?? []) {
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
