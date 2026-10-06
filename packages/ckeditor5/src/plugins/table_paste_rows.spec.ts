import {
    _getModelData as getModelData,
    _setModelData as setModelData,
    Essentials,
    Paragraph,
    Table,
    TableSelection
} from "ckeditor5";
import type { ClassicEditor } from "ckeditor5";
import { beforeEach, describe, expect, it } from "vitest";

import { createTestEditor } from "../../test/editor-kit.js";
import { modelTable, selectCells } from "../../test/table-kit.js";
import TablePasteRows from "./table_paste_rows.js";

const ABOVE = "triliumPasteTableRowsAbove";
const BELOW = "triliumPasteTableRowsBelow";

describe("TablePasteRows", () => {
    let editor: ClassicEditor;

    beforeEach(async () => {
        editor = await createTestEditor([Essentials, Paragraph, Table, TablePasteRows]);
    });

    it("is enabled while the selection is in a single row of a table", () => {
        const isEnabled = () => [ABOVE, BELOW].map((name) => editor.commands.get(name)?.isEnabled);

        setModelData(editor.model, "<paragraph>fo[]o</paragraph>");
        expect(isEnabled()).toEqual([false, false]);

        setModelData(editor.model, modelTable([["1[]1", "12"], ["21", "22"]]));
        expect(isEnabled()).toEqual([true, true]);

        selectCells(editor, [1, 0], [1, 1]);
        expect(isEnabled()).toEqual([true, true]);

        selectCells(editor, [0, 0], [1, 0]);
        expect(isEnabled()).toEqual([false, false]);

        setModelData(editor.model, modelTable([["1[]1"]]));
        editor.enableReadOnlyMode("spec");
        expect(isEnabled()).toEqual([false, false]);
    });

    it("inserts a pasted table as new rows above or below the row, and selects them", () => {
        const html = htmlTable([["a", "b"], ["c", "d"]]);

        setModelData(editor.model, modelTable([["11", "12"], ["2[]1", "22"], ["31", "32"]]));
        editor.execute(ABOVE, { html, text: "" });
        expect(tableData(editor)).toBe(
            modelTable([["11", "12"], ["a", "b"], ["c", "d"], ["21", "22"], ["31", "32"]]));
        expect(selectedCellTexts(editor)).toEqual(["a", "b", "c", "d"]);

        setModelData(editor.model, modelTable([["11", "12"], ["2[]1", "22"], ["31", "32"]]));
        selectCells(editor, [1, 0], [1, 1]);
        editor.execute(BELOW, { html, text: "" });
        expect(tableData(editor)).toBe(
            modelTable([["11", "12"], ["21", "22"], ["a", "b"], ["c", "d"], ["31", "32"]]));
        expect(selectedCellTexts(editor)).toEqual(["a", "b", "c", "d"]);
    });

    it("widens the table for a wider paste and leaves the rest of a narrower one empty", () => {
        setModelData(editor.model, modelTable([["1[]1"], ["21"]]));
        editor.execute(BELOW, { html: htmlTable([["a", "b", "c"]]), text: "" });
        expect(tableData(editor))
            .toBe(modelTable([["11", "", ""], ["a", "b", "c"], ["21", "", ""]]));
        expect(selectedCellTexts(editor)).toEqual(["a", "b", "c"]);

        setModelData(editor.model, modelTable([["1[]1", "12", "13"]]));
        editor.execute(ABOVE, { html: htmlTable([["a"]]), text: "" });
        expect(tableData(editor)).toBe(modelTable([["a", "", ""], ["11", "12", "13"]]));
        expect(selectedCellTexts(editor)).toEqual(["a", "", ""]);
    });

    it("puts content other than a table in the first cell of one new row", () => {
        setModelData(editor.model, modelTable([["1[]1", "12"]]));
        editor.execute(BELOW, { html: "", text: "plain" });

        expect(tableData(editor)).toBe(modelTable([["11", "12"], ["plain", ""]]));
        expect(selectedCellTexts(editor)).toEqual(["plain", ""]);
    });

    it("keeps the new rows out of a block of rows joined by a merged cell", () => {
        const block = (...rows: string[][]) => modelTable([
            [{ contents: "a", rowspan: 2 }, "b"],
            ["c"],
            ...rows,
            ["d", "e"]
        ]);
        const html = htmlTable([["x", "y"]]);

        setModelData(editor.model, block().replace(">c<", ">c[]<"));
        editor.execute(ABOVE, { html, text: "" });
        expect(tableData(editor)).toBe(block().replace("<table>", `<table>${rowMarkup("x", "y")}`));

        setModelData(editor.model, block().replace(">c<", ">c[]<"));
        editor.execute(BELOW, { html, text: "" });
        expect(tableData(editor)).toBe(block(["x", "y"]));
    });

    it("changes nothing for an empty clipboard, and undoes a paste in one step", () => {
        const table = modelTable([["1[]1", "12"]]);

        setModelData(editor.model, table);
        editor.execute(ABOVE, { html: "", text: "" });
        expect(getModelData(editor.model)).toBe(table);

        editor.execute(ABOVE, { html: htmlTable([["a", "b"]]), text: "" });
        editor.execute("undo");
        expect(tableData(editor)).toBe(modelTable([["11", "12"]]));
    });
});

function htmlTable(rows: string[][]): string {
    const body = rows
        .map((cells) => `<tr>${cells.map((cell) => `<td>${cell}</td>`).join("")}</tr>`)
        .join("");
    return `<table><tbody>${body}</tbody></table>`;
}

function rowMarkup(...cells: string[]): string {
    return modelTable([cells]).replace(/^<table>|<\/table>$/g, "");
}

function tableData(editor: ClassicEditor): string {
    return getModelData(editor.model, { withoutSelection: true });
}

/** The text of every cell in the cell selection, in document order. */
function selectedCellTexts(editor: ClassicEditor): string[] {
    const cells = editor.plugins.get(TableSelection).getSelectedTableCells() ?? [];
    return cells.map((cell) => Array.from(editor.model.createRangeIn(cell).getItems())
        .map((item) => (item.is("$textProxy") ? item.data : ""))
        .join(""));
}
