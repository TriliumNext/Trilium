import "./index.css";

import { createPortal } from "preact";
import { lazy, Suspense } from "preact/compat";
import { useCallback, useContext, useEffect, useMemo, useRef, useState } from "preact/hooks";
import { DataTreeModule, EditModule, FormatModule, FrozenColumnsModule, InteractionModule, MoveColumnsModule, MoveRowsModule, Options, PersistenceModule, ResizeColumnsModule, RowComponent,SortModule, Tabulator as VanillaTabulator} from 'tabulator-tables';

import { t } from "../../../services/i18n";
import SpacedUpdate from "../../../services/spaced_update";
import CollectionProperties from "../../note_bars/CollectionProperties";
import Button, { ButtonOrActionButton } from "../../react/Button";
import { useEffectiveReadOnly, useNoteContext } from "../../react/hooks";
import { ParentComponent } from "../../react/react_utils";
import { ViewModeProps } from "../interface";
import { useContextMenu } from "./context_menu";
import useData, { TableConfig } from "./data";
import type { TableEditingEvents } from "./editing";
import { TableData } from "./rows";
import Tabulator from "./tabulator";

const TableEditing = lazy(() => import("./editing"));

/** What every table shows with; an editable one adds {@link EDITING_MODULES}. */
const VIEW_MODULES = [ SortModule, FormatModule, InteractionModule, ResizeColumnsModule, FrozenColumnsModule, PersistenceModule, MoveColumnsModule, DataTreeModule ];
const EDITING_MODULES = [ ...VIEW_MODULES, EditModule, MoveRowsModule ];

export default function TableView({ note, noteIds, viewConfig, saveConfig }: ViewModeProps<TableConfig>) {
    const tabulatorRef = useRef<VanillaTabulator>(null);
    const parentComponent = useContext(ParentComponent);
    // The scrolled area under the rows, where the "new row" strip is portaled — reached for anew
    // each time the table is built, as flipping into or out of a tree rebuilds it from scratch.
    const [ rowsHolderEl, setRowsHolderEl ] = useState<Element | null>(null);
    // The rendered width of the "#" column, which the strip's button sits past so that it lines up
    // with the title column, the way the row it stands for would. Measured rather than derived: the
    // width follows the row count's digits and the drag handles, both of which the columns are
    // rebuilt over — and the child effect applying the new columns runs before this one measures.
    const [ handleColWidth, setHandleColWidth ] = useState(0);

    const { noteContext } = useNoteContext();
    const isReadOnly = useEffectiveReadOnly(note, noteContext);
    const canAddRows = !isReadOnly && note.type !== "search";
    const contextMenuEvents = useContextMenu(note, parentComponent, tabulatorRef, isReadOnly);
    const persistenceProps = usePersistence(viewConfig, saveConfig);
    const [ editingEvents, setEditingEvents ] = useState<TableEditingEvents>();
    const newAttributePosition = useRef<number | undefined>(undefined);
    const resetNewAttributePosition = useRef<() => void>(() => { newAttributePosition.current = undefined; });
    const { columnDefs, rowData, movableRows, hasChildren } = useData(
        note, noteIds, viewConfig, newAttributePosition, () => resetNewAttributePosition.current(), isReadOnly);
    const dataTreeProps = useMemo<Options>(() => {
        if (!hasChildren) return {};
        return {
            dataTree: true,
            dataTreeStartExpanded: true,
            dataTreeBranchElement: false,
            dataTreeElementColumn: "title",
            dataTreeChildIndent: 20,
            dataTreeExpandElement: `<button class="tree-expand"><span class="bx bx-chevron-right"></span></button>`,
            dataTreeCollapseElement: `<button class="tree-collapse"><span class="bx bx-chevron-down"></span></button>`
        };
    }, [ hasChildren ]);

    const rowFormatter = useCallback((row: RowComponent) => {
        const data = row.getData() as TableData;
        row.getElement().classList.toggle("archived", !!data.isArchived);
    }, []);

    useEffect(() => {
        if (!rowsHolderEl) return;
        setHandleColWidth(tabulatorRef.current?.getColumns()[0]?.getWidth() ?? 0);
    }, [ rowsHolderEl, columnDefs ]);

    return (
        <div className="table-view">
            <CollectionProperties
                note={note}
                rightChildren={canAddRows &&
                    <>
                        <ButtonOrActionButton triggerCommand="addNewRow" icon="bx bx-plus" text={t("table_view.new-row")} />
                        <ButtonOrActionButton triggerCommand="addNewTableColumn" icon="bx bx-carousel" text={t("table_view.new-column")} />
                    </>
                }
            />

            {rowData !== undefined && persistenceProps &&  (
                <>
                    <Tabulator
                        // Built anew when the note turns editable, as a table takes its modules when built.
                        key={isReadOnly ? "read-only" : "editable"}
                        tabulatorRef={tabulatorRef}
                        className="table-view-container"
                        columns={columnDefs ?? []}
                        data={rowData}
                        modules={isReadOnly ? VIEW_MODULES : EDITING_MODULES}
                        events={{
                            ...contextMenuEvents,
                            ...(isReadOnly ? {} : editingEvents)
                        }}
                        persistence {...persistenceProps}
                        layout="fitDataFill"
                        index="branchId"
                        movableColumns
                        movableRows={movableRows}
                        rowFormatter={rowFormatter}
                        onReady={() => setRowsHolderEl(
                            tabulatorRef.current?.element.querySelector(".tabulator-tableholder") ?? null
                        )}
                        {...dataTreeProps}
                    />
                    {canAddRows && rowsHolderEl && createPortal(
                        <div
                            className="table-new-row-strip"
                            style={{ "--row-handle-column-width": `${handleColWidth}px` }}
                        >
                            <Button
                                className="table-new-row"
                                kind="lowProfile"
                                icon="bx-plus"
                                text={t("table_view.new-row")}
                                triggerCommand="addNewRow"
                            />
                        </div>,
                        rowsHolderEl
                    )}
                </>
            )}
            {!isReadOnly && (
                <Suspense fallback={null}>
                    <TableEditing
                        tabulatorRef={tabulatorRef}
                        note={note}
                        newAttributePosition={newAttributePosition}
                        setResetNewAttributePosition={(reset) => { resetNewAttributePosition.current = reset; }}
                        setEvents={setEditingEvents}
                    />
                </Suspense>
            )}
        </div>
    );
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
    }, [ viewConfig, saveConfig ]);

    return persistenceProps;
}
