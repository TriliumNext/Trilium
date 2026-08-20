import FBranch from "../../../entities/fbranch";
import FNote from "../../../entities/fnote";
import {
    isRecentlyRemovedColumn,
    resolveBoardColumns,
    unnoteColumnRemoved
} from "./columns";
import { BoardViewData } from "./index";

export type ColumnMap = Map<string, {
    branch: FBranch;
    note: FNote;
}[]>;

/**
 * @param definitionOptions the choices the board's group-by definition offers, empty when it has no
 *                          select definition of its own to lead the column order.
 * @param persistedColumnsAreMirror whether the persisted columns are a mirror of this resolution
 *                                  because the board owns the definition (see resolveBoardColumns).
 */
export async function getBoardData(
    parentNote: FNote,
    groupByColumn: string,
    persistedData: BoardViewData,
    includeArchived: boolean,
    definitionOptions: string[] = [],
    persistedColumnsAreMirror = false
) {
    const byColumn: ColumnMap = new Map();

    // First, scan all notes to find what columns actually exist
    await recursiveGroupBy(parentNote.getChildBranches(), byColumn, groupByColumn, includeArchived, new Set<string>());

    // For a board that owns its definition the persisted list is only a mirror of the
    // resolved columns, so a value the board's column UI removed must not linger in it
    // while the definition write is still in flight (#11100). Values nothing removed are
    // never dropped: a column added a moment ago is equally absent from the other two
    // sources, and dropping it would lose the user's work.
    // A removed value a note carries again was recreated by intent (another
    // split, a synced client, a script) — clear its mark so the mirror filter
    // stops applying from this refresh on. The stale-definition leg of the
    // original delete race must NOT clear the mark, so only discovered note
    // values do.
    for (const value of byColumn.keys()) {
        if (isRecentlyRemovedColumn(parentNote.noteId, value)) {
            unnoteColumnRemoved(parentNote.noteId, value);
        }
    }

    const persistedValues = (persistedData.columns ?? []).map(c => c.value);
    const persistedColumns = persistedColumnsAreMirror
        ? persistedValues.filter(value => !isRecentlyRemovedColumn(parentNote.noteId, value))
        : persistedValues;
    const columns = resolveBoardColumns(
        definitionOptions, persistedColumns, [ ...byColumn.keys() ]
    );

    // A column the notes have nothing in is still a column, so every resolved one gets an entry.
    for (const column of columns) {
        if (!byColumn.has(column)) {
            byColumn.set(column, []);
        }
    }

    // The attachment mirrors the resolved list, so a board whose columns now come from its definition
    // stays readable by anything still reading the attachment. Written only when it actually differs,
    // or every refresh would save.
    const hasChanges = persistedColumns.length !== columns.length
        || persistedColumns.some((value, index) => columns[index] !== value);

    return {
        byColumn,
        columns,
        newPersistedData: hasChanges
            ? { ...persistedData, columns: columns.map(value => ({ value })) }
            : undefined,
        isInRelationMode: groupByColumn.startsWith("~")
    };
}

async function recursiveGroupBy(branches: FBranch[], byColumn: ColumnMap, groupByColumn: string, includeArchived: boolean, seenNoteIds: Set<string>) {
    for (const branch of branches) {
        const note = await branch.getNote();
        if (!note || (!includeArchived && note.isArchived)) continue;

        if (note.type !== "search" && note.hasChildren()) {
            await recursiveGroupBy(note.getChildBranches(), byColumn, groupByColumn, includeArchived, seenNoteIds);
        }

        const group = note.getLabelOrRelation(groupByColumn);
        if (!group || seenNoteIds.has(note.noteId)) {
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
