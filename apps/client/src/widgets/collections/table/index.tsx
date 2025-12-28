import { useCallback, useContext, useEffect, useMemo, useRef, useState } from "preact/hooks";
import { ViewModeProps } from "../interface";
import { TableData } from "./rows";
import { useLegacyWidget } from "../../react/hooks";
import Tabulator from "./tabulator";
import { Tabulator as VanillaTabulator, SortModule, FormatModule, InteractionModule, EditModule, ResizeColumnsModule, FrozenColumnsModule, PersistenceModule, MoveColumnsModule, MoveRowsModule, DataTreeModule, Options, RowComponent} from 'tabulator-tables';
import { useContextMenu } from "./context_menu";
import { ParentComponent } from "../../react/react_utils";
import FNote from "../../../entities/fnote";
import { t } from "../../../services/i18n";
import Button from "../../react/Button";
import "./index.css";
import useRowTableEditing from "./row_editing";
import useColTableEditing from "./col_editing";
import AttributeDetailWidget from "../../attribute_widgets/attribute_detail";
import SpacedUpdate from "../../../services/spaced_update";
import useData, { TableConfig } from "./data";

export default function TableView({ note, noteIds, notePath, viewConfig, saveConfig }: ViewModeProps<TableConfig>) {
    const tabulatorRef = useRef<VanillaTabulator>(null);
    const parentComponent = useContext(ParentComponent);

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
            dataTreeCollapseElement: `<button class="tree-collapse"><span class="bx bx-chevron-down"></span></button>`
        }
    }, [ hasChildren ]);

    const rowFormatter = useCallback((row: RowComponent) => {
        const data = row.getData() as TableData;
        row.getElement().classList.toggle("archived", !!data.isArchived);
    }, []);

    return (
        <div className="table-view">
            {rowData !== undefined && persistenceProps &&  (
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
                            ...rowEditingEvents
                        }}
                        persistence {...persistenceProps}
                        layout="fitDataFill"
                        index="branchId"
                        movableColumns
                        movableRows={movableRows}
                        rowFormatter={rowFormatter}
                        {...dataTreeProps}
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
    }, [ viewConfig, saveConfig ]);

    return persistenceProps;
}
