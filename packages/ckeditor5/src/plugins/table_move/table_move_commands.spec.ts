import {
    _getModelData as getModelData,
    _setModelData as setModelData,
    Essentials,
    Paragraph,
    Table,
    TableColumnResize,
    TableUtils
} from "ckeditor5";
import type { ClassicEditor } from "ckeditor5";
import { beforeEach, describe, expect, it } from "vitest";

import { createTestEditor } from "../../../test/editor-kit.js";
import { cellAt, modelTable, selectCells } from "../../../test/table-kit.js";
import TableMove from "./table_move.js";

const MOVE_COMMANDS = [
    "moveTableRowUp",
    "moveTableRowDown",
    "moveTableColumnLeft",
    "moveTableColumnRight"
] as const;

describe("table move commands", () => {
    let editor: ClassicEditor;

    beforeEach(async () => {
        editor = await createTestEditor([Essentials, Paragraph, Table, TableColumnResize, TableMove]);
    });

    function tableData(): string {
        return getModelData(editor.model, { withoutSelection: true });
    }

    describe("isEnabled", () => {
        it("is disabled outside a table", () => {
            setModelData(editor.model, "<paragraph>fo[]o</paragraph>");
            for (const name of MOVE_COMMANDS) {
                expect(editor.commands.get(name)?.isEnabled, name).toBe(false);
            }
        });

        it("is disabled when the move would leave the table", () => {
            setModelData(editor.model, modelTable([["a[]"]]));
            for (const name of MOVE_COMMANDS) {
                expect(editor.commands.get(name)?.isEnabled, name).toBe(false);
            }

            setModelData(editor.model, modelTable([["a[]", "b"], ["c", "d"]]));
            expect(editor.commands.get("moveTableRowUp")?.isEnabled).toBe(false);
            expect(editor.commands.get("moveTableRowDown")?.isEnabled).toBe(true);
            expect(editor.commands.get("moveTableColumnLeft")?.isEnabled).toBe(false);
            expect(editor.commands.get("moveTableColumnRight")?.isEnabled).toBe(true);
        });

        it("is disabled when merged cells bind the whole table into one group", () => {
            setModelData(editor.model, modelTable([
                [{ contents: "a[]", rowspan: 2 }, "b"],
                ["c"]
            ]));
            expect(editor.commands.get("moveTableRowUp")?.isEnabled).toBe(false);
            expect(editor.commands.get("moveTableRowDown")?.isEnabled).toBe(false);
        });

        it("execute is a no-op when the plan is gone despite the enabled state", () => {
            setModelData(editor.model, "<paragraph>fo[]o</paragraph>");
            const command = editor.commands.get("moveTableRowDown");
            if (!command) {
                throw new Error("Command not registered.");
            }
            command.isEnabled = true;
            expect(() => command.execute()).not.toThrow();
            expect(tableData()).toBe("<paragraph>foo</paragraph>");
        });
    });

    describe("row moves", () => {
        it("moves the caret row and keeps the caret in its cell", () => {
            setModelData(editor.model, modelTable([["a[]", "b"], ["c", "d"], ["e", "f"]]));
            editor.execute("moveTableRowDown");
            expect(getModelData(editor.model)).toBe(modelTable([["c", "d"], ["a[]", "b"], ["e", "f"]]));

            editor.execute("moveTableRowUp");
            expect(getModelData(editor.model)).toBe(modelTable([["a[]", "b"], ["c", "d"], ["e", "f"]]));
        });

        it("moves a rowspan group as one block", () => {
            const original = modelTable([
                ["a", "b"],
                [{ contents: "c", rowspan: 2 }, "d[]"],
                ["e"],
                ["f", "g"]
            ]);
            setModelData(editor.model, original);

            editor.execute("moveTableRowDown");
            expect(tableData()).toBe(modelTable([
                ["a", "b"],
                ["f", "g"],
                [{ contents: "c", rowspan: 2 }, "d"],
                ["e"]
            ]));

            editor.execute("moveTableRowUp");
            expect(getModelData(editor.model)).toBe(original);
        });

        it("jumps over a rowspan group instead of entering it", () => {
            setModelData(editor.model, modelTable([
                ["a[]", "b"],
                [{ contents: "c", rowspan: 2 }, "d"],
                ["e"],
                ["f", "g"]
            ]));

            editor.execute("moveTableRowDown");
            expect(tableData()).toBe(modelTable([
                [{ contents: "c", rowspan: 2 }, "d"],
                ["e"],
                ["a", "b"],
                ["f", "g"]
            ]));
        });

        it("moves every row a multi-cell selection touches and keeps the selection", () => {
            setModelData(editor.model, modelTable([["a"], ["b"], ["c"], ["d"]]));
            const selected = [cellAt(editor, 0, 0), cellAt(editor, 1, 0)];
            selectCells(editor, [0, 0], [1, 0]);

            editor.execute("moveTableRowDown");
            expect(tableData()).toBe(modelTable([["c"], ["a"], ["b"], ["d"]]));

            const tableUtils = editor.plugins.get(TableUtils);
            const cells = tableUtils.getSelectionAffectedTableCells(editor.model.document.selection);
            expect(cells).toHaveLength(2);
            for (const cell of selected) {
                expect(cells).toContain(cell);
            }
        });

        it("reverts order and heading in a single undo step", () => {
            const original = modelTable([["h[]"], ["b1"], ["b2"]], 'headingRows="1"');
            setModelData(editor.model, original);

            editor.execute("moveTableRowDown");
            editor.execute("undo");
            expect(getModelData(editor.model)).toBe(original);
        });
    });

    describe("headingRows", () => {
        it("drops heading status from a header row moved below the band", () => {
            setModelData(editor.model, modelTable([["h[]"], ["b1"], ["b2"]], 'headingRows="1"'));
            editor.execute("moveTableRowDown");
            expect(tableData()).toBe(modelTable([["b1"], ["h"], ["b2"]]));
        });

        it("grants heading status to a body row moved into the band", () => {
            setModelData(editor.model, modelTable([["h"], ["b1[]"], ["b2"]], 'headingRows="1"'));
            editor.execute("moveTableRowUp");
            expect(tableData()).toBe(modelTable([["b1"], ["h"], ["b2"]], 'headingRows="2"'));
        });

        it("keeps the count when the move stays inside the band or inside the body", () => {
            setModelData(editor.model, modelTable([["h1[]"], ["h2"], ["b1"]], 'headingRows="2"'));
            editor.execute("moveTableRowDown");
            expect(tableData()).toBe(modelTable([["h2"], ["h1"], ["b1"]], 'headingRows="2"'));

            setModelData(editor.model, modelTable([["h"], ["b1[]"], ["b2"]], 'headingRows="1"'));
            editor.execute("moveTableRowDown");
            expect(tableData()).toBe(modelTable([["h"], ["b2"], ["b1"]], 'headingRows="1"'));
        });
    });

    describe("column moves", () => {
        it("moves the caret column and keeps the caret in its cell", () => {
            setModelData(editor.model, modelTable([["a[]", "b"], ["c", "d"]]));
            editor.execute("moveTableColumnRight");
            expect(getModelData(editor.model)).toBe(modelTable([["b", "a[]"], ["d", "c"]]));

            editor.execute("moveTableColumnLeft");
            expect(getModelData(editor.model)).toBe(modelTable([["a[]", "b"], ["c", "d"]]));
        });

        it("moves a colspan group as one block", () => {
            setModelData(editor.model, modelTable([
                ["a", { contents: "b", colspan: 2 }, "d"],
                ["e", "f[]", "g", "h"]
            ]));

            editor.execute("moveTableColumnRight");
            expect(tableData()).toBe(modelTable([
                ["a", "d", { contents: "b", colspan: 2 }],
                ["e", "h", "f", "g"]
            ]));
        });

        it("keeps the child order of rows covered by a rowspan", () => {
            setModelData(editor.model, modelTable([
                [{ contents: "a", rowspan: 2 }, "b[]", "c"],
                ["d", "e"]
            ]));

            editor.execute("moveTableColumnLeft");
            expect(tableData()).toBe(modelTable([
                ["b", { contents: "a", rowspan: 2 }, "c"],
                ["d", "e"]
            ]));
        });

        it("moves every column a multi-cell selection touches", () => {
            setModelData(editor.model, modelTable([["a", "b", "c"], ["d", "e", "f"]]));
            selectCells(editor, [0, 1], [0, 2]);

            editor.execute("moveTableColumnLeft");
            expect(tableData()).toBe(modelTable([["b", "c", "a"], ["e", "f", "d"]]));
        });
    });

    describe("headingColumns", () => {
        it("follows the band boundary like headingRows", () => {
            setModelData(editor.model, modelTable([["h[]", "b1", "b2"]], 'headingColumns="1"'));
            editor.execute("moveTableColumnRight");
            expect(tableData()).toBe(modelTable([["b1", "h", "b2"]]));

            setModelData(editor.model, modelTable([["h", "b1[]", "b2"]], 'headingColumns="1"'));
            editor.execute("moveTableColumnLeft");
            expect(tableData()).toBe(modelTable([["b1", "h", "b2"]], 'headingColumns="2"'));
        });
    });

    describe("column widths", () => {
        function tableWithWidths(cells: string[], columns: string): string {
            return modelTable([cells]).replace(
                "</table>",
                `<tableColumnGroup>${columns}</tableColumnGroup></table>`
            );
        }

        it("moves the width along with the column", () => {
            setModelData(editor.model, tableWithWidths(
                ["a[]", "b", "c"],
                '<tableColumn columnWidth="20%"></tableColumn>' +
                '<tableColumn columnWidth="30%"></tableColumn>' +
                '<tableColumn columnWidth="50%"></tableColumn>'
            ));

            editor.execute("moveTableColumnRight");
            expect(tableData()).toBe(tableWithWidths(
                ["b", "a", "c"],
                '<tableColumn columnWidth="30%"></tableColumn>' +
                '<tableColumn columnWidth="20%"></tableColumn>' +
                '<tableColumn columnWidth="50%"></tableColumn>'
            ));

            editor.execute("undo");
            expect(tableData()).toBe(tableWithWidths(
                ["a", "b", "c"],
                '<tableColumn columnWidth="20%"></tableColumn>' +
                '<tableColumn columnWidth="30%"></tableColumn>' +
                '<tableColumn columnWidth="50%"></tableColumn>'
            ));
        });

        it("expands a colSpan width entry into per-column entries", () => {
            setModelData(editor.model, tableWithWidths(
                ["a", "b", "c[]"],
                '<tableColumn columnWidth="25%" colSpan="2"></tableColumn>' +
                '<tableColumn columnWidth="50%"></tableColumn>'
            ));

            editor.execute("moveTableColumnLeft");
            expect(tableData()).toBe(tableWithWidths(
                ["a", "c", "b"],
                '<tableColumn columnWidth="25%"></tableColumn>' +
                '<tableColumn columnWidth="50%"></tableColumn>' +
                '<tableColumn columnWidth="25%"></tableColumn>'
            ));
        });

    });
});
