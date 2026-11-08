import type { ColumnDefinition } from "tabulator-tables";
import FNote from "../../../entities/fnote";
import { useNoteLabelBoolean, useNoteLabelInt, useTriliumEvent } from "../../react/hooks";
import { ParentComponent } from "../../react/react_utils";
import { useContext, useEffect, useRef, useState } from "preact/hooks";
import getAttributeDefinitionInformation, { buildRowDefinitions, TableData } from "./rows";
import froca from "../../../services/froca";
import { buildColumnDefinitions } from "./columns";
import attributes from "../../../services/attributes";
import { RefObject } from "preact";
import { sameNoteIds } from "../NoteList";

export interface TableConfig {
    tableData: {
        columns?: ColumnDefinition[];
    };
}

/** `isReadOnly` builds the columns without editors and keeps the rows from being dragged. */
export default function useData(note: FNote, noteIds: string[], viewConfig: TableConfig | undefined, newAttributePosition: RefObject<number | undefined> | undefined, resetNewAttributePosition: () => void, isReadOnly = false) {
    const [ maxDepth ] = useNoteLabelInt(note, "maxNestingDepth");
    const [ includeArchived ] = useNoteLabelBoolean(note, "includeArchived");
    // Whose writes these are, so that the table can tell a definition it changed itself from one
    // changed elsewhere — rebuilding for its own would pull the open editor out from under the user.
    const componentId = useContext(ParentComponent)?.componentId;

    const [ columnDefs, setColumnDefs ] = useState<ColumnDefinition[]>();
    const [ rowData, setRowData ] = useState<TableData[]>();
    const [ hasChildren, setHasChildren ] = useState<boolean>();
    const [ isSorted ] = useNoteLabelBoolean(note, "sorted");
    const canMoveRows = !isReadOnly && !isSorted && note.type !== "search";
    const movableRows = canMoveRows && !hasChildren;
    const latestRefreshId = useRef(0);
    const columnsPending = useRef(false);
    // Whether the current columns carry the row handle, which a refresh compares against the
    // subtree it finds rather than waiting for `hasChildren` to trigger another refresh.
    const columnsMovable = useRef<boolean | undefined>(undefined);
    // The children the latest refresh walked, so that the note list arriving after the mount
    // refresh does not walk the same tree again.
    const walkedChildren = useRef<string[]>([]);
    const lastNoteIds = useRef(noteIds);

    // Rows change far more often than the columns do, and rebuilding the columns is not free: they
    // are replaced wholesale in Tabulator, which resets the scroll — so a refresh only rebuilds
    // them when asked, and a change that can only touch rows leaves them be.
    //
    // Only the latest refresh commits its result, as an older one holds stale values such as
    // `movableRows`; it takes over the column rebuild of any refresh it supersedes.
    async function refresh(rebuildColumns = true) {
        const refreshId = ++latestRefreshId.current;
        columnsPending.current ||= rebuildColumns;
        walkedChildren.current = [ ...note.children ];
        const info = getAttributeDefinitionInformation(note);

        const { definitions: rowData, hasSubtree: hasChildren, rowNumber } = await buildRowDefinitions(note, info, includeArchived, maxDepth);
        if (refreshId !== latestRefreshId.current) return;
        const movableRows = canMoveRows && !hasChildren;
        if (columnsPending.current || movableRows !== columnsMovable.current) {
            columnsPending.current = false;
            columnsMovable.current = movableRows;
            const columnDefs = buildColumnDefinitions({
                info,
                movableRows,
                existingColumnData: viewConfig?.tableData?.columns,
                rowNumberHint: rowNumber,
                position: newAttributePosition?.current ?? undefined,
                // Read from the note as a cell is opened rather than taken from `info`, which was read
                // when the columns were last built: a definition can gain an option from the very editor
                // that is open, and the table does not rebuild for a change of its own.
                currentSelectOptions: (columnName) => getAttributeDefinitionInformation(note)
                    .find((definition) => definition.name === columnName)?.options,
                onCreateSelectOption: (columnName, option) => addSelectOption(note, columnName, option, componentId)
            });
            setColumnDefs(isReadOnly ? columnDefs.map(withoutEditor) : columnDefs);
            resetNewAttributePosition();
        }
        setRowData(rowData);
        setHasChildren(hasChildren);
    }

    useEffect(() => { refresh() }, [ note, includeArchived, maxDepth, canMoveRows, isReadOnly ]);

    // The rows come from the note's branches, so a new note list only needs a refresh when it
    // differs from the children the latest refresh walked, such as a search collection run again.
    useEffect(() => {
        if (noteIds === lastNoteIds.current) return;
        lastNoteIds.current = noteIds;
        const expected = walkedChildren.current.filter((noteId) => noteId !== "_hidden"
            && (includeArchived || note.type === "search" || !froca.getNoteFromCache(noteId)?.isArchived));
        if (!sameNoteIds(noteIds, expected)) {
            refresh(false);
        }
    }, [ noteIds ]);

    useTriliumEvent("entitiesReloaded", ({ loadResults}) => {
        if (glob.device === "print") return;

        // React to column changes, barring those this table made itself: rebuilding the columns
        // replaces them wholesale, which takes down the editor that asked for the change — losing,
        // in a multi-valued cell, the values gathered but not yet handed over.
        if (loadResults.getAttributeRows(componentId).find(attr =>
            attr.type === "label" &&
            (attr.name?.startsWith("label:") || attr.name?.startsWith("relation:")) &&
            attributes.isAffecting(attr, note))) {
            refresh();
            return;
        }

        // React to external row updates, barring those this table made itself: rebuilding the rows
        // replaces them wholesale in Tabulator, which cancels the cell editor that Tab has just
        // opened — the cell the edit came from already shows what was committed to it.
        //
        // Only the rows: rebuilding the columns replaces them too, which would throw away the
        // scroll position on every edit.
        if (loadResults.getBranchRows().some(branch => branch.parentNoteId === note.noteId || noteIds.includes(branch.parentNoteId ?? ""))
            || noteIds.some(noteId => loadResults.isNoteReloaded(noteId, componentId))
            || loadResults.getAttributeRows(componentId).some(attr => noteIds.includes(attr.noteId ?? ""))) {
            refresh(false);
            return;
        }
    });

    return { columnDefs, rowData, movableRows, hasChildren };
}

function withoutEditor({ editor, editorParams, ...column }: ColumnDefinition): ColumnDefinition {
    return { ...column, editable: false };
}

/**
 * Adds an option to the definition a select column reads from, for the entry its editor offers on a
 * value the column does not list yet. The definition is looked up as the columns themselves are, so
 * an inherited one is written where it lives and the option reaches every note the field covers.
 *
 * Stamped with the table's own component id, so that the reload it causes does not rebuild the
 * columns underneath the editor that asked for it. The option still reaches the cache, which is
 * where a cell being opened reads the choices it offers.
 */
async function addSelectOption(parentNote: FNote, columnName: string, option: string, componentId?: string) {
    const definitionAttr = parentNote.getAttributeDefinitions()
        .find((attr) => attr.name === `label:${columnName}`);
    if (definitionAttr) {
        await attributes.addSelectOption(definitionAttr, option, componentId);
    }
}
