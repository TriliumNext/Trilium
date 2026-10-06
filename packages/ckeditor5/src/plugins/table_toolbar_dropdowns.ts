import bxSortAlt2 from "boxicons/svg/regular/bx-sort-alt-2.svg?raw";
import {
    addListToDropdown,
    Collection,
    createDropdown,
    IconTableColumn,
    IconTableMergeCell,
    Plugin,
    SplitButtonView,
    SwitchButtonView,
    Table,
    UIModel
} from "ckeditor5";
import type {
    ButtonExecuteEvent,
    Command,
    DropdownView,
    ListDropdownItemDefinition,
    Locale
} from "ckeditor5";

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
        factory.add("tableColumn", (locale) => this.createDropdown(locale, {
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

        factory.add("mergeTableCells", (locale) => this.createDropdown(locale, {
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

        factory.add("tableSort", (locale) => this.createDropdown(locale, {
            label: t("Sort"),
            icon: bxSortAlt2,
            items: [
                buttonItem("triliumSortTableRowsAscending", t("Ascending")),
                buttonItem("triliumSortTableRowsDescending", t("Descending"))
            ]
        }));
    }

    /**
     * Creates a dropdown listing `items`, enabled while one of their commands is. With
     * `splitButtonCommandName`, the main part of a split button runs that command.
     */
    private createDropdown(locale: Locale, options: TableDropdownOptions): DropdownView {
        const editor = this.editor;
        const { label, icon, items, splitButtonCommandName } = options;

        const dropdownView = splitButtonCommandName
            ? createDropdown(locale, SplitButtonView)
            : createDropdown(locale);
        dropdownView.buttonView.set({ label, icon, tooltip: true });

        const commands: Command[] = [];
        const definitions = new Collection<ListDropdownItemDefinition>();
        for (const item of items) {
            if (item.type === "separator") {
                // A new object each time: `Collection#add()` gives it an `id`.
                definitions.add({ type: "separator" });
                continue;
            }

            // Skips an item whose command is not registered, e.g. after an upstream rename.
            const command = editor.commands.get(item.commandName);
            if (!command) {
                continue;
            }
            commands.push(command);

            const model = new UIModel({
                commandName: item.commandName,
                label: item.label,
                withText: true
            });
            model.bind("isEnabled").to(command);
            if (item.type === "switchbutton") {
                model.bind("isOn").to(command, "value");
            }
            definitions.add({ type: item.type, model });
        }
        addListToDropdown(dropdownView, definitions);

        dropdownView.bind("isEnabled").toMany(commands, "isEnabled",
            (...areEnabled) => areEnabled.some((isEnabled) => isEnabled));

        if (splitButtonCommandName) {
            this.listenTo(dropdownView.buttonView, "execute", () => {
                editor.execute(splitButtonCommandName);
                editor.editing.view.focus();
            });
        }
        this.listenTo<ButtonExecuteEvent>(dropdownView, "execute", (evt) => {
            const source = evt.source as { commandName: string };
            editor.execute(source.commandName);
            // A switch keeps the dropdown open, so the focus stays in the list.
            if (!(source instanceof SwitchButtonView)) {
                editor.editing.view.focus();
            }
        });

        return dropdownView;
    }

}

type TableDropdownItem =
    | { type: "button" | "switchbutton"; commandName: string; label: string }
    | { type: "separator" };

interface TableDropdownOptions {
    label: string;
    icon: string;
    items: TableDropdownItem[];
    splitButtonCommandName?: string;
}

const SEPARATOR_ITEM: TableDropdownItem = { type: "separator" };

function buttonItem(commandName: string, label: string): TableDropdownItem {
    return { type: "button", commandName, label };
}

function switchItem(commandName: string, label: string): TableDropdownItem {
    return { type: "switchbutton", commandName, label };
}

declare module "ckeditor5" {
    interface PluginsMap {
        [TableToolbarDropdowns.pluginName]: TableToolbarDropdowns;
    }
}
