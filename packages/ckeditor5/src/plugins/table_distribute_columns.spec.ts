import {
    _getTableColumnsWidths as getTableColumnsWidths,
    _setModelData as setModelData,
    Essentials,
    Paragraph,
    Table,
    TableColumnResize,
    TableSelection
} from "ckeditor5";
import type { ClassicEditor, ModelElement } from "ckeditor5";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";

import { createTestEditor } from "../../test/editor-kit.js";
import { cellAt, modelTable, selectCells } from "../../test/table-kit.js";
import type { CellSpec } from "../../test/table-kit.js";
import { equalizeWidths } from "./table_distribute_columns.js";
import TableContextMenu from "./table_context_menu.js";

const PLUGINS = [Essentials, Paragraph, Table, TableSelection, TableColumnResize, TableContextMenu];
const COMMAND = "triliumDistributeTableColumns";

describe("equalizeWidths", () => {
    it("averages the range and leaves the other widths alone", () => {
        expect(equalizeWidths([20, 30, 50], { first: 0, last: 1 })).toEqual([25, 25, 50]);
        expect(equalizeWidths([50, 100, 200], { first: 1, last: 2 })).toEqual([50, 150, 150]);
        expect(equalizeWidths([10, 10, 10, 70], { first: 0, last: 2 })).toEqual([10, 10, 10, 70]);
    });

    it("gives the rounding remainder to the last column of the range", () => {
        expect(equalizeWidths([10, 20, 40, 30], { first: 0, last: 2 }))
            .toEqual([23.33, 23.33, 23.34, 30]);
    });
});

describe("DistributeTableColumnsCommand", () => {
    let editor: ClassicEditor;
    let collapsedBorders: HTMLStyleElement;

    // The spec does not load the editor stylesheet; the default border spacing would put gaps
    // between the cells that the collapsed borders of a real note table do not have.
    beforeAll(() => {
        collapsedBorders = document.createElement("style");
        collapsedBorders.textContent = "table { border-collapse: collapse; }";
        document.head.appendChild(collapsedBorders);
    });

    afterAll(() => {
        collapsedBorders.remove();
    });

    beforeEach(async () => {
        editor = await createTestEditor(PLUGINS);
    });

    describe("isEnabled", () => {
        it("requires a selection spanning two or more columns of a table", () => {
            setModelData(editor.model, "<paragraph>fo[]o</paragraph>");
            expect(isEnabled(editor)).toBe(false);

            setModelData(editor.model, modelTable([["a[]", "b"], ["c", "d"]]));
            expect(isEnabled(editor)).toBe(false);

            selectCells(editor, [0, 0], [1, 0]);
            expect(isEnabled(editor)).toBe(false);

            selectCells(editor, [0, 0], [0, 1]);
            expect(isEnabled(editor)).toBe(true);
        });

        it("counts every column a merged cell spans", () => {
            setModelData(editor.model, modelTable([[{ contents: "a[]", colspan: 2 }], ["b", "c"]]));
            expect(isEnabled(editor)).toBe(true);
        });

        it("is disabled in read-only mode", () => {
            setModelData(editor.model, modelTable([["a", "b"]]));
            selectCells(editor, [0, 0], [0, 1]);
            editor.enableReadOnlyMode("spec");
            expect(isEnabled(editor)).toBe(false);
        });
    });

    describe("on a resized table", () => {
        it("equalizes the selected columns and keeps the rest and the table width", () => {
            setModelData(editor.model,
                resizedTable([["a", "b", "c"]], ["20%", "30%", "50%"], 'tableWidth="80%"'));
            selectCells(editor, [0, 0], [0, 1]);

            editor.execute(COMMAND);

            expect(storedWidths(editor)).toEqual(["25%", "25%", "50%"]);
            expect(firstTable(editor).getAttribute("tableWidth")).toBe("80%");
            expect(editor.getData()).toContain('<col style="width:25%;">');
        });

        it("keeps the cell selection and undoes in one step", () => {
            setModelData(editor.model, resizedTable([["a", "b", "c"]], ["20%", "30%", "50%"]));
            selectCells(editor, [0, 1], [0, 2]);

            editor.execute(COMMAND);
            expect(storedWidths(editor)).toEqual(["20%", "40%", "40%"]);
            expect(editor.plugins.get(TableSelection).getSelectedTableCells())
                .toEqual([cellAt(editor, 0, 1), cellAt(editor, 0, 2)]);
            expect(firstTable(editor).hasAttribute("tableWidth")).toBe(false);

            editor.execute("undo");
            expect(storedWidths(editor)).toEqual(["20%", "30%", "50%"]);
        });

        it("distributes the whole table when every column is selected", () => {
            setModelData(editor.model, resizedTable([["a", "b", "c"]], ["20%", "30%", "50%"]));
            selectCells(editor, [0, 0], [0, 2]);

            editor.execute(COMMAND);

            expect(storedWidths(editor)).toEqual(["33.33%", "33.33%", "33.34%"]);
        });

        it("includes the columns under a merged cell", () => {
            setModelData(editor.model, resizedTable(
                [[{ contents: "a[]", colspan: 2 }, "b"], ["c", "d", "e"]],
                ["20%", "30%", "50%"]
            ));

            editor.execute(COMMAND);

            expect(storedWidths(editor)).toEqual(["25%", "25%", "50%"]);
        });

        it("keeps pixel widths in pixels", () => {
            setModelData(editor.model, resizedTable(
                [["a", "b", "c"]], ["100px", "100px", "200px"], 'tableWidth="400px"'
            ));
            selectCells(editor, [0, 1], [0, 2]);

            editor.execute(COMMAND);

            expect(storedWidths(editor)).toEqual(["100px", "150px", "150px"]);
            expect(firstTable(editor).getAttribute("tableWidth")).toBe("400px");
        });

        it("measures the rendered columns when the stored widths mix units", () => {
            setModelData(editor.model,
                resizedTable([["a", LONG_TEXT, "c"]], ["50%", "100px", "50%"]));
            selectCells(editor, [0, 0], [0, 1]);

            editor.execute(COMMAND);

            const widths = percentages(storedWidths(editor));
            expect(widths[0]).toBeCloseTo(widths[1], 1);
            expect(sum(widths)).toBeCloseTo(100, 1);
        });
    });

    describe("on a table that was never resized", () => {
        it("stores the measured widths with the selected columns equalized", () => {
            setModelData(editor.model, modelTable([["a", LONG_TEXT, "c"], ["d", "e", "f"]]));
            const shares = renderedShares(editor, 0);
            selectCells(editor, [0, 0], [1, 1]);

            editor.execute(COMMAND);

            expectDistributed(editor, shares);
            expect(String(firstTable(editor).getAttribute("tableWidth"))).toMatch(/^\d+(\.\d+)?%$/);
        });

        it("keeps a table width set in percent", () => {
            setModelData(editor.model, modelTable([["a", LONG_TEXT, "c"]], 'tableWidth="90%"'));
            const shares = renderedShares(editor, 0);
            selectCells(editor, [0, 0], [0, 1]);

            editor.execute(COMMAND);

            expectDistributed(editor, shares);
            expect(firstTable(editor).getAttribute("tableWidth")).toBe("90%");
        });

        it("stores pixel widths that add up to a table width set in pixels", () => {
            setModelData(editor.model, modelTable([["a", LONG_TEXT, "c"]], 'tableWidth="600px"'));
            selectCells(editor, [0, 0], [0, 1]);

            editor.execute(COMMAND);

            const stored = storedWidths(editor);
            expect(stored.every((width) => width.endsWith("px"))).toBe(true);
            const widths = stored.map((width) => parseFloat(width));
            expect(widths[0]).toBeCloseTo(widths[1], 1);
            expect(sum(widths)).toBeCloseTo(600, 0);
            expect(firstTable(editor).getAttribute("tableWidth")).toBe("600px");
        });

        it("splits columns that merged cells always join in proportion", () => {
            setModelData(editor.model, modelTable([
                [{ contents: LONG_TEXT, colspan: 2 }, "c", "d"],
                [{ contents: "e", colspan: 2 }, "f", "g"]
            ]));
            const [merged] = renderedShares(editor, 0);
            selectCells(editor, [0, 1], [1, 2]);

            editor.execute(COMMAND);

            const widths = percentages(storedWidths(editor));
            expect(widths[0]).toBeCloseTo(merged / 2, 0);
            expect(widths[1]).toBeCloseTo(merged / 2, 0);
            expect(widths[2]).toBeCloseTo(widths[3], 1);
        });

        it("measures right-to-left content", async () => {
            const rtlEditor = await createTestEditor(PLUGINS, { language: { content: "ar" } });
            setModelData(rtlEditor.model, modelTable([["a", LONG_TEXT, "c"]]));
            const shares = renderedShares(rtlEditor, 0);
            selectCells(rtlEditor, [0, 0], [0, 1]);

            rtlEditor.execute(COMMAND);

            expectDistributed(rtlEditor, shares);
        });

        it("changes nothing while the table cannot be measured", () => {
            setModelData(editor.model, modelTable([["a", "b"]]));
            selectCells(editor, [0, 0], [0, 1]);
            editor.ui.element?.style.setProperty("display", "none");

            editor.execute(COMMAND);

            expect(storedWidths(editor)).toEqual([]);
            expect(firstTable(editor).hasAttribute("tableWidth")).toBe(false);
        });

        it("changes nothing while the editable has no width to relate the table to", () => {
            setModelData(editor.model, modelTable([["a", "b"]]));
            selectCells(editor, [0, 0], [0, 1]);
            const root = editor.editing.view.getDomRoot();
            expect(root).toBeInstanceOf(HTMLElement);
            root?.style.setProperty("width", "0");
            root?.style.setProperty("padding", "0");

            editor.execute(COMMAND);

            expect(storedWidths(editor)).toEqual([]);
        });
    });
});

const LONG_TEXT = "a considerably longer cell content";

function isEnabled(editor: ClassicEditor) {
    return editor.commands.get(COMMAND)?.isEnabled;
}

function resizedTable(rows: CellSpec[][], widths: string[], attributes = ""): string {
    const columns = widths.map((width) => `<tableColumn columnWidth="${width}"></tableColumn>`);
    return modelTable(rows, attributes)
        .replace(/<\/table>$/, `<tableColumnGroup>${columns.join("")}</tableColumnGroup></table>`);
}

function firstTable(editor: ClassicEditor): ModelElement {
    const table = editor.model.document.getRoot()?.getChild(0);
    if (!table?.is("element", "table")) {
        throw new Error("The first root child is not a table.");
    }
    return table;
}

function storedWidths(editor: ClassicEditor): string[] {
    return getTableColumnsWidths(firstTable(editor));
}

function percentages(widths: string[]): number[] {
    expect(widths.every((width) => width.endsWith("%"))).toBe(true);
    return widths.map((width) => parseFloat(width));
}

function sum(values: number[]): number {
    return values.reduce((total, value) => total + value, 0);
}

/** The rendered width of each cell in a row, in percent of the row's width. */
function renderedShares(editor: ClassicEditor, rowIndex: number): number[] {
    const row = firstTable(editor).getChild(rowIndex);
    if (!row?.is("element", "tableRow")) {
        throw new Error(`No table row at index ${rowIndex}.`);
    }

    const widths = [...row.getChildren()].map((cell) => {
        const viewCell = cell.is("element") && editor.editing.mapper.toViewElement(cell);
        const domCell = viewCell && editor.editing.view.domConverter.mapViewToDom(viewCell);
        if (!(domCell instanceof HTMLElement)) {
            throw new Error("A table cell is not rendered.");
        }
        return domCell.getBoundingClientRect().width;
    });
    const total = sum(widths);
    expect(total).toBeGreaterThan(0);
    return widths.map((width) => width / total * 100);
}

/** Asserts that the first two of three columns are equal and the third keeps its share. */
function expectDistributed(editor: ClassicEditor, shares: number[]) {
    expect(shares[1]).toBeGreaterThan(shares[0] + 10);

    const widths = percentages(storedWidths(editor));
    expect(widths).toHaveLength(3);
    expect(widths[0]).toBeCloseTo(widths[1], 1);
    expect(widths[2]).toBeCloseTo(shares[2], 0);
    expect(sum(widths)).toBeCloseTo(100, 1);
}
