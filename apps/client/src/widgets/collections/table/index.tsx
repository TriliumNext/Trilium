import { useCallback, useContext, useEffect, useMemo, useRef, useState } from "preact/hooks";
import { ViewModeProps } from "../interface";
import { buildColumnDefinitions } from "./columns";
import getAttributeDefinitionInformation, { buildRowDefinitions, TableData } from "./rows";
import { useLegacyWidget, useNoteLabelBoolean, useNoteLabelInt, useSpacedUpdate, useTriliumEvent } from "../../react/hooks";
import Tabulator from "./tabulator";
import { Tabulator as VanillaTabulator, SortModule, FormatModule, InteractionModule, EditModule, ResizeColumnsModule, FrozenColumnsModule, PersistenceModule, MoveColumnsModule, MoveRowsModule, ColumnDefinition, DataTreeModule, Options, RowComponent} from 'tabulator-tables';
import { useContextMenu } from "./context_menu";
import { ParentComponent } from "../../react/react_utils";
import FNote from "../../../entities/fnote";
import { t } from "../../../services/i18n";
import Button from "../../react/Button";
import "./index.css";
import useRowTableEditing from "./row_editing";
import useColTableEditing from "./col_editing";
import AttributeDetailWidget from "../../attribute_widgets/attribute_detail";
import attributes from "../../../services/attributes";
import { RefObject } from "preact";
import SpacedUpdate from "../../../services/spaced_update";

interface TableConfig {
    tableData: {
        columns?: ColumnDefinition[];
    };
}

export default function TableView({ note, noteIds, notePath, viewConfig, saveConfig }: ViewModeProps<TableConfig>) {
    const tabulatorRef = useRef<VanillaTabulator>(null);
    const parentComponent = useContext(ParentComponent);
    const expandedRowsRef = useRef<Set<string>>(new Set());
    const isDataRefreshingRef = useRef<boolean>(false);
    
    // Load persisted expansion state on mount
    useEffect(() => {
        const storageKey = `trilium-tree-expanded-${note.noteId}`;
        try {
            const stored = localStorage.getItem(storageKey);
            if (stored) {
                const expandedIds = JSON.parse(stored);
                expandedRowsRef.current = new Set(expandedIds);
                console.log('Loaded expansion state from storage:', expandedIds);
            }
        } catch (e) {
            console.warn('Failed to load tree expansion state:', e);
        }
    }, [note.noteId]);
    
    // Save expansion state changes to localStorage
    const persistExpandedState = useCallback(() => {
        const storageKey = `trilium-tree-expanded-${note.noteId}`;
        try {
            const expandedIds = Array.from(expandedRowsRef.current);
            localStorage.setItem(storageKey, JSON.stringify(expandedIds));
        } catch (e) {
            console.warn('Failed to save tree expansion state:', e);
        }
    }, [note.noteId]);

    const [ attributeDetailWidgetEl, attributeDetailWidget ] = useLegacyWidget(() => new AttributeDetailWidget().contentSized());
    const contextMenuEvents = useContextMenu(note, parentComponent, tabulatorRef);
    const persistenceProps = usePersistence(viewConfig, saveConfig);
    const rowEditingEvents = useRowTableEditing(tabulatorRef, attributeDetailWidget, notePath);
    const { newAttributePosition, resetNewAttributePosition } = useColTableEditing(tabulatorRef, attributeDetailWidget, note);
    const { columnDefs, rowData, movableRows, hasChildren } = useData(note, noteIds, viewConfig, newAttributePosition, resetNewAttributePosition);
    const dataTreeProps = useMemo<Options>(() => {
        if (!hasChildren) return {};
        return {
            dataTree: true,
            dataTreeStartExpanded: true,
            dataTreeBranchElement: false,
            dataTreeElementColumn: "title", 
            dataTreeChildIndent: 20,
            dataTreeExpandElement: `<button class="tree-expand"><span class="bx bx-chevron-right"></span></button>`,
            dataTreeCollapseElement: `<button class="tree-collapse"><span class="bx bx-chevron-down"></span></button>`,
            persistenceMode: "local",
            persistence: {
                tree: true
            }
        }
    }, [ hasChildren ]);

    const rowFormatter = useCallback((row: RowComponent) => {
        const data = row.getData() as TableData;
        row.getElement().classList.toggle("archived", !!data.isArchived);
    }, []);

    return (
        <div className="table-view">
            {persistenceProps &&  (
                <>
                    <Tabulator
                        tabulatorRef={tabulatorRef}
                        className="table-view-container"
                        columns={columnDefs ?? []}
                        data={rowData}
                        modules={[ SortModule, FormatModule, InteractionModule, EditModule, ResizeColumnsModule, FrozenColumnsModule, PersistenceModule, MoveColumnsModule, MoveRowsModule, DataTreeModule ]}
                        footerElement={<TableFooter note={note} />}
                        events={{
                            ...contextMenuEvents,
                            ...rowEditingEvents,
                            tableBuilt: () => {
                                console.log('Table built - setting up tree event tracking');
                            },
                            // Try all possible expand event names
                            rowTreeExpanded: (row) => {
                                const data = row.getData() as TableData;
                                console.log('Row expanded (rowTreeExpanded):', data.branchId, data.title, 'refreshing:', isDataRefreshingRef.current);
                                if (data.branchId && !isDataRefreshingRef.current) {
                                    expandedRowsRef.current.add(data.branchId);
                                    console.log('Updated expanded set:', Array.from(expandedRowsRef.current));
                                    persistExpandedState();
                                }
                            },
                            dataTreeRowExpanded: (row) => {
                                const data = row.getData() as TableData;
                                console.log('Row expanded (dataTreeRowExpanded):', data.branchId, data.title, 'refreshing:', isDataRefreshingRef.current);
                                if (data.branchId && !isDataRefreshingRef.current) {
                                    expandedRowsRef.current.add(data.branchId);
                                    console.log('Updated expanded set:', Array.from(expandedRowsRef.current));
                                    persistExpandedState();
                                }
                                // Call the original context menu handler if it exists
                                if (contextMenuEvents.dataTreeRowExpanded) {
                                    contextMenuEvents.dataTreeRowExpanded(row);
                                }
                            },
                            treeExpanded: (row) => {
                                const data = row.getData() as TableData;
                                console.log('Row expanded (treeExpanded):', data.branchId, data.title, 'refreshing:', isDataRefreshingRef.current);
                                if (data.branchId && !isDataRefreshingRef.current) {
                                    expandedRowsRef.current.add(data.branchId);
                                    console.log('Updated expanded set:', Array.from(expandedRowsRef.current));
                                    persistExpandedState();
                                }
                            },
                            // Try all possible collapse event names
                            rowTreeCollapsed: (row) => {
                                const data = row.getData() as TableData;
                                console.log('Row collapsed (rowTreeCollapsed):', data.branchId, data.title, 'refreshing:', isDataRefreshingRef.current);
                                if (data.branchId && !isDataRefreshingRef.current) {
                                    expandedRowsRef.current.delete(data.branchId);
                                    console.log('Updated expanded set:', Array.from(expandedRowsRef.current));
                                    persistExpandedState();
                                }
                            },
                            dataTreeRowCollapsed: (row) => {
                                const data = row.getData() as TableData;
                                console.log('Row collapsed (dataTreeRowCollapsed):', data.branchId, data.title, 'refreshing:', isDataRefreshingRef.current);
                                if (data.branchId && !isDataRefreshingRef.current) {
                                    expandedRowsRef.current.delete(data.branchId);
                                    console.log('Updated expanded set:', Array.from(expandedRowsRef.current));
                                    persistExpandedState();
                                }
                                // Call the original context menu handler if it exists
                                if (contextMenuEvents.dataTreeRowCollapsed) {
                                    contextMenuEvents.dataTreeRowCollapsed(row);
                                }
                            },
                            treeCollapsed: (row) => {
                                const data = row.getData() as TableData;
                                console.log('Row collapsed (treeCollapsed):', data.branchId, data.title, 'refreshing:', isDataRefreshingRef.current);
                                if (data.branchId && !isDataRefreshingRef.current) {
                                    expandedRowsRef.current.delete(data.branchId);
                                    console.log('Updated expanded set:', Array.from(expandedRowsRef.current));
                                    persistExpandedState();
                                }
                            }
                        }}
                        persistence {...persistenceProps}
                        layout="fitDataFill"
                        index="branchId"
                        movableColumns
                        movableRows={movableRows}
                        rowFormatter={rowFormatter}
                        preserveTreeState={hasChildren}
                        expandedRowsRef={expandedRowsRef}
                        isDataRefreshingRef={isDataRefreshingRef}
                        {...dataTreeProps}
                        dataTreeStartExpanded={(row, level) => {
                            if (expandedRowsRef.current && expandedRowsRef.current.size > 0) {
                                const rowData = row.getData() as TableData;
                                const isExpanded = expandedRowsRef.current.has(rowData.branchId);
                                console.log(`dataTreeStartExpanded called for ${rowData.branchId}: ${isExpanded}`);
                                return isExpanded;
                            }
                            return false; // Default collapsed state
                        }}
                    />
                    <TableFooter note={note} />
                </>
            )}
            {attributeDetailWidgetEl}
        </div>
    )
}

function TableFooter({ note }: { note: FNote }) {
    return (note.type !== "search" &&
        <div className="tabulator-footer">
            <div className="tabulator-footer-contents">
                <Button triggerCommand="addNewRow" icon="bx bx-plus" text={t("table_view.new-row")} />
                {" "}
                <Button triggerCommand="addNewTableColumn" icon="bx bx-carousel" text={t("table_view.new-column")} />
            </div>
        </div>
    )
}

function usePersistence(viewConfig: TableConfig | null | undefined, saveConfig: (newConfig: TableConfig) => void) {
    const [ persistenceProps, setPersistenceProps ] = useState<Pick<Options, "persistenceReaderFunc" | "persistenceWriterFunc">>();

    useEffect(() => {
        const viewConfigLocal = viewConfig ?? { tableData: {} };
        const spacedUpdate = new SpacedUpdate(() => {
            saveConfig(viewConfigLocal);
        }, 5_000);

        setPersistenceProps({
            persistenceReaderFunc(_, type) {
                return viewConfigLocal.tableData?.[type];
            },
            persistenceWriterFunc(_, type, data) {
                (viewConfigLocal.tableData as Record<string, {}>)[type] = data;
                spacedUpdate.scheduleUpdate();
            },
        });

        return () => {
            spacedUpdate.updateNowIfNecessary();
        };
    }, [ viewConfig, saveConfig ])

    return persistenceProps;
}

function useData(note: FNote, noteIds: string[], viewConfig: TableConfig | undefined, newAttributePosition: RefObject<number | undefined>, resetNewAttributePosition: () => void) {
    const [ maxDepth ] = useNoteLabelInt(note, "maxNestingDepth") ?? -1;
    const [ includeArchived ] = useNoteLabelBoolean(note, "includeArchived");

    const [ columnDefs, setColumnDefs ] = useState<ColumnDefinition[]>();
    const [ rowData, setRowData ] = useState<TableData[]>();
    const [ hasChildren, setHasChildren ] = useState<boolean>();
    const [ isSorted ] = useNoteLabelBoolean(note, "sorted");
    const [ movableRows, setMovableRows ] = useState(false);

    function refresh() {
        console.log('🔄 TABLE REFRESH TRIGGERED');
        console.trace('Refresh call stack'); // This will show us what triggered it
        
        const info = getAttributeDefinitionInformation(note);

        buildRowDefinitions(note, info, includeArchived, maxDepth).then(({ definitions: rowData, hasSubtree: hasChildren, rowNumber }) => {
            const columnDefs = buildColumnDefinitions({
                info,
                movableRows,
                existingColumnData: viewConfig?.tableData?.columns,
                rowNumberHint: rowNumber,
                position: newAttributePosition.current ?? undefined
            });
            setColumnDefs(columnDefs);
            setRowData(rowData);
            setHasChildren(hasChildren);
            resetNewAttributePosition();
        });
    }

    useEffect(() => {
        console.log('⚡ useEffect refresh triggered by:', { note: note.noteId, noteIds: noteIds.length, maxDepth, movableRows });
        // Debounce rapid changes to movableRows
        const timeoutId = setTimeout(() => {
            refresh();
        }, 50);
        return () => clearTimeout(timeoutId);
    }, [ note, noteIds.length, maxDepth ]); // Remove movableRows from dependencies

    const refreshTimeoutRef = useRef<number>();
    
    // Cleanup timeout on unmount
    useEffect(() => {
        return () => {
            if (refreshTimeoutRef.current) {
                clearTimeout(refreshTimeoutRef.current);
            }
        };
    }, []);
    
    useTriliumEvent("entitiesReloaded", ({ loadResults}) => {
        console.log('🔄 entitiesReloaded event triggered');
        console.log('Attributes changed:', loadResults.getAttributeRows().length);
        console.log('Branches changed:', loadResults.getBranchRows().length);
        console.log('Notes changed:', loadResults.getNoteIds().length);
        
        // React to column changes.
        if (loadResults.getAttributeRows().find(attr =>
            attr.type === "label" &&
            (attr.name?.startsWith("label:") || attr.name?.startsWith("relation:")) &&
            attributes.isAffecting(attr, note))) {
            console.log('✅ Refreshing due to column changes');
            // Clear any pending refresh
            if (refreshTimeoutRef.current) {
                clearTimeout(refreshTimeoutRef.current);
            }
            refreshTimeoutRef.current = setTimeout(() => refresh(), 100);
            return;
        }

        // React to external row updates.
        if (loadResults.getBranchRows().some(branch => branch.parentNoteId === note.noteId || noteIds.includes(branch.parentNoteId ?? ""))
            || loadResults.getNoteIds().some(noteId => noteIds.includes(noteId))
            || loadResults.getAttributeRows().some(attr => noteIds.includes(attr.noteId!))
            || loadResults.getAttributeRows().some(attr => attr.name === "archived" && attr.noteId && noteIds.includes(attr.noteId))) {
            console.log('✅ Refreshing due to row updates');
            // Clear any pending refresh and debounce
            if (refreshTimeoutRef.current) {
                clearTimeout(refreshTimeoutRef.current);
            }
            refreshTimeoutRef.current = setTimeout(() => refresh(), 100);
            return;
        }
        
        console.log('❌ No refresh needed for this entitiesReloaded event');
    });

    // Identify if movable rows.
    useEffect(() => {
        setMovableRows(!isSorted && note.type !== "search" && !hasChildren);
    }, [ isSorted, note, hasChildren ]);

    return { columnDefs, rowData, movableRows, hasChildren };
}
