import { _getModelData as getModelData, _setModelData as setModelData, Essentials, Paragraph, Table, TableSelection, TableUtils } from "ckeditor5";
import type { ClassicEditor, Editor, ModelElement } from "ckeditor5";
import { beforeEach, describe, expect, it } from "vitest";

import { createTestEditor } from "../../test/editor-kit.js";
import { modelTable as spannedTable } from "../../test/table-kit.js";
import TableContextMenu from "./table_context_menu.js";

const INSERT_COMMANDS = [
    "triliumInsertTableRowsAbove",
    "triliumInsertTableRowsBelow",
    "triliumInsertTableColumnsLeft",
    "triliumInsertTableColumnsRight"
] as const;

describe("TableContextMenu", () => {
    let editor: ClassicEditor;

    beforeEach(async () => {
        editor = await createTestEditor([Essentials, Paragraph, Table, TableSelection, TableContextMenu]);
    });

    it("loads and registers the multi-insert commands", () => {
        expect(editor.plugins.get(TableContextMenu)).toBeInstanceOf(TableContextMenu);
        for (const name of INSERT_COMMANDS) {
            expect(editor.commands.get(name), name).toBeDefined();
        }
    });

    it("enables the insert commands only inside a table", () => {
        setModelData(editor.model, "<paragraph>fo[]o</paragraph>");
        for (const name of INSERT_COMMANDS) {
            expect(editor.commands.get(name)?.isEnabled, name).toBe(false);
        }

        setModelData(editor.model, modelTable([["1[]1"]]));
        for (const name of INSERT_COMMANDS) {
            expect(editor.commands.get(name)?.isEnabled, name).toBe(true);
        }
    });

    describe("insert rows", () => {
        it("inserts one row above or below the caret row", () => {
            setModelData(editor.model, modelTable([["1[]1", "12"], ["21", "22"]]));
            editor.execute("triliumInsertTableRowsAbove");
            expect(tableData(editor)).toBe(modelTable([["", ""], ["11", "12"], ["21", "22"]]));

            setModelData(editor.model, modelTable([["1[]1", "12"], ["21", "22"]]));
            editor.execute("triliumInsertTableRowsBelow");
            expect(tableData(editor)).toBe(modelTable([["11", "12"], ["", ""], ["21", "22"]]));
        });

        it("inserts as many rows as the selection spans", () => {
            setModelData(editor.model, modelTable([["11"], ["21"], ["31"]]));
            selectCells(editor, [0, 0], [1, 0]);
            editor.execute("triliumInsertTableRowsAbove");
            expect(tableData(editor)).toBe(modelTable([[""], [""], ["11"], ["21"], ["31"]]));

            setModelData(editor.model, modelTable([["11"], ["21"], ["31"]]));
            selectCells(editor, [1, 0], [2, 0]);
            editor.execute("triliumInsertTableRowsBelow");
            expect(tableData(editor)).toBe(modelTable([["11"], ["21"], ["31"], [""], [""]]));
        });

        it("extends headingRows only when inserting inside the heading band", () => {
            setModelData(editor.model, modelTable([["h[]1"], ["21"]], 'headingRows="1"'));
            editor.execute("triliumInsertTableRowsAbove");
            expect(tableData(editor)).toBe(modelTable([[""], ["h1"], ["21"]], 'headingRows="2"'));

            setModelData(editor.model, modelTable([["h[]1"], ["21"]], 'headingRows="1"'));
            editor.execute("triliumInsertTableRowsBelow");
            expect(tableData(editor)).toBe(modelTable([["h1"], [""], ["21"]], 'headingRows="1"'));
        });
    });

    describe("insert columns", () => {
        it("inserts one column left or right of the caret column", () => {
            setModelData(editor.model, modelTable([["1[]1", "12"]]));
            editor.execute("triliumInsertTableColumnsLeft");
            expect(tableData(editor)).toBe(modelTable([["", "11", "12"]]));

            setModelData(editor.model, modelTable([["1[]1", "12"]]));
            editor.execute("triliumInsertTableColumnsRight");
            expect(tableData(editor)).toBe(modelTable([["11", "", "12"]]));
        });

        it("inserts as many columns as the selection spans", () => {
            setModelData(editor.model, modelTable([["11", "12", "13"]]));
            selectCells(editor, [0, 0], [0, 1]);
            editor.execute("triliumInsertTableColumnsLeft");
            expect(tableData(editor)).toBe(modelTable([["", "", "11", "12", "13"]]));

            setModelData(editor.model, modelTable([["11", "12", "13"]]));
            selectCells(editor, [0, 0], [0, 1]);
            editor.execute("triliumInsertTableColumnsRight");
            expect(tableData(editor)).toBe(modelTable([["11", "12", "", "", "13"]]));
        });
    });

    describe("delete table", () => {
        it("is enabled only inside a table", () => {
            setModelData(editor.model, "<paragraph>fo[]o</paragraph>");
            expect(editor.commands.get("triliumDeleteTable")?.isEnabled).toBe(false);

            setModelData(editor.model, modelTable([["1[]1"]]));
            expect(editor.commands.get("triliumDeleteTable")?.isEnabled).toBe(true);

            editor.enableReadOnlyMode("spec");
            expect(editor.commands.get("triliumDeleteTable")?.isEnabled).toBe(false);
        });

        it("replaces the table with an empty paragraph holding the caret", () => {
            setModelData(editor.model,
                `<paragraph>a</paragraph>${modelTable([["1[]1", "12"]])}<paragraph>b</paragraph>`);
            editor.execute("triliumDeleteTable");
            expect(getModelData(editor.model))
                .toBe("<paragraph>a</paragraph><paragraph>[]</paragraph><paragraph>b</paragraph>");

            setModelData(editor.model, modelTable([["11", "12"], ["21", "22"]]));
            selectCells(editor, [0, 0], [1, 1]);
            editor.execute("triliumDeleteTable");
            expect(getModelData(editor.model)).toBe("<paragraph>[]</paragraph>");
        });

        it("deletes only the innermost table around the selection", () => {
            const inner = "<table><tableRow><tableCell><paragraph>in[]ner</paragraph></tableCell>"
                + "</tableRow></table>";
            setModelData(editor.model,
                `<table><tableRow><tableCell>${inner}</tableCell></tableRow></table>`);

            editor.execute("triliumDeleteTable");

            expect(getModelData(editor.model)).toBe(
                "<table><tableRow><tableCell><paragraph>[]</paragraph></tableCell></tableRow></table>"
            );
        });

        it("undoes in one step", () => {
            setModelData(editor.model, modelTable([["1[]1", "12"]]));
            editor.execute("triliumDeleteTable");
            editor.execute("undo");
            expect(tableData(editor)).toBe(modelTable([["11", "12"]]));
        });
    });

    describe("reset cell spans", () => {
        const COMMAND = "triliumResetTableCellSpans";

        it("is enabled only when the selection holds a merged cell", () => {
            setModelData(editor.model, "<paragraph>fo[]o</paragraph>");
            expect(editor.commands.get(COMMAND)?.isEnabled).toBe(false);

            setModelData(editor.model,
                spannedTable([[{ contents: "a", colspan: 2 }], ["b", "c[]"]]));
            expect(editor.commands.get(COMMAND)?.isEnabled).toBe(false);

            selectCells(editor, [0, 0], [1, 1]);
            expect(editor.commands.get(COMMAND)?.isEnabled).toBe(true);

            setModelData(editor.model,
                spannedTable([[{ contents: "a[]", rowspan: 2 }, "b"], ["c"]]));
            expect(editor.commands.get(COMMAND)?.isEnabled).toBe(true);
        });

        it("splits a merged cell back into single cells, keeping its content in the first", () => {
            setModelData(editor.model,
                spannedTable([[{ contents: "a[]", colspan: 2 }], ["b", "c"]]));
            editor.execute(COMMAND);
            expect(tableData(editor)).toBe(modelTable([["a", ""], ["b", "c"]]));

            setModelData(editor.model,
                spannedTable([[{ contents: "a[]", rowspan: 2 }, "b"], ["c"]]));
            editor.execute(COMMAND);
            expect(tableData(editor)).toBe(modelTable([["a", "b"], ["", "c"]]));

            setModelData(editor.model, spannedTable([
                [{ contents: "a[]", colspan: 2, rowspan: 2 }, "b"],
                ["c"],
                ["d", "e", "f"]
            ]));
            editor.execute(COMMAND);
            expect(tableData(editor))
                .toBe(modelTable([["a", "", "b"], ["", "", "c"], ["d", "e", "f"]]));
        });

        it("resets every merged cell of a multi-cell selection and ignores the rest", () => {
            setModelData(editor.model, spannedTable([
                [{ contents: "a", colspan: 2 }, "b"],
                ["c", "d", { contents: "e", rowspan: 2 }],
                ["f", "g"]
            ]));
            selectCells(editor, [0, 0], [1, 2]);
            editor.execute(COMMAND);

            expect(tableData(editor)).toBe(modelTable([
                ["a", "", "b"],
                ["c", "d", "e"],
                ["f", "g", ""]
            ]));
        });

        it("undoes in one step", () => {
            const merged = spannedTable([
                [{ contents: "a", colspan: 2 }, { contents: "b", rowspan: 2 }],
                ["c", "d"]
            ]);
            setModelData(editor.model, merged);
            selectCells(editor, [0, 0], [1, 1]);

            editor.execute(COMMAND);
            editor.execute("undo");

            expect(tableData(editor)).toBe(merged);
        });
    });

    describe("header rows", () => {
        const FIRST_ROWS = "triliumSetTableHeaderRow";
        const LATER_ROW = "triliumSetTableHeaderUpToRow";
        const isEnabled = (name: string) => editor.commands.get(name)?.isEnabled;
        const value = (name: string) => editor.commands.get(name)?.value;

        it("enables one command for rows from the first, the other for a single later row", () => {
            setModelData(editor.model, "<paragraph>fo[]o</paragraph>");
            expect([isEnabled(FIRST_ROWS), isEnabled(LATER_ROW)]).toEqual([false, false]);

            setModelData(editor.model, modelTable([["1[]1", "12"], ["21", "22"], ["31", "32"]]));
            expect([isEnabled(FIRST_ROWS), isEnabled(LATER_ROW)]).toEqual([true, false]);

            selectCells(editor, [0, 0], [1, 1]);
            expect([isEnabled(FIRST_ROWS), isEnabled(LATER_ROW)]).toEqual([true, false]);

            selectCells(editor, [1, 0], [1, 1]);
            expect([isEnabled(FIRST_ROWS), isEnabled(LATER_ROW)]).toEqual([false, true]);

            selectCells(editor, [1, 0], [2, 0]);
            expect([isEnabled(FIRST_ROWS), isEnabled(LATER_ROW)]).toEqual([false, false]);

            setModelData(editor.model, modelTable([["11"], ["2[]1"]]));
            expect([isEnabled(FIRST_ROWS), isEnabled(LATER_ROW)]).toEqual([false, true]);

            editor.enableReadOnlyMode("spec");
            expect([isEnabled(FIRST_ROWS), isEnabled(LATER_ROW)]).toEqual([false, false]);
        });

        it("holds true while every selected row is a header row", () => {
            setModelData(editor.model, modelTable([["1[]1"], ["21"], ["31"]], 'headingRows="2"'));
            expect(value(FIRST_ROWS)).toBe(true);

            selectCells(editor, [0, 0], [1, 0]);
            expect(value(FIRST_ROWS)).toBe(true);

            selectCells(editor, [0, 0], [2, 0]);
            expect(value(FIRST_ROWS)).toBe(false);

            selectCells(editor, [1, 0], [1, 0]);
            expect(value(LATER_ROW)).toBe(true);

            selectCells(editor, [2, 0], [2, 0]);
            expect(value(LATER_ROW)).toBe(false);
        });

        it("extends the header rows down to the selected rows", () => {
            setModelData(editor.model, modelTable([["11"], ["21"], ["31"]]));
            selectCells(editor, [0, 0], [1, 0]);
            editor.execute(FIRST_ROWS);
            expect(tableData(editor))
                .toBe(modelTable([["11"], ["21"], ["31"]], 'headingRows="2"'));

            setModelData(editor.model,
                modelTable([["11"], ["21"], ["31"], ["4[]1"]], 'headingRows="1"'));
            editor.execute(LATER_ROW);
            expect(tableData(editor))
                .toBe(modelTable([["11"], ["21"], ["31"], ["41"]], 'headingRows="4"'));
        });

        it("turns the selected row and every header row below it into body rows", () => {
            const rows = [["11"], ["21"], ["31"], ["41"], ["51"]];

            setModelData(editor.model, modelTable([["11"], ["2[]1"], ["31"], ["41"], ["51"]],
                'headingRows="5"'));
            editor.execute(LATER_ROW);
            expect(tableData(editor)).toBe(modelTable(rows, 'headingRows="1"'));

            setModelData(editor.model, modelTable([["1[]1"], ["21"], ["31"], ["41"], ["51"]],
                'headingRows="5"'));
            editor.execute(FIRST_ROWS);
            expect(tableData(editor)).toBe(modelTable(rows));

            editor.execute("undo");
            expect(tableData(editor)).toBe(modelTable(rows, 'headingRows="5"'));
        });
    });

    describe("select table", () => {
        const COMMAND = "triliumSelectTable";

        it("is enabled inside a table, in read-only mode too", () => {
            setModelData(editor.model, "<paragraph>fo[]o</paragraph>");
            expect(editor.commands.get(COMMAND)?.isEnabled).toBe(false);

            setModelData(editor.model, modelTable([["1[]1"]]));
            expect(editor.commands.get(COMMAND)?.isEnabled).toBe(true);

            editor.enableReadOnlyMode("spec");
            expect(editor.commands.get(COMMAND)?.isEnabled).toBe(true);
        });

        it("selects every cell of the table, merged cells included", () => {
            const rows = [
                [{ contents: "a", colspan: 2 }, "b"],
                ["c", "d", { contents: "e", rowspan: 2 }],
                ["f", "g"]
            ];
            const columns = ["20%", "30%", "50%"]
                .map((width) => `<tableColumn columnWidth="${width}"></tableColumn>`)
                .join("");
            const table = spannedTable(rows)
                .replace(/<\/table>$/, `<tableColumnGroup>${columns}</tableColumnGroup></table>`);
            setModelData(editor.model, table.replace(">d<", ">d[]<"));

            editor.execute(COMMAND);

            expect(getModelData(editor.model)).toBe(withEveryCellSelected(table));
        });

        it("selects only the innermost table around the selection", () => {
            const inner = modelTable([["11", "12"]]);
            const outer = (content: string) => "<table><tableRow><tableCell><paragraph>outer"
                + `</paragraph></tableCell><tableCell>${content}</tableCell></tableRow></table>`;
            setModelData(editor.model, outer(inner.replace("11", "1[]1")));

            editor.execute(COMMAND);

            expect(getModelData(editor.model)).toBe(outer(withEveryCellSelected(inner)));
        });
    });

    describe("syncSelectionToDomTarget", () => {
        it("moves the selection into an unselected cell", () => {
            setModelData(editor.model, modelTable([["1[]1", "12"], ["21", "22"]]));
            const plugin = editor.plugins.get(TableContextMenu);

            expect(plugin.syncSelectionToDomTarget(domCell(editor, 1, 1))).toBe(true);
            expect(selectionCells(editor)).toHaveLength(1);
            expect(selectionCells(editor)[0]).toBe(getCell(editor, 1, 1));

            // A node nested inside the cell resolves to the cell.
            const nested = domCell(editor, 0, 1).firstChild;
            expect(nested && plugin.syncSelectionToDomTarget(nested)).toBe(true);
            expect(selectionCells(editor)[0]).toBe(getCell(editor, 0, 1));

            // So does a text node.
            const text = document.createTreeWalker(domCell(editor, 1, 0), NodeFilter.SHOW_TEXT)
                .nextNode();
            expect(text && plugin.syncSelectionToDomTarget(text)).toBe(true);
            expect(selectionCells(editor)[0]).toBe(getCell(editor, 1, 0));
        });

        it("keeps a multi-cell selection that contains the target", () => {
            setModelData(editor.model, modelTable([["11", "12"], ["21", "22"]]));
            const plugin = editor.plugins.get(TableContextMenu);
            selectCells(editor, [0, 0], [1, 1]);

            expect(plugin.syncSelectionToDomTarget(domCell(editor, 0, 1))).toBe(true);
            expect(selectionCells(editor)).toHaveLength(4);
            expect(selectionCells(editor)).toContain(getCell(editor, 0, 0));
        });

        it("rejects targets outside a table cell of this editor", () => {
            setModelData(editor.model, "<paragraph>foo</paragraph>");
            const plugin = editor.plugins.get(TableContextMenu);

            const paragraph = editor.editing.view.getDomRoot()?.querySelector("p");
            expect(paragraph && plugin.syncSelectionToDomTarget(paragraph)).toBe(false);
            expect(plugin.syncSelectionToDomTarget(document.body)).toBe(false);

            const strayCell = document.createElement("td");
            document.body.appendChild(strayCell);
            try {
                expect(plugin.syncSelectionToDomTarget(strayCell)).toBe(false);
            } finally {
                strayCell.remove();
            }
        });

        it("rejects a cell drawn inside another widget's raw content", async () => {
            const widgetEditor = await createTestEditor([
                Essentials, Paragraph, Table, TableSelection, TableContextMenu, RawTableWidget
            ]);
            setModelData(widgetEditor.model, "<rawTable></rawTable>");
            const plugin = widgetEditor.plugins.get(TableContextMenu);

            const rawCell = widgetEditor.editing.view.getDomRoot()?.querySelector(".raw-table td");
            expect(rawCell).toBeInstanceOf(HTMLTableCellElement);
            expect(rawCell && plugin.syncSelectionToDomTarget(rawCell)).toBe(false);
        });
    });

    describe("right-button mousedown", () => {
        it("keeps a cell selection alive under a right-click on it", () => {
            setModelData(editor.model, modelTable([["11", "12"], ["21", "22"]]));
            selectCells(editor, [0, 0], [1, 1]);

            const event = mouseDown(domCell(editor, 0, 1), 2);

            expect(event.defaultPrevented).toBe(true);
            expect(selectionCells(editor)).toHaveLength(4);
        });

        it("does not interfere with other clicks", () => {
            setModelData(editor.model, modelTable([["11", "12"], ["21", "22"]]));
            selectCells(editor, [0, 0], [1, 0]);

            // Left button on a selected cell.
            expect(mouseDown(domCell(editor, 0, 0), 0).defaultPrevented).toBe(false);

            // Right button outside the cell selection.
            expect(mouseDown(domCell(editor, 1, 1), 2).defaultPrevented).toBe(false);

            // Right button with a plain in-cell selection.
            setModelData(editor.model, modelTable([["1[]1"]]));
            expect(mouseDown(domCell(editor, 0, 0), 2).defaultPrevented).toBe(false);

            // Right button outside the table.
            setModelData(editor.model, `${modelTable([["11", "12"]])}<paragraph>foo</paragraph>`);
            selectCells(editor, [0, 0], [0, 1]);
            const paragraph = editor.editing.view.getDomRoot()
                ?.querySelector<HTMLElement>(":scope > p");
            expect(paragraph).toBeInstanceOf(HTMLParagraphElement);
            expect(paragraph && mouseDown(paragraph, 2).defaultPrevented).toBe(false);
        });
    });
});

function modelTable(rows: string[][], attributes = ""): string {
    const rowsMarkup = rows
        .map((cells) => {
            const cellsMarkup = cells
                .map((cell) => `<tableCell><paragraph>${cell}</paragraph></tableCell>`)
                .join("");
            return `<tableRow>${cellsMarkup}</tableRow>`;
        })
        .join("");
    return `<table${attributes ? ` ${attributes}` : ""}>${rowsMarkup}</table>`;
}

function tableData(editor: ClassicEditor): string {
    return getModelData(editor.model, { withoutSelection: true });
}

/** Marks every cell of `markup` as selected, the way `getModelData` prints a cell selection. */
function withEveryCellSelected(markup: string): string {
    return markup.replace(/<tableCell[^>]*>.*?<\/tableCell>/g, "[$&]");
}

function getCell(editor: ClassicEditor, row: number, column: number): ModelElement {
    const cell = editor.model.document.getRoot()?.getNodeByPath([0, row, column]);
    if (!cell || !cell.is("element", "tableCell")) {
        throw new Error(`No table cell at row ${row}, column ${column}.`);
    }
    return cell;
}

function domCell(editor: ClassicEditor, row: number, column: number): HTMLElement {
    const viewCell = editor.editing.mapper.toViewElement(getCell(editor, row, column));
    const dom = viewCell && editor.editing.view.domConverter.mapViewToDom(viewCell);
    if (!(dom instanceof HTMLElement)) {
        throw new Error(`No DOM cell at row ${row}, column ${column}.`);
    }
    return dom;
}

function selectCells(editor: ClassicEditor, anchor: [number, number], target: [number, number]) {
    editor.plugins.get(TableSelection).setCellSelection(
        getCell(editor, anchor[0], anchor[1]),
        getCell(editor, target[0], target[1])
    );
}

function selectionCells(editor: ClassicEditor): ModelElement[] {
    return editor.plugins.get(TableUtils).getSelectionAffectedTableCells(editor.model.document.selection);
}

/** A widget whose raw view element holds a rendered table, like an included note's preview. */
function RawTableWidget(editor: Editor) {
    editor.model.schema.register("rawTable", { inheritAllFrom: "$blockObject" });
    editor.conversion.for("editingDowncast").elementToElement({
        model: "rawTable",
        view: (_element, { writer }) => writer.createRawElement("div", { class: "raw-table" },
            (domElement) => {
                domElement.innerHTML = "<table><tbody><tr><td>raw</td></tr></tbody></table>";
            })
    });
}

function mouseDown(target: HTMLElement, button: number): MouseEvent {
    const event = new MouseEvent("mousedown", { button, bubbles: true, cancelable: true });
    target.dispatchEvent(event);
    return event;
}
