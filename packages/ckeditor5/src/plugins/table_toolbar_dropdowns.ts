import bxSortAlt2 from "boxicons/svg/regular/bx-sort-alt-2.svg?raw";
import { IconTableColumn, IconTableMergeCell, Plugin, Table } from "ckeditor5";

import {
    buttonItem,
    createCommandListDropdown,
    SEPARATOR_ITEM,
    switchItem
} from "./command_list_dropdown.js";
import TableContextMenu from "./table_context_menu.js";
import TableSort from "./table_sort.js";

/**
 * Replaces the `tableColumn` and `mergeTableCells` dropdowns of `TableUI` with copies that add
 * commands of the table context menu: "Distribute columns evenly", "Merge selected cells" and
 * "Unmerge cells". Adds the `tableSort` dropdown.
 *
 * `TableUI` builds its item lists in private methods, so the dropdowns are rebuilt from public
 * helpers and command names instead of patched. The spec compares them with the upstream
 * dropdowns to catch upstream changes on a CKEditor upgrade.
 */
export default class TableToolbarDropdowns extends Plugin {

    static get requires() {
        return [Table, TableContextMenu, TableSort] as const;
    }

    static get pluginName() {
        return "TableToolbarDropdowns" as const;
    }

    init() {
        const editor = this.editor;
        const factory = editor.ui.componentFactory;
        const t = editor.t;
        const isContentLtr = editor.locale.contentLanguageDirection === "ltr";

        // Replaces the dropdowns of `TableUI`, which `Table` initializes before this plugin.
        factory.add("tableColumn", (locale) => createCommandListDropdown(this, locale, {
            label: t("Column"),
            icon: IconTableColumn,
            items: [
                switchItem("setTableColumnHeader", t("Header column")),
                SEPARATOR_ITEM,
                buttonItem(isContentLtr ? "insertTableColumnLeft" : "insertTableColumnRight",
                    t("Insert column left")),
                buttonItem(isContentLtr ? "insertTableColumnRight" : "insertTableColumnLeft",
                    t("Insert column right")),
                buttonItem("removeTableColumn", t("Delete column")),
                buttonItem("selectTableColumn", t("Select column")),
                SEPARATOR_ITEM,
                buttonItem("triliumDistributeTableColumns", t("Distribute columns evenly"))
            ]
        }));

        factory.add("mergeTableCells", (locale) => createCommandListDropdown(this, locale, {
            label: t("Merge cells"),
            icon: IconTableMergeCell,
            splitButtonCommandName: "mergeTableCells",
            items: [
                buttonItem("mergeTableCellUp", t("Merge cell up")),
                buttonItem(isContentLtr ? "mergeTableCellRight" : "mergeTableCellLeft",
                    t("Merge cell right")),
                buttonItem("mergeTableCellDown", t("Merge cell down")),
                buttonItem(isContentLtr ? "mergeTableCellLeft" : "mergeTableCellRight",
                    t("Merge cell left")),
                buttonItem("mergeTableCells", t("Merge selected cells")),
                SEPARATOR_ITEM,
                buttonItem("splitTableCellVertically", t("Split cell vertically")),
                buttonItem("splitTableCellHorizontally", t("Split cell horizontally")),
                buttonItem("triliumResetTableCellSpans", t("Unmerge cells"))
            ]
        }));

        factory.add("tableSort", (locale) => createCommandListDropdown(this, locale, {
            label: t("Sort"),
            icon: bxSortAlt2,
            items: [
                buttonItem("triliumSortTableRowsAscending", t("Ascending")),
                buttonItem("triliumSortTableRowsDescending", t("Descending"))
            ]
        }));
    }

}

declare module "ckeditor5" {
    interface PluginsMap {
        [TableToolbarDropdowns.pluginName]: TableToolbarDropdowns;
    }
}
