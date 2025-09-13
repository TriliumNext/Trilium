import FBranch from "../../../entities/fbranch";
import FNote from "../../../entities/fnote";
import { BoardViewData } from "./index";

export type ColumnMap = Map<string, {
    branch: FBranch;
    note: FNote;
}[]>;

export async function getBoardData(parentNote: FNote, groupByColumn: string, persistedData: BoardViewData, includeArchived: boolean) {
    const byColumn: ColumnMap = new Map();

    // First, scan all notes to find what columns actually exist
    await recursiveGroupBy(parentNote.getChildBranches(), byColumn, groupByColumn, includeArchived);

    // Get all columns that exist in the notes
    const columnsFromNotes = [...byColumn.keys()];

    // Get existing persisted columns and preserve their order
    const existingPersistedColumns = persistedData.columns || [];
    const existingColumnValues = existingPersistedColumns.map(c => c.value);

    // Find truly new columns (exist in notes but not in persisted data)
    const newColumnValues = columnsFromNotes.filter(col => !existingColumnValues.includes(col));

    // Build the complete correct column list: existing + new
    const allColumns = [
        ...existingPersistedColumns, // Preserve existing order
        ...newColumnValues.map(value => ({ value })) // Add new columns
    ];

    // Remove duplicates (just in case) and ensure we only keep columns that exist in notes or are explicitly preserved
    const deduplicatedColumns = allColumns.filter((column, index) => {
        const firstIndex = allColumns.findIndex(c => c.value === column.value);
        return firstIndex === index; // Keep only the first occurrence
    });

    // Ensure all persisted columns have empty arrays in byColumn (even if no notes use them)
    for (const column of deduplicatedColumns) {
        if (!byColumn.has(column.value)) {
            byColumn.set(column.value, []);
        }
    }

    // Return updated persisted data only if there were changes
    let newPersistedData: BoardViewData | undefined;
    const hasChanges = newColumnValues.length > 0 ||
                      existingPersistedColumns.length !== deduplicatedColumns.length ||
                      !existingPersistedColumns.every((col, idx) => deduplicatedColumns[idx]?.value === col.value);

    if (hasChanges) {
        newPersistedData = {
            ...persistedData,
            columns: deduplicatedColumns
        };
    }

    return {
        byColumn,
        newPersistedData
    };
}

async function recursiveGroupBy(branches: FBranch[], byColumn: ColumnMap, groupByColumn: string, includeArchived: boolean) {
    for (const branch of branches) {
        const note = await branch.getNote();
        if (!note || (!includeArchived && note.isArchived)) continue;

        if (note.hasChildren()) {
            await recursiveGroupBy(note.getChildBranches(), byColumn, groupByColumn, includeArchived);
        }

        const group = note.getLabelValue(groupByColumn);
        if (!group) {
            continue;
        }

        if (!byColumn.has(group)) {
            byColumn.set(group, []);
        }
        byColumn.get(group)!.push({
            branch,
            note
        });
    }
}
