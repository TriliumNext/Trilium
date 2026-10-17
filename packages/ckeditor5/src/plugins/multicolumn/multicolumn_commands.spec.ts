import {
    _getModelData as getModelData,
    _setModelData as setModelData,
    type ClassicEditor,
    Essentials,
    List,
    Paragraph,
    Table,
    TodoList
} from "ckeditor5";
import { beforeEach, describe, expect, it } from "vitest";

import { createTestEditor } from "../../../test/editor-kit.js";
import Multicolumn from "./multicolumn.js";

/** A layout with the given weights whose columns hold one paragraph each, in model notation. */
function layout(ratios: string, ...columns: string[]) {
    const content = columns.map(text =>
        `<multicolumnColumn><paragraph>${text}</paragraph></multicolumnColumn>`);
    return `<multicolumnLayout columnRatios="${ratios}">${content.join("")}</multicolumnLayout>`;
}

/** A layout with the given weights whose columns hold the given model content. */
function columns(ratios: string, ...contents: string[]) {
    const content = contents.map(inner => `<multicolumnColumn>${inner}</multicolumnColumn>`);
    return `<multicolumnLayout columnRatios="${ratios}">${content.join("")}</multicolumnLayout>`;
}

const TABLE = "<table><tableRow><tableCell><paragraph>T</paragraph></tableCell></tableRow></table>";

/** An empty bulleted item and an empty checked to-do item, in model notation. */
const EMPTY_BULLET = "<paragraph listIndent=\"0\" listItemId=\"a\" listType=\"bulleted\">" +
    "</paragraph>";
const EMPTY_TODO = "<paragraph listIndent=\"0\" listItemId=\"b\" listType=\"todo\" " +
    "todoListChecked=\"true\"></paragraph>";

describe("multicolumn commands", () => {
    let editor: ClassicEditor;

    beforeEach(async () => {
        editor = await createTestEditor([
            Essentials, Paragraph, List, TodoList, Table, Multicolumn
        ]);
    });

    function modelWithSelection() {
        return getModelData(editor.model);
    }

    describe("multicolumnLayout", () => {
        it("inserts two equal columns and puts the caret in the first one", () => {
            setModelData(editor.model, "<paragraph>Before[]</paragraph>");

            editor.execute("multicolumnLayout");

            expect(modelWithSelection()).toBe(
                "<paragraph>Before</paragraph>" +
                "<multicolumnLayout columnRatios=\"1-1\">" +
                    "<multicolumnColumn><paragraph>[]</paragraph></multicolumnColumn>" +
                    "<multicolumnColumn><paragraph></paragraph></multicolumnColumn>" +
                "</multicolumnLayout>"
            );
        });

        it("moves selected text into the first column", () => {
            setModelData(editor.model, "<paragraph>Keep [moved] text</paragraph>");

            editor.execute("multicolumnLayout");

            expect(modelWithSelection()).toBe(
                "<paragraph>Keep </paragraph>" +
                "<multicolumnLayout columnRatios=\"1-1\">" +
                    "<multicolumnColumn><paragraph>moved[]</paragraph></multicolumnColumn>" +
                    "<multicolumnColumn><paragraph></paragraph></multicolumnColumn>" +
                "</multicolumnLayout>" +
                "<paragraph> text</paragraph>"
            );
        });

        it("inserts the column weights it is given, and nothing for weights no layout uses", () => {
            setModelData(editor.model, "<paragraph>Keep [moved] text</paragraph>");
            editor.execute("multicolumnLayout", { value: "1-5" });
            expect(modelWithSelection()).toBe("<paragraph>Keep [moved] text</paragraph>");

            editor.execute("multicolumnLayout", { value: "1-2-1" });

            expect(modelWithSelection()).toBe(
                "<paragraph>Keep </paragraph>" +
                "<multicolumnLayout columnRatios=\"1-2-1\">" +
                    "<multicolumnColumn><paragraph>moved[]</paragraph></multicolumnColumn>" +
                    "<multicolumnColumn><paragraph></paragraph></multicolumnColumn>" +
                    "<multicolumnColumn><paragraph></paragraph></multicolumnColumn>" +
                "</multicolumnLayout>" +
                "<paragraph> text</paragraph>"
            );
        });

        it("moves selected blocks, lists and tables into the first column", () => {
            const listItem = "<paragraph listIndent=\"0\" listItemId=\"a\" listType=\"bulleted\">";
            const cell = "<tableCell><paragraph>Cell</paragraph></tableCell>";
            const blocks =
                "<paragraph>One</paragraph>" +
                `${listItem}Item</paragraph>` +
                `<table><tableRow>${cell}</tableRow></table>`;
            setModelData(editor.model, `[${blocks}]`);

            editor.execute("multicolumnLayout");

            expect(getModelData(editor.model, { withoutSelection: true })).toBe(
                "<multicolumnLayout columnRatios=\"1-1\">" +
                    `<multicolumnColumn>${blocks}</multicolumnColumn>` +
                    "<multicolumnColumn><paragraph></paragraph></multicolumnColumn>" +
                "</multicolumnLayout>"
            );
        });

        it("nests a selected layout in the first column of the new one", () => {
            setModelData(editor.model, `[${layout("1-3", "A", "B")}]`);

            editor.execute("multicolumnLayout");

            expect(getModelData(editor.model, { withoutSelection: true })).toBe(
                "<multicolumnLayout columnRatios=\"1-1\">" +
                    `<multicolumnColumn>${layout("1-3", "A", "B")}</multicolumnColumn>` +
                    "<multicolumnColumn><paragraph></paragraph></multicolumnColumn>" +
                "</multicolumnLayout>"
            );
        });

        it("inserts a layout inside a column", () => {
            setModelData(editor.model, layout("1-1", "A[]", "B"));
            expect(editor.commands.get("multicolumnLayout")?.isEnabled).toBe(true);

            editor.execute("multicolumnLayout");

            expect(getModelData(editor.model, { withoutSelection: true })).toBe(
                "<multicolumnLayout columnRatios=\"1-1\">" +
                    "<multicolumnColumn>" +
                        "<paragraph>A</paragraph>" + layout("1-1", "", "") +
                    "</multicolumnColumn>" +
                    "<multicolumnColumn><paragraph>B</paragraph></multicolumnColumn>" +
                "</multicolumnLayout>"
            );
        });

        it("is one undo step", () => {
            setModelData(editor.model, "<paragraph>Keep [moved] text</paragraph>");
            const before = editor.getData();

            editor.execute("multicolumnLayout");
            editor.execute("undo");

            expect(editor.getData()).toBe(before);
        });
    });

    describe("columnLayout", () => {
        function command() {
            const columnLayout = editor.commands.get("columnLayout");
            if (!columnLayout) {
                throw new Error("the editor should register the columnLayout command");
            }
            return columnLayout;
        }

        it("is enabled with the weights of the layout around or at the selection", () => {
            setModelData(editor.model, "<paragraph>[]</paragraph>");
            expect(command().isEnabled).toBe(false);
            expect(command().value).toBeUndefined();

            setModelData(editor.model, layout("1-3", "A[]", "B"));
            expect(command().isEnabled).toBe(true);
            expect(command().value).toBe("1-3");

            setModelData(editor.model, `[${layout("3-1", "A", "B")}]`);
            expect(command().value).toBe("3-1");
        });

        it("follows the innermost layout", () => {
            setModelData(editor.model,
                "<multicolumnLayout columnRatios=\"1-3\">" +
                    `<multicolumnColumn>${layout("1-2-1", "A[]", "B", "C")}</multicolumnColumn>` +
                    "<multicolumnColumn><paragraph>D</paragraph></multicolumnColumn>" +
                "</multicolumnLayout>"
            );

            expect(command().value).toBe("1-2-1");
        });

        it("changes only the weights for the same column count", () => {
            setModelData(editor.model, layout("1-1", "A[]", "B"));

            editor.execute("columnLayout", { value: "3-1" });

            expect(modelWithSelection()).toBe(layout("3-1", "A[]", "B"));
        });

        it("appends empty columns for a larger column count", () => {
            setModelData(editor.model, layout("1-3", "A[]", "B"));

            editor.execute("columnLayout", { value: "1-1-1-1" });

            expect(modelWithSelection()).toBe(layout("1-1-1-1", "A[]", "B", "", ""));
        });

        it("merges the removed columns into the last remaining one, in order", () => {
            setModelData(editor.model, layout("1-1-1-1", "A", "B", "C", "D[]"));

            editor.execute("columnLayout", { value: "1-3" });

            expect(modelWithSelection()).toBe(
                "<multicolumnLayout columnRatios=\"1-3\">" +
                    "<multicolumnColumn><paragraph>A</paragraph></multicolumnColumn>" +
                    "<multicolumnColumn>" +
                        "<paragraph>B</paragraph>" +
                        "<paragraph>C</paragraph>" +
                        "<paragraph>D[]</paragraph>" +
                    "</multicolumnColumn>" +
                "</multicolumnLayout>"
            );
        });

        it("adds no blank line for an empty column on either side of a merge", () => {
            setModelData(editor.model, layout("1-1-1-1", "A", "", "C", "[]"));

            editor.execute("columnLayout", { value: "1-1" });

            expect(modelWithSelection()).toBe(layout("1-1", "A", "C[]"));
        });

        it("keeps an empty list or to-do item on either side of a merge", () => {
            setModelData(editor.model,
                "<multicolumnLayout columnRatios=\"1-1-1-1\">" +
                    "<multicolumnColumn><paragraph>A[]</paragraph></multicolumnColumn>" +
                    `<multicolumnColumn>${EMPTY_BULLET}</multicolumnColumn>` +
                    "<multicolumnColumn><paragraph>C</paragraph></multicolumnColumn>" +
                    `<multicolumnColumn>${EMPTY_TODO}</multicolumnColumn>` +
                "</multicolumnLayout>"
            );

            editor.execute("columnLayout", { value: "1-1" });

            expect(modelWithSelection()).toBe(
                "<multicolumnLayout columnRatios=\"1-1\">" +
                    "<multicolumnColumn><paragraph>A[]</paragraph></multicolumnColumn>" +
                    `<multicolumnColumn>${EMPTY_BULLET}<paragraph>C</paragraph>${EMPTY_TODO}` +
                    "</multicolumnColumn>" +
                "</multicolumnLayout>"
            );
        });

        it("moves the caret out of a removed empty column", () => {
            setModelData(editor.model, layout("1-1-1", "A", "B", "[]"));

            editor.execute("columnLayout", { value: "1-1" });

            expect(modelWithSelection()).toBe(layout("1-1", "A", "B[]"));
        });

        it("ignores weights it does not offer", () => {
            setModelData(editor.model, layout("1-1", "A[]", "B"));

            editor.execute("columnLayout", { value: "2-5" });
            editor.execute("columnLayout", { value: "1-1-1-1-1" });

            expect(modelWithSelection()).toBe(layout("1-1", "A[]", "B"));
        });

        it("is one undo step", () => {
            setModelData(editor.model, layout("1-1-1", "A", "B", "C[]"));
            const before = editor.getData();

            editor.execute("columnLayout", { value: "3-1" });
            expect(editor.getData()).not.toBe(before);
            editor.execute("undo");

            expect(editor.getData()).toBe(before);
        });
    });

    describe("removeMulticolumnLayout", () => {
        function command() {
            const removeLayout = editor.commands.get("removeMulticolumnLayout");
            if (!removeLayout) {
                throw new Error("the editor should register the removeMulticolumnLayout command");
            }
            return removeLayout;
        }

        it("is enabled in or on a layout", () => {
            setModelData(editor.model, "<paragraph>[]</paragraph>");
            expect(command().isEnabled).toBe(false);

            setModelData(editor.model, layout("1-3", "A[]", "B"));
            expect(command().isEnabled).toBe(true);

            setModelData(editor.model, `[${layout("1-3", "A", "B")}]`);
            expect(command().isEnabled).toBe(true);
        });

        it("puts the content of the columns one after another in its place", () => {
            const cell = "<tableCell><paragraph>Cell</paragraph></tableCell>";
            const table = `<table><tableRow>${cell}</tableRow></table>`;
            setModelData(editor.model,
                "<paragraph>Before</paragraph>" +
                "<multicolumnLayout columnRatios=\"1-2-1\">" +
                    "<multicolumnColumn><paragraph>A</paragraph><paragraph>B</paragraph>" +
                    "</multicolumnColumn>" +
                    `<multicolumnColumn><paragraph>C[]</paragraph>${table}</multicolumnColumn>` +
                    `<multicolumnColumn>${layout("1-1", "D", "E")}</multicolumnColumn>` +
                "</multicolumnLayout>" +
                "<paragraph>After</paragraph>"
            );

            editor.execute("removeMulticolumnLayout");

            expect(modelWithSelection()).toBe(
                "<paragraph>Before</paragraph>" +
                "<paragraph>A</paragraph><paragraph>B</paragraph>" +
                `<paragraph>C[]</paragraph>${table}` +
                layout("1-1", "D", "E") +
                "<paragraph>After</paragraph>"
            );
        });

        it("adds no blank line for an empty column, and leaves one for an empty layout", () => {
            setModelData(editor.model, layout("1-1-1", "A[]", "", "C"));
            editor.execute("removeMulticolumnLayout");
            expect(modelWithSelection()).toBe("<paragraph>A[]</paragraph><paragraph>C</paragraph>");

            setModelData(editor.model, layout("1-1", "", "[]"));
            editor.execute("removeMulticolumnLayout");
            expect(modelWithSelection()).toBe("<paragraph>[]</paragraph>");
        });

        it("keeps a column whose only content is an empty list or to-do item", () => {
            setModelData(editor.model,
                "<multicolumnLayout columnRatios=\"1-1-1\">" +
                    `<multicolumnColumn>${EMPTY_BULLET}</multicolumnColumn>` +
                    "<multicolumnColumn><paragraph>B[]</paragraph></multicolumnColumn>" +
                    `<multicolumnColumn>${EMPTY_TODO}</multicolumnColumn>` +
                "</multicolumnLayout>"
            );

            editor.execute("removeMulticolumnLayout");

            expect(modelWithSelection())
                .toBe(`${EMPTY_BULLET}<paragraph>B[]</paragraph>${EMPTY_TODO}`);
        });

        it("moves the caret out of an empty column, and selects the content of the layout", () => {
            setModelData(editor.model,
                `${layout("1-1-1", "A", "[]", "C")}<paragraph>D</paragraph>`);
            editor.execute("removeMulticolumnLayout");
            expect(modelWithSelection())
                .toBe("<paragraph>A</paragraph><paragraph>C[]</paragraph><paragraph>D</paragraph>");

            setModelData(editor.model, `[${layout("1-1", "A", "B")}]<paragraph>C</paragraph>`);
            editor.execute("removeMulticolumnLayout");
            expect(modelWithSelection())
                .toBe("<paragraph>[A</paragraph><paragraph>B]</paragraph><paragraph>C</paragraph>");
        });

        it("removes only the innermost layout", () => {
            setModelData(editor.model,
                "<multicolumnLayout columnRatios=\"1-3\">" +
                    `<multicolumnColumn>${layout("1-1", "A[]", "B")}</multicolumnColumn>` +
                    "<multicolumnColumn><paragraph>C</paragraph></multicolumnColumn>" +
                "</multicolumnLayout>"
            );

            editor.execute("removeMulticolumnLayout");

            expect(modelWithSelection()).toBe(
                "<multicolumnLayout columnRatios=\"1-3\">" +
                    "<multicolumnColumn><paragraph>A[]</paragraph><paragraph>B</paragraph>" +
                    "</multicolumnColumn>" +
                    "<multicolumnColumn><paragraph>C</paragraph></multicolumnColumn>" +
                "</multicolumnLayout>"
            );
        });

        it("is one undo step", () => {
            setModelData(editor.model, layout("1-1-1", "A", "", "C[]"));
            const before = editor.getData();

            editor.execute("removeMulticolumnLayout");
            expect(editor.getData()).not.toBe(before);
            editor.execute("undo");

            expect(editor.getData()).toBe(before);
        });
    });

    describe("moveToLayoutColumn", () => {
        it("moves the touched blocks to a later column's start or an earlier column's end", () => {
            setModelData(editor.model, columns("1-1",
                "<paragraph>A</paragraph><paragraph>B[x</paragraph><paragraph>y]C</paragraph>" +
                "<paragraph>D</paragraph>",
                "<paragraph>E</paragraph>"));
            const before = editor.getData();

            editor.execute("moveToLayoutColumn", { target: "next" });
            expect(modelWithSelection()).toBe(columns("1-1",
                "<paragraph>A</paragraph><paragraph>D</paragraph>",
                "<paragraph>B[x</paragraph><paragraph>y]C</paragraph><paragraph>E</paragraph>"));

            editor.execute("moveToLayoutColumn", { target: "previous" });
            expect(modelWithSelection()).toBe(columns("1-1",
                "<paragraph>A</paragraph><paragraph>D</paragraph><paragraph>B[x</paragraph>" +
                "<paragraph>y]C</paragraph>",
                "<paragraph>E</paragraph>"));

            editor.execute("undo");
            editor.execute("undo");
            expect(editor.getData()).toBe(before);
        });

        it("fills an empty target, refills the source and ignores targets past an end", () => {
            setModelData(editor.model, layout("1-1-1-1", "A", "[B]", "C", "D"));

            editor.execute("moveToLayoutColumn", { target: "last" });
            expect(modelWithSelection()).toBe(columns("1-1-1-1",
                "<paragraph>A</paragraph>", "<paragraph></paragraph>", "<paragraph>C</paragraph>",
                "<paragraph>[B]</paragraph><paragraph>D</paragraph>"));

            const atLast = modelWithSelection();
            editor.execute("moveToLayoutColumn", { target: "next" });
            editor.execute("moveToLayoutColumn", { target: "last" });
            expect(modelWithSelection()).toBe(atLast);

            setModelData(editor.model, layout("1-1", "[A]", ""));
            editor.execute("moveToLayoutColumn", { target: "next" });
            expect(modelWithSelection()).toBe(layout("1-1", "", "[A]"));

            editor.execute("moveToLayoutColumn", { target: "first" });
            expect(modelWithSelection()).toBe(layout("1-1", "[A]", ""));
        });

        it("leaves out the block that the selection ends at the start of", () => {
            setModelData(editor.model, columns("1-1",
                "<paragraph>[A</paragraph><paragraph>]B</paragraph>", "<paragraph>C</paragraph>"));

            editor.execute("moveToLayoutColumn", { target: "next" });

            expect(modelWithSelection()).toBe(columns("1-1",
                "<paragraph>B</paragraph>", "<paragraph>[A]</paragraph><paragraph>C</paragraph>"));
        });

        it("moves every block of a list item that the selection touches", () => {
            const item = (id: string, text: string) => "<paragraph listIndent=\"0\" " +
                `listItemId="${id}" listType="bulleted">${text}</paragraph>`;
            const itemA = item("a", "A1") + item("a", "A[2]") + item("a", "A3");
            setModelData(editor.model, columns("1-1",
                itemA + item("b", "B"), "<paragraph>C</paragraph>"));

            editor.execute("moveToLayoutColumn", { target: "next" });

            expect(modelWithSelection()).toBe(columns("1-1",
                item("b", "B"), `${itemA}<paragraph>C</paragraph>`));
        });

        it("moves a selected object", () => {
            setModelData(editor.model, columns("1-1",
                `<paragraph>A</paragraph>[${TABLE}]`, "<paragraph>C</paragraph>"));

            editor.execute("moveToLayoutColumn", { target: "next" });

            expect(modelWithSelection()).toBe(columns("1-1",
                "<paragraph>A</paragraph>", `[${TABLE}]<paragraph>C</paragraph>`));
        });

        it("is enabled only for a selection inside one column", () => {
            const command = editor.commands.get("moveToLayoutColumn");
            setModelData(editor.model, layout("1-1", "[A]", "B"));
            expect(command?.isEnabled).toBe(true);

            setModelData(editor.model, layout("1-1", "A[]", "B"));
            expect(command?.isEnabled).toBe(false);

            setModelData(editor.model, `[${layout("1-1", "A", "B")}]`);
            expect(command?.isEnabled).toBe(false);

            setModelData(editor.model, "<paragraph>[A]</paragraph>");
            expect(command?.isEnabled).toBe(false);
            editor.execute("moveToLayoutColumn", { target: "next" });
            expect(modelWithSelection()).toBe("<paragraph>[A]</paragraph>");
        });
    });

    describe("moveLayoutColumn", () => {
        it("moves the current column and its width where the layout has the new order", () => {
            setModelData(editor.model, layout("1-3", "A[]", "B"));

            editor.execute("moveLayoutColumn", { target: "next" });
            expect(modelWithSelection()).toBe(layout("3-1", "B", "A[]"));

            editor.execute("moveLayoutColumn", { target: "previous" });
            expect(modelWithSelection()).toBe(layout("1-3", "A[]", "B"));
        });

        it("keeps the widths where the layout lacks the new order, and ignores the ends", () => {
            setModelData(editor.model, layout("1-2-1", "A[]", "B", "C"));

            editor.execute("moveLayoutColumn", { target: "last" });
            expect(modelWithSelection()).toBe(layout("1-2-1", "B", "C", "A[]"));

            editor.execute("moveLayoutColumn", { target: "next" });
            editor.execute("moveLayoutColumn", { target: "last" });
            expect(modelWithSelection()).toBe(layout("1-2-1", "B", "C", "A[]"));

            editor.execute("moveLayoutColumn", { target: "first" });
            expect(modelWithSelection()).toBe(layout("1-2-1", "A[]", "B", "C"));
        });

        it("is enabled only inside a column", () => {
            const command = editor.commands.get("moveLayoutColumn");
            setModelData(editor.model, layout("1-1", "A[]", "B"));
            expect(command?.isEnabled).toBe(true);

            setModelData(editor.model, "<paragraph>A[]</paragraph>");
            expect(command?.isEnabled).toBe(false);
            editor.execute("moveLayoutColumn", { target: "next" });
            expect(modelWithSelection()).toBe("<paragraph>A[]</paragraph>");
        });
    });

    describe("insertLayoutColumn", () => {
        it("adds an empty column after or before the current one, with equal widths", () => {
            setModelData(editor.model, layout("1-3", "A[]", "B"));

            editor.execute("insertLayoutColumn", { position: "after" });
            expect(modelWithSelection()).toBe(layout("1-1-1", "A", "[]", "B"));

            editor.execute("insertLayoutColumn", { position: "before" });
            expect(modelWithSelection()).toBe(layout("1-1-1-1", "A", "[]", "", "B"));
        });

        it("is disabled with four columns and outside a column", () => {
            const command = editor.commands.get("insertLayoutColumn");
            setModelData(editor.model, layout("1-1-1-1", "A[]", "B", "C", "D"));
            expect(command?.isEnabled).toBe(false);
            editor.execute("insertLayoutColumn", { position: "after" });
            expect(modelWithSelection()).toBe(layout("1-1-1-1", "A[]", "B", "C", "D"));

            setModelData(editor.model, "<paragraph>A[]</paragraph>");
            expect(command?.isEnabled).toBe(false);
            editor.execute("insertLayoutColumn", { position: "after" });
            expect(modelWithSelection()).toBe("<paragraph>A[]</paragraph>");
        });
    });
});
