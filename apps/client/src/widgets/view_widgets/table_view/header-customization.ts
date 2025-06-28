import { GridApi } from "ag-grid-community";
import contextMenu, { MenuItem } from "../../../menus/context_menu.js";
import { TableData } from "./data.js";

export default function applyHeaderCustomization(baseEl: HTMLElement, api: GridApi<TableData>) {
    const header = baseEl.querySelector(".ag-header");
    if (!header) {
        return;
    }

    header.addEventListener("contextmenu", (e) => {
        e.preventDefault();


        contextMenu.show({
            items: [
                {
                    title: "Columns",
                    items: buildColumnChooser(api)
                }
            ],
            x: e.pageX,
            y: e.pageY,
            selectMenuItemHandler: () => {}
        });
    });
}

export function buildColumnChooser(api: GridApi<TableData>) {
    const items: MenuItem<unknown>[] = [];

    for (const column of api.getColumns() ?? []) {
        const colDef = column.getColDef();
        if (!colDef) {
            continue;
        }

        const visible = column.isVisible();
        items.push({
            title: colDef.headerName ?? api.getDisplayNameForColumn(column, "header") ?? "",
            checked: visible,
            handler() {
                api.setColumnsVisible([ column ], !visible);
            }
        });
    }

    return items;
}
