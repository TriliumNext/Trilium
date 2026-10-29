import {
    _getModelData as getModelData,
    _setModelData as setModelData,
    BlockQuote,
    Essentials,
    Heading,
    List,
    ListItemView,
    Paragraph,
    SplitButtonView,
    Table,
    TodoList
} from "ckeditor5";
import type { ButtonView, ClassicEditor, DropdownView, ModelElement } from "ckeditor5";
import { beforeEach, describe, expect, it } from "vitest";

import { createTestEditor } from "../../../test/editor-kit.js";
import { modelTable, selectCells } from "../../../test/table-kit.js";
import CollapsibleEditing from "../collapsible/collapsible_editing.js";
import MulticolumnEditing from "../multicolumn/multicolumn_editing.js";
import SortSelection from "./sort_selection.js";

const ASCENDING = "triliumSortSelectionAscending";
const DESCENDING = "triliumSortSelectionDescending";

describe("SortSelection", () => {
    let editor: ClassicEditor;

    beforeEach(async () => {
        editor = await createTestEditor([
            Essentials, Paragraph, Heading, List, TodoList, BlockQuote, Table, CollapsibleEditing,
            MulticolumnEditing, SortSelection
        ], { language: { content: "en" }, toolbar: [ "sortSelection" ] });
    });

    function sort(name = ASCENDING) {
        editor.execute(name);
    }

    function isEnabled(name = ASCENDING) {
        return editor.commands.get(name)?.isEnabled === true;
    }

    function kind() {
        return editor.commands.get(ASCENDING)?.value ?? null;
    }

    /** The root's blocks as lines: a list block indented by its level, else its name and text. */
    function outline(): string[] {
        const model = editor.model;
        return Array.from(model.document.getRoot()?.getChildren() ?? [], (node) => {
            const element = node as ModelElement;
            let text = "";
            for (const item of model.createRangeIn(element).getItems()) {
                text += item.is("$textProxy") ? item.data : "";
            }
            const indent = element.getAttribute("listIndent");
            return typeof indent === "number"
                ? `${"  ".repeat(indent)}* ${text}`
                : `${element.name} ${text}`;
        });
    }

    describe("in a list", () => {
        it("sorts the items at the level of the caret, each with its nested items", () => {
            setModelData(editor.model,
                item("b", "b") + item("b2", "b2", 1) + item("b1", "b1", 1)
                + item("c", "c[]") + item("a", "a"));
            expect(kind()).toBe("listItems");

            sort();
            expect(outline()).toEqual([ "* a", "* b", "  * b2", "  * b1", "* c" ]);

            sort(DESCENDING);
            expect(outline()).toEqual([ "* c", "* b", "  * b2", "  * b1", "* a" ]);
        });

        it("sorts a nested list alone, leaving its parent list in place", () => {
            setModelData(editor.model,
                item("z", "z") + item("b2", "b2", 1) + item("b1", "b1[]", 1) + item("a", "a"));
            sort();
            expect(outline()).toEqual([ "* z", "  * b1", "  * b2", "* a" ]);
        });

        it("sorts only the selected items of a range", () => {
            setModelData(editor.model,
                item("d", "d") + item("c", "[c") + item("b", "b]") + item("a", "a"));
            sort();
            expect(outline()).toEqual([ "* d", "* b", "* c", "* a" ]);
        });

        it("sorts the items at the lowest level of a range starting in a nested item", () => {
            setModelData(editor.model,
                item("y", "y") + item("x", "x") + item("x1", "[x1", 1) + item("w", "w]"));
            sort();
            expect(outline()).toEqual([ "* y", "* w", "* x", "  * x1" ]);
        });

        it("keeps the blocks of an item and its to-do state together", () => {
            setModelData(editor.model,
                item("b", "b", 0, "todo", ' todoListChecked="true"')
                + item("b", "b more", 0, "todo", ' todoListChecked="true"')
                + item("a", "a[]", 0, "todo"));
            sort();
            expect(outline()).toEqual([ "* a", "* b", "* b more" ]);
            const root = editor.model.document.getRoot();
            expect(root?.getChild(1)?.getAttribute("todoListChecked")).toBe(true);
            expect(root?.getChild(2)?.getAttribute("todoListChecked")).toBe(true);
            expect(root?.getChild(0)?.hasAttribute("todoListChecked")).toBe(false);
        });

        it("is disabled for a range across two lists of different kinds", () => {
            setModelData(editor.model,
                item("b", "[b") + item("a", "a]", 0, "numbered"));
            expect(isEnabled()).toBe(false);
            expect(kind()).toBeNull();
        });

        it("is disabled in a list of one item, and for items in different parents", () => {
            setModelData(editor.model, item("a", "a[]") + "<paragraph>b</paragraph>");
            expect(isEnabled()).toBe(false);

            setModelData(editor.model,
                item("b", "[b") + "<blockQuote>" + item("a", "a]") + "</blockQuote>");
            expect(isEnabled()).toBe(false);
        });

        it("writes nothing when the items are already in order", () => {
            setModelData(editor.model, item("a", "a[]") + item("b", "b"));
            const version = editor.model.document.version;
            sort();
            expect(editor.model.document.version).toBe(version);
        });
    });

    describe("on sibling blocks", () => {
        it("sorts the selected blocks in one undo step and selects them", () => {
            setModelData(editor.model,
                "<paragraph>[c</paragraph><heading2>b</heading2><paragraph>a]</paragraph>");
            expect(kind()).toBe("blocks");

            sort();
            expect(getModelData(editor.model))
                .toBe("<paragraph>[a</paragraph><heading2>b</heading2><paragraph>c]</paragraph>");

            editor.execute("undo");
            expect(outline()).toEqual([ "paragraph c", "heading2 b", "paragraph a" ]);
        });

        it("moves a container or an object whole, sorted by its first text", () => {
            setModelData(editor.model,
                "<paragraph>[z</paragraph>"
                + "<blockQuote><paragraph>m</paragraph><paragraph>y</paragraph></blockQuote>"
                + "<details><summary>b</summary><paragraph>x</paragraph></details>"
                + "<table><tableRow><tableCell><paragraph>c</paragraph></tableCell></tableRow>"
                + "</table>"
                + "<paragraph>a]</paragraph>");
            sort();
            expect(outline()).toEqual(
                [ "paragraph a", "details bx", "table c", "blockQuote my", "paragraph z" ]);
        });

        it("sorts collapsibles by their titles, and nothing from a title into its body", () => {
            setModelData(editor.model,
                "<details><summary>[b</summary><paragraph>x</paragraph></details>"
                + "<details><summary>a]</summary><paragraph>y</paragraph></details>");
            sort();
            expect(outline()).toEqual([ "details ay", "details bx" ]);

            setModelData(editor.model,
                "<details><summary>[b</summary><paragraph>a]</paragraph></details>");
            expect(isEnabled()).toBe(false);
        });

        it("leaves columns in place, as a range across them selects the layout", () => {
            setModelData(editor.model,
                "<multicolumnLayout columnRatios=\"1-1\">"
                + "<multicolumnColumn><paragraph>[b</paragraph></multicolumnColumn>"
                + "<multicolumnColumn><paragraph>a]</paragraph></multicolumnColumn>"
                + "</multicolumnLayout>");
            expect(isEnabled()).toBe(false);

            setModelData(editor.model,
                "<multicolumnLayout columnRatios=\"1-1\">"
                + "<multicolumnColumn><paragraph>[b</paragraph><paragraph>a]</paragraph>"
                + "</multicolumnColumn><multicolumnColumn><paragraph>z</paragraph>"
                + "</multicolumnColumn></multicolumnLayout>");
            sort();
            expect(outline()).toEqual([ "multicolumnLayout abz" ]);
        });

        it("sorts the paragraphs of a range inside a table cell, not the rows", () => {
            setModelData(editor.model,
                "<table><tableRow><tableCell><paragraph>[b</paragraph><paragraph>a]</paragraph>"
                + "</tableCell></tableRow><tableRow><tableCell><paragraph>0</paragraph>"
                + "</tableCell></tableRow></table>");
            expect(kind()).toBe("blocks");
            sort();
            expect(outline()).toEqual([ "table ab0" ]);
        });

        it("is disabled for a caret, a range in one block and a range mixing a list", () => {
            setModelData(editor.model, "<paragraph>b[]</paragraph><paragraph>a</paragraph>");
            expect(isEnabled()).toBe(false);

            setModelData(editor.model, "<paragraph>[b]</paragraph><paragraph>a</paragraph>");
            expect(isEnabled()).toBe(false);

            setModelData(editor.model, "<paragraph>[b</paragraph>" + item("a", "a]"));
            expect(isEnabled()).toBe(false);
        });
    });

    describe("in a table", () => {
        const table = modelTable([ [ "h" ], [ "b[]" ], [ "a" ] ], 'headingRows="1"');

        it("sorts the body rows by the column of the caret, as the table command does", () => {
            // Enabled in the same change that made the table sortable, so this command refreshes
            // after the table command.
            setModelData(editor.model, table);
            expect(isEnabled()).toBe(true);
            expect(kind()).toBe("rows");

            sort();
            expect(cellTexts()).toEqual([ "h", "a", "b" ]);
            sort(DESCENDING);
            expect(cellTexts()).toEqual([ "h", "b", "a" ]);
        });

        it("sorts rows for cells selected down one column, and nothing across two", () => {
            setModelData(editor.model,
                modelTable([ [ "c", "1" ], [ "b", "2" ], [ "a", "3" ] ]));
            selectCells(editor, [ 0, 0 ], [ 1, 0 ]);
            expect(kind()).toBe("rows");
            sort();
            expect(cellTexts()).toEqual([ "b", "2", "c", "1", "a", "3" ]);

            selectCells(editor, [ 0, 0 ], [ 1, 1 ]);
            expect(isEnabled()).toBe(false);
        });

        it("sorts a list in a cell instead of the rows", () => {
            setModelData(editor.model,
                "<table><tableRow><tableCell>" + item("b", "b[]") + item("a", "a")
                + "</tableCell></tableRow><tableRow><tableCell><paragraph>0</paragraph>"
                + "</tableCell></tableRow></table>");
            expect(kind()).toBe("listItems");
            sort();
            expect(cellTexts()).toEqual([ "ab", "0" ]);
        });

        it("is disabled in read-only mode", () => {
            setModelData(editor.model, table);
            editor.enableReadOnlyMode("spec");
            expect(isEnabled()).toBe(false);
            expect(isEnabled(DESCENDING)).toBe(false);
        });

        it("does nothing when executed with nothing to sort", () => {
            setModelData(editor.model, "<paragraph>b[]</paragraph><paragraph>a</paragraph>");
            const command = editor.commands.get(ASCENDING);
            if (!command) {
                throw new Error("Command not registered.");
            }
            const version = editor.model.document.version;
            command.isEnabled = true;
            command.execute();
            expect(editor.model.document.version).toBe(version);
        });
    });

    describe("the toolbar button", () => {
        it("is a split button that sorts ascending, with both directions in its list", () => {
            setModelData(editor.model,
                "<paragraph>[b</paragraph><paragraph>c</paragraph><paragraph>a]</paragraph>");
            const dropdown = editor.ui.view.toolbar.items.get(0) as DropdownView;
            expect(dropdown.buttonView).toBeInstanceOf(SplitButtonView);
            expect(dropdown.buttonView.label).toBe("Sort");
            expect(dropdown.isEnabled).toBe(true);

            dropdown.buttonView.fire("execute");
            expect(outline()).toEqual([ "paragraph a", "paragraph b", "paragraph c" ]);

            dropdown.isOpen = true;
            const buttons = Array.from(dropdown.listView?.items ?? [], (listItem) =>
                (listItem as ListItemView).children.first as ButtonView);
            expect(buttons.map((button) => button.label)).toEqual([ "Ascending", "Descending" ]);
            buttons[1].fire("execute");
            expect(outline()).toEqual([ "paragraph c", "paragraph b", "paragraph a" ]);

            setModelData(editor.model, "<paragraph>a[]</paragraph>");
            expect(dropdown.isEnabled).toBe(false);
        });
    });

    function cellTexts(): string[] {
        const texts: string[] = [];
        const root = editor.model.document.getRoot();
        if (!root) {
            return texts;
        }
        for (const node of editor.model.createRangeIn(root).getItems()) {
            if (node.is("element", "tableCell")) {
                let text = "";
                for (const child of editor.model.createRangeIn(node).getItems()) {
                    text += child.is("$textProxy") ? child.data : "";
                }
                texts.push(text);
            }
        }
        return texts;
    }
});

function item(id: string, text: string, indent = 0, type = "bulleted", extra = "") {
    return `<paragraph listIndent="${indent}" listItemId="${id}" listType="${type}"${extra}>`
        + `${text}</paragraph>`;
}
