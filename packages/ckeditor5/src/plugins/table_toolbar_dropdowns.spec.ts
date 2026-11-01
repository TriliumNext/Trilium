import bxSortAlt2 from "boxicons/svg/regular/bx-sort-alt-2.svg?raw";
import {
    _getModelData as getModelData,
    _setModelData as setModelData,
    ButtonView,
    Essentials,
    ListItemView,
    ListSeparatorView,
    Paragraph,
    SplitButtonView,
    SwitchButtonView,
    Table
} from "ckeditor5";
import type { ClassicEditor, DropdownView } from "ckeditor5";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createTestEditor } from "../../test/editor-kit.js";
import { modelTable, selectCells } from "../../test/table-kit.js";
import TableToolbarDropdowns from "./table_toolbar_dropdowns.js";

const TOOLBAR = ["tableColumn", "mergeTableCells"] as const;

type ToolbarItem = typeof TOOLBAR[number];

describe("TableToolbarDropdowns", () => {
    describe("compared with the upstream dropdowns", () => {
        for (const content of ["en", "ar"]) {
            it(`keeps every upstream item and adds the Trilium ones (${content})`, async () => {
                const config = { toolbar: [...TOOLBAR], language: { content } };
                const upstream = await createTestEditor([Essentials, Paragraph, Table], config);
                const editor = await createTestEditor(
                    [Essentials, Paragraph, Table, TableToolbarDropdowns], config);

                for (const name of TOOLBAR) {
                    const upstreamButton = getDropdown(upstream, name).buttonView;
                    const button = getDropdown(editor, name).buttonView;
                    expect(button.constructor, name).toBe(upstreamButton.constructor);
                    expect(button.label, name).toBe(upstreamButton.label);
                    expect(button.icon, name).toBe(upstreamButton.icon);
                }

                expect(getItems(getDropdown(editor, "tableColumn"))).toEqual([
                    ...getItems(getDropdown(upstream, "tableColumn")),
                    "|",
                    "triliumDistributeTableColumns: Distribute columns evenly"
                ]);

                const upstreamMergeItems = getItems(getDropdown(upstream, "mergeTableCells"));
                const splitIndex = upstreamMergeItems.indexOf("|");
                expect(splitIndex).toBeGreaterThan(0);
                expect(getItems(getDropdown(editor, "mergeTableCells"))).toEqual([
                    ...upstreamMergeItems.slice(0, splitIndex),
                    "mergeTableCells: Merge selected cells",
                    ...upstreamMergeItems.slice(splitIndex),
                    "triliumResetTableCellSpans: Unmerge cells"
                ]);
            });
        }
    });

    describe("in the editor", () => {
        let editor: ClassicEditor;

        beforeEach(async () => {
            editor = await createTestEditor([Essentials, Paragraph, Table, TableToolbarDropdowns], {
                toolbar: [...TOOLBAR]
            });
            setModelData(editor.model, modelTable([["1[]1", "12"], ["21", "22"]]));
        });

        it("enables the dropdowns inside a table only", () => {
            for (const name of TOOLBAR) {
                expect(getDropdown(editor, name).isEnabled, name).toBe(true);
            }

            setModelData(editor.model, "<paragraph>fo[]o</paragraph>");
            for (const name of TOOLBAR) {
                expect(getDropdown(editor, name).isEnabled, name).toBe(false);
            }
        });

        it("enables the added items with their commands", () => {
            const columnDropdown = getDropdown(editor, "tableColumn");
            const mergeDropdown = getDropdown(editor, "mergeTableCells");
            expect(getItem(columnDropdown, "Distribute columns evenly").isEnabled).toBe(false);
            expect(getItem(mergeDropdown, "Merge selected cells").isEnabled).toBe(false);
            expect(getItem(mergeDropdown, "Unmerge cells").isEnabled).toBe(false);

            selectCells(editor, [0, 0], [0, 1]);
            expect(getItem(columnDropdown, "Distribute columns evenly").isEnabled).toBe(true);
            expect(getItem(mergeDropdown, "Merge selected cells").isEnabled).toBe(true);
            expect(getItem(mergeDropdown, "Unmerge cells").isEnabled).toBe(false);

            editor.execute("mergeTableCells");
            expect(getItem(mergeDropdown, "Unmerge cells").isEnabled).toBe(true);
        });

        it("runs the command of a clicked item and focuses the editing view", () => {
            const execute = vi.spyOn(editor, "execute");
            const focus = vi.spyOn(editor.editing.view, "focus");
            selectCells(editor, [0, 0], [0, 1]);

            const columnDropdown = getDropdown(editor, "tableColumn");
            clickItem(columnDropdown, "Distribute columns evenly");
            expect(execute).toHaveBeenLastCalledWith("triliumDistributeTableColumns");
            expect(columnDropdown.isOpen).toBe(false);
            expect(focus).toHaveBeenCalledTimes(1);

            const mergeDropdown = getDropdown(editor, "mergeTableCells");
            clickItem(mergeDropdown, "Merge selected cells");
            expect(execute).toHaveBeenLastCalledWith("mergeTableCells");
            clickItem(mergeDropdown, "Unmerge cells");
            expect(execute).toHaveBeenLastCalledWith("triliumResetTableCellSpans");
            expect(mergeDropdown.isOpen).toBe(false);
            expect(focus).toHaveBeenCalledTimes(3);
        });

        it("toggles a switch without closing the dropdown or moving the focus", () => {
            const focus = vi.spyOn(editor.editing.view, "focus");
            const dropdown = getDropdown(editor, "tableColumn");

            clickItem(dropdown, "Header column");
            expect(editor.commands.get("setTableColumnHeader")?.value).toBe(true);
            expect(getItem(dropdown, "Header column").isOn).toBe(true);
            expect(dropdown.isOpen).toBe(true);
            expect(focus).not.toHaveBeenCalled();
        });

        it("merges the selected cells from the main part of the split button", () => {
            const execute = vi.spyOn(editor, "execute");
            const dropdown = getDropdown(editor, "mergeTableCells");
            selectCells(editor, [0, 0], [0, 1]);

            const splitButton = dropdown.buttonView as SplitButtonView;
            getElement(splitButton.actionView).click();
            expect(execute).toHaveBeenCalledWith("mergeTableCells");
            expect(dropdown.isOpen).toBe(false);
            expect(getItem(dropdown, "Unmerge cells").isEnabled).toBe(true);
        });

        it("leaves out an item whose command is not registered", () => {
            const getCommand = editor.commands.get.bind(editor.commands);
            vi.spyOn(editor.commands, "get").mockImplementation(((name: string) =>
                name === "selectTableColumn" ? undefined : getCommand(name)
            ) as typeof editor.commands.get);

            const dropdown = editor.ui.componentFactory.create("tableColumn") as DropdownView;
            dropdown.render();
            document.body.appendChild(getElement(dropdown));

            const items = getItems(dropdown);
            expect(items).not.toContain("selectTableColumn: Select column");
            expect(items).toContain("removeTableColumn: Delete column");

            getElement(dropdown).remove();
            dropdown.destroy();
        });
    });

    describe("the Sort dropdown", () => {
        it("sorts the rows with the clicked direction", async () => {
            const editor = await createTestEditor(
                [Essentials, Paragraph, Table, TableToolbarDropdowns], { toolbar: ["tableSort"] });
            const dropdown = editor.ui.view.toolbar.items.get(0) as DropdownView;
            const tableData = () => getModelData(editor.model, { withoutSelection: true });

            expect(dropdown.buttonView.label).toBe("Sort");
            expect(dropdown.buttonView.icon).toBe(bxSortAlt2);
            expect(dropdown.isEnabled).toBe(false);

            setModelData(editor.model, modelTable([["b[]"], ["c"], ["a"]]));
            expect(dropdown.isEnabled).toBe(true);
            expect(getItems(dropdown)).toEqual([
                "triliumSortTableRowsAscending: Ascending",
                "triliumSortTableRowsDescending: Descending"
            ]);

            clickItem(dropdown, "Ascending");
            expect(tableData()).toBe(modelTable([["a"], ["b"], ["c"]]));
            clickItem(dropdown, "Descending");
            expect(tableData()).toBe(modelTable([["c"], ["b"], ["a"]]));
        });
    });
});

function getElement(view: { element: HTMLElement | null }): HTMLElement {
    if (!view.element) {
        throw new Error("The view is not rendered.");
    }
    return view.element;
}

function getDropdown(editor: ClassicEditor, name: ToolbarItem): DropdownView {
    return editor.ui.view.toolbar.items.get(TOOLBAR.indexOf(name)) as DropdownView;
}

/** The list buttons of `dropdown`, which is opened to build them. */
function getButtons(dropdown: DropdownView): (ButtonView & { commandName: string } | null)[] {
    dropdown.isOpen = true;
    const items = dropdown.listView?.items;
    if (!items) {
        throw new Error("The dropdown has no list.");
    }

    return Array.from(items, (item) => {
        if (item instanceof ListSeparatorView) {
            return null;
        }
        expect(item).toBeInstanceOf(ListItemView);
        return (item as ListItemView).children.first as ButtonView & { commandName: string };
    });
}

/** The items of `dropdown` as `commandName: label` strings, with `|` for a separator. */
function getItems(dropdown: DropdownView): string[] {
    return getButtons(dropdown).map((button) => {
        if (!button) {
            return "|";
        }
        const suffix = button instanceof SwitchButtonView ? " (switch)" : "";
        return `${button.commandName}: ${button.label}${suffix}`;
    });
}

function getItem(dropdown: DropdownView, label: string): ButtonView {
    const button = getButtons(dropdown).find((candidate) => candidate?.label === label);
    if (!button) {
        throw new Error(`The dropdown has no "${label}" item.`);
    }
    return button;
}

function clickItem(dropdown: DropdownView, label: string) {
    getElement(getItem(dropdown, label)).click();
}
