import { ColumnComponent, EventCallBackMethods, RowComponent, Tabulator } from "tabulator-tables";
import contextMenu, { MenuItem } from "../../../menus/context_menu.js";
import FNote from "../../../entities/fnote.js";
import { t } from "../../../services/i18n.js";
import { TableData } from "./rows.js";
import link_context_menu from "../../../menus/link_context_menu.js";
import froca from "../../../services/froca.js";
import branches from "../../../services/branches.js";
import Component from "../../../components/component.js";
import NoteColorPicker from "../../../menus/custom-items/NoteColorPicker.jsx";
import { RefObject } from "preact";

export function useContextMenu(parentNote: FNote, parentComponent: Component | null | undefined, tabulator: RefObject<Tabulator>): Partial<EventCallBackMethods> {
    const events: Partial<EventCallBackMethods> = {};
    if (!tabulator || !parentComponent) return events;

    events["rowContext"] = (e, row) => tabulator.current && showRowContextMenu(parentComponent, e as MouseEvent, row, parentNote, tabulator.current);
    events["headerContext"] = (e, col) => tabulator.current && showColumnContextMenu(parentComponent, e as MouseEvent, col, parentNote, tabulator.current);
    events["renderComplete"] = () => {
        const headerRow = tabulator.current?.element.querySelector(".tabulator-header-contents");
        headerRow?.addEventListener("contextmenu", (e) => showHeaderContextMenu(parentComponent, e as MouseEvent, tabulator.current!));
    }
    // Pressing the expand button prevents bubbling and the context menu remains menu when it shouldn't.
    if (tabulator.current?.options.dataTree) {
        const dismissContextMenu = () => contextMenu.hide();
        events["dataTreeRowExpanded"] = dismissContextMenu;
        events["dataTreeRowCollapsed"] = dismissContextMenu;
    }

    return events;
}

function showColumnContextMenu(parentComponent: Component, e: MouseEvent, column: ColumnComponent, parentNote: FNote, tabulator: Tabulator) {
    const { title, field } = column.getDefinition();

    const sorters = tabulator.getSorters();
    const sorter = sorters.find(sorter => sorter.field === field);
    const isUserDefinedColumn = (!!field && (field?.startsWith("labels.") || field?.startsWith("relations.")));

    contextMenu.show({
        items: [
            {
                title: t("table_view.sort-column-by", { title }),
                enabled: !!field,
                uiIcon: "bx bx-sort-alt-2",
                items: [
                    {
                        title: t("table_view.sort-column-ascending"),
                        checked: (sorter?.dir === "asc"),
                        uiIcon: "bx bx-empty",
                        handler: () => tabulator.setSort([
                            {
                                column: field!,
                                dir: "asc",
                            }
                        ])
                    },
                    {
                        title: t("table_view.sort-column-descending"),
                        checked: (sorter?.dir === "desc"),
                        uiIcon: "bx bx-empty",
                        handler: () => tabulator.setSort([
                            {
                                column: field!,
                                dir: "desc"
                            }
                        ])
                    }
                ]
            },
            {
                title: t("table_view.sort-column-clear"),
                enabled: sorters.length > 0,
                uiIcon: "bx bx-x-circle",
                handler: () => tabulator.clearSort()
            },
            {
                kind: "separator"
            },
            {
                title: t("table_view.hide-column", { title }),
                uiIcon: "bx bx-hide",
                handler: () => column.hide()
            },
            {
                title: t("table_view.show-hide-columns"),
                uiIcon: "bx bx-columns",
                items: buildColumnItems(tabulator)
            },
            { kind: "separator" },
            {
                title: t("table_view.add-column-to-the-left"),
                uiIcon: "bx bx-horizontal-left",
                enabled: !column.getDefinition().frozen,
                items: buildInsertSubmenu(parentComponent, column, "before"),
                handler: () => parentComponent?.triggerCommand("addNewTableColumn", {
                    referenceColumn: column
                })
            },
            {
                title: t("table_view.add-column-to-the-right"),
                uiIcon: "bx bx-horizontal-right",
                items: buildInsertSubmenu(parentComponent, column, "after"),
                handler: () => parentComponent?.triggerCommand("addNewTableColumn", {
                    referenceColumn: column,
                    direction: "after"
                })
            },
            { kind: "separator" },
            {
                title: t("table_view.edit-column"),
                uiIcon: "bx bxs-edit-alt",
                enabled: isUserDefinedColumn,
                handler: () => parentComponent?.triggerCommand("addNewTableColumn", {
                    referenceColumn: column,
                    columnToEdit: column
                })
            },
            {
                title: t("table_view.delete-column"),
                uiIcon: "bx bx-trash",
                enabled: isUserDefinedColumn,
                handler: () => parentComponent?.triggerCommand("deleteTableColumn", {
                    columnToDelete: column
                })
            }
        ],
        selectMenuItemHandler() {},
        x: e.pageX,
        y: e.pageY
    });
    e.preventDefault();
}

/**
 * Shows a context menu which has options dedicated to the header area (the part where the columns are, but in the empty space).
 * Provides generic options such as toggling columns.
 */
function showHeaderContextMenu(parentComponent: Component, e: MouseEvent, tabulator: Tabulator) {
    contextMenu.show({
        items: [
            {
                title: t("table_view.show-hide-columns"),
                uiIcon: "bx bx-columns",
                items: buildColumnItems(tabulator)
            },
            { kind: "separator" },
            {
                title: t("table_view.new-column"),
                uiIcon: "bx bx-empty",
                enabled: false
            },
            ...buildInsertSubmenu(parentComponent)
        ],
        selectMenuItemHandler() {},
        x: e.pageX,
        y: e.pageY
    });
    e.preventDefault();
}

export function showRowContextMenu(parentComponent: Component, e: MouseEvent, row: RowComponent, parentNote: FNote, tabulator: Tabulator) {
    const rowData = row.getData() as TableData;
    const sorters = tabulator.getSorters();

    let parentNoteId: string = parentNote.noteId;

    if (tabulator.options.dataTree) {
        const parentRow = row.getTreeParent();
        if (parentRow) {
            parentNoteId = parentRow.getData().noteId as string;
        }
    }

    contextMenu.show({
        items: [
            ...link_context_menu.getItems(e),
            { kind: "separator" },
            {
                title: t("table_view.row-insert-above"),
                uiIcon: "bx bx-horizontal-left bx-rotate-90",
                enabled: !sorters.length,
                handler: () => parentComponent?.triggerCommand("addNewRow", {
                    parentNotePath: parentNoteId,
                    customOpts: {
                        target: "before",
                        targetBranchId: rowData.branchId,
                    }
                })
            },
            {
                title: t("table_view.row-insert-child"),
                uiIcon: "bx bx-subdirectory-right",
                handler: async () => {
                    const branchId = row.getData().branchId;
                    const note = await froca.getBranch(branchId)?.getNote();
                    parentComponent?.triggerCommand("addNewRow", {
                        parentNotePath: note?.noteId,
                        customOpts: {
                            target: "after",
                            targetBranchId: branchId,
                        }
                    });
                }
            },
            {
                title: t("table_view.row-insert-below"),
                uiIcon: "bx bx-horizontal-left bx-rotate-270",
                enabled: !sorters.length,
                handler: () => parentComponent?.triggerCommand("addNewRow", {
                    parentNotePath: parentNoteId,
                    customOpts: {
                        target: "after",
                        targetBranchId: rowData.branchId,
                    }
                })
            },
            { kind: "separator" },
            {
                title: t("table_context_menu.delete_row"),
                uiIcon: "bx bx-trash",
                handler: () => branches.deleteNotes([ rowData.branchId ], false, false)
            },
            { kind: "separator"},
            {
                kind: "custom",
                componentFn: () => NoteColorPicker({note: rowData.noteId})
            }
        ],
        selectMenuItemHandler: ({ command }) =>  link_context_menu.handleLinkContextMenuItem(command, e, rowData.noteId),
        x: e.pageX,
        y: e.pageY
    });
    e.preventDefault();
}

function buildColumnItems(tabulator: Tabulator) {
    const items: MenuItem<unknown>[] = [];
    for (const column of tabulator.getColumns()) {
        const { title } = column.getDefinition();

        items.push({
            title,
            checked: column.isVisible(),
            uiIcon: "bx bx-empty",
            handler: () => column.toggle()
        });
    }

    return items;
}

function buildInsertSubmenu(parentComponent: Component, referenceColumn?: ColumnComponent, direction?: "before" | "after"): MenuItem<unknown>[] {
    return [
        {
            title: t("table_view.new-column-label"),
            uiIcon: "bx bx-hash",
            handler: () => {
                parentComponent?.triggerCommand("addNewTableColumn", {
                    referenceColumn,
                    type: "label",
                    direction
                });
            }
        },
        {
            title: t("table_view.new-column-relation"),
            uiIcon: "bx bx-transfer",
            handler: () => {
                parentComponent?.triggerCommand("addNewTableColumn", {
                    referenceColumn,
                    type: "relation",
                    direction
                });
            }
        }
    ]
}
