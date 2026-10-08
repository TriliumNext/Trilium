import {
    _getModelData as getModelData,
    _setModelData as setModelData,
    type ClassicEditor,
    Essentials,
    List,
    Paragraph,
    Table
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

describe("multicolumn commands", () => {
    let editor: ClassicEditor;

    beforeEach(async () => {
        editor = await createTestEditor([Essentials, Paragraph, List, Table, Multicolumn]);
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
});
