import {
    _getModelData as getModelData,
    _setModelData as setModelData,
    Essentials,
    Notification,
    Paragraph,
    Table,
    TableCaption,
    TableSelection
} from "ckeditor5";
import type { ClassicEditor, ModelElement } from "ckeditor5";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { createTestEditor } from "../../test/editor-kit.js";
import { modelTable, selectCells } from "../../test/table-kit.js";
import TableSort from "./table_sort.js";

const ASCENDING = "triliumSortTableRowsAscending";
const DESCENDING = "triliumSortTableRowsDescending";
const TIED_MESSAGE = "Some rows were sorted together because merged cells tie them to each other";

describe("TableSort", () => {
    let editor: ClassicEditor;

    beforeEach(async () => {
        editor = await createTestEditor([Essentials, Paragraph, Table, TableCaption, TableSort],
            { language: { content: "en" } });
    });

    function tableData(target = editor): string {
        return getModelData(target.model, { withoutSelection: true });
    }

    function isEnabled(name = ASCENDING, target = editor): boolean {
        return target.commands.get(name)?.isEnabled === true;
    }

    describe("isEnabled", () => {
        it("is disabled outside a table", () => {
            setModelData(editor.model, "<paragraph>fo[]o</paragraph>");
            expect(isEnabled(ASCENDING)).toBe(false);
            expect(isEnabled(DESCENDING)).toBe(false);
        });

        it("is enabled in a column with at least two body rows", () => {
            setModelData(editor.model, modelTable([["b[]"], ["a"]]));
            expect(isEnabled(ASCENDING)).toBe(true);
            expect(isEnabled(DESCENDING)).toBe(true);
        });

        it("is disabled when fewer than two row groups can move", () => {
            setModelData(editor.model, modelTable([["a[]"]]));
            expect(isEnabled()).toBe(false);

            setModelData(editor.model, modelTable([["h[]"], ["a"]], 'headingRows="1"'));
            expect(isEnabled()).toBe(false);

            setModelData(editor.model, modelTable([
                [{ contents: "a[]", rowspan: 2 }, "b"],
                ["c"]
            ]));
            expect(isEnabled()).toBe(false);
        });

        it("is disabled when the selection spans more than one column", () => {
            setModelData(editor.model, modelTable([["a", "b"], ["c", "d"], ["e", "f"]]));
            selectCells(editor, [0, 0], [1, 1]);
            expect(isEnabled()).toBe(false);

            selectCells(editor, [0, 1], [2, 1]);
            expect(isEnabled()).toBe(true);
        });

        it("is disabled when the selected rows are header rows only", () => {
            setModelData(editor.model,
                modelTable([["h1"], ["h2"], ["a"], ["b"]], 'headingRows="2"'));
            selectCells(editor, [0, 0], [1, 0]);
            expect(isEnabled()).toBe(false);
        });

        it("is disabled in read-only mode", () => {
            setModelData(editor.model, modelTable([["b[]"], ["a"]]));
            editor.enableReadOnlyMode("spec");
            expect(isEnabled()).toBe(false);
        });
    });

    describe("sorting by the column of the caret", () => {
        it("sorts every body row by the caret column, in both directions", () => {
            setModelData(editor.model, modelTable([["b", "1"], ["c", "3[]"], ["a", "2"]]));

            editor.execute(ASCENDING);
            expect(tableData()).toBe(modelTable([["b", "1"], ["a", "2"], ["c", "3"]]));

            editor.execute(DESCENDING);
            expect(tableData()).toBe(modelTable([["c", "3"], ["a", "2"], ["b", "1"]]));
        });

        it("orders times, dates, numbers and text, with empty cells last", () => {
            const values = ["text", "", "10", "2026-09-30", "15:02", "9"];
            setModelData(editor.model, modelTable(values.map((value, index) =>
                index === 0 ? [`${value}[]`] : [value])));

            editor.execute(ASCENDING);
            expect(tableData()).toBe(modelTable(
                [["15:02"], ["2026-09-30"], ["9"], ["10"], ["text"], [""]]));

            editor.execute(DESCENDING);
            expect(tableData()).toBe(modelTable(
                [["text"], ["10"], ["9"], ["2026-09-30"], ["15:02"], [""]]));
        });

        it("keeps header and footer rows in place", async () => {
            const withFooters = await createTestEditor([Essentials, Paragraph, Table, TableSort],
                { table: { enableFooters: true } });
            setModelData(withFooters.model, modelTable(
                [["Name"], ["z[]"], ["x"], ["y"], ["Total"]], 'footerRows="1" headingRows="1"'));

            withFooters.execute(ASCENDING);
            expect(tableData(withFooters)).toBe(modelTable(
                [["Name"], ["x"], ["y"], ["z"], ["Total"]], 'footerRows="1" headingRows="1"'));
        });

        it("reads formatted and multi-paragraph cells as plain text", () => {
            setModelData(editor.model, modelTable([
                ["10[]"],
                ["2</paragraph><paragraph>0"],
                ["<softBreak></softBreak>1"]
            ]));

            editor.execute(ASCENDING);
            expect(tableData()).toBe(modelTable([
                ["<softBreak></softBreak>1"],
                ["2</paragraph><paragraph>0"],
                ["10"]
            ]));
        });

        it("keeps the selection in its cell and the caption in place", () => {
            setModelData(editor.model, "<table>"
                + "<tableRow><tableCell><paragraph>b[]</paragraph></tableCell></tableRow>"
                + "<tableRow><tableCell><paragraph>a</paragraph></tableCell></tableRow>"
                + "<caption>Caption</caption></table>");

            editor.execute(ASCENDING);
            expect(getModelData(editor.model)).toBe("<table>"
                + "<tableRow><tableCell><paragraph>a</paragraph></tableCell></tableRow>"
                + "<tableRow><tableCell><paragraph>b[]</paragraph></tableCell></tableRow>"
                + "<caption>Caption</caption></table>");
        });

        it("sorts in one undo step", () => {
            const original = modelTable([["c[]"], ["a"], ["b"]]);
            setModelData(editor.model, original);

            editor.execute(ASCENDING);
            expect(tableData()).toBe(modelTable([["a"], ["b"], ["c"]]));

            editor.execute("undo");
            expect(tableData()).toBe(modelTable([["c"], ["a"], ["b"]]));
        });

        it("applies no change to an already sorted table", () => {
            setModelData(editor.model, modelTable([["a[]"], ["b"]]));
            const version = editor.model.document.version;

            editor.execute(ASCENDING);
            expect(editor.model.document.version).toBe(version);
        });

        it("does nothing when executed without a plan", () => {
            setModelData(editor.model, "<paragraph>fo[]o</paragraph>");
            const command = editor.commands.get(ASCENDING);
            if (!command) {
                throw new Error("Command not registered.");
            }
            command.isEnabled = true;
            expect(() => command.execute()).not.toThrow();
            expect(tableData()).toBe("<paragraph>foo</paragraph>");
        });
    });

    describe("sorting a cell selection", () => {
        it("sorts only the selected rows and keeps them selected", () => {
            setModelData(editor.model, modelTable([["d"], ["c"], ["b"], ["a"]]));
            selectCells(editor, [1, 0], [2, 0]);

            editor.execute(ASCENDING);
            expect(tableData()).toBe(modelTable([["d"], ["b"], ["c"], ["a"]]));
            const selected = editor.plugins.get(TableSelection).getSelectedTableCells() ?? [];
            expect(selected.map((cell) => cell.parent?.index)).toEqual([1, 2]);
            expect(selected.map((cell) => cellTextOf(cell))).toEqual(["b", "c"]);
        });

        it("leaves header rows out of the selected range", () => {
            setModelData(editor.model, modelTable([["z"], ["c"], ["b"], ["a"]], 'headingRows="1"'));
            selectCells(editor, [0, 0], [2, 0]);

            editor.execute(ASCENDING);
            expect(tableData()).toBe(modelTable([["z"], ["b"], ["c"], ["a"]], 'headingRows="1"'));
        });

        it("widens the selection to the rows its merged cells tie together", () => {
            setModelData(editor.model, modelTable([
                ["z", "d"],
                [{ contents: "y", rowspan: 2 }, "c"],
                ["b"],
                ["x", "a"]
            ]));
            selectCells(editor, [0, 0], [1, 0]);

            editor.execute(ASCENDING);
            expect(tableData()).toBe(modelTable([
                [{ contents: "y", rowspan: 2 }, "c"],
                ["b"],
                ["z", "d"],
                ["x", "a"]
            ]));
        });
    });

    describe("merged cells", () => {
        it("moves the rows of a merged cell as one group", () => {
            setModelData(editor.model, modelTable([
                [{ contents: "a[]", rowspan: 2 }, "z"],
                ["y"],
                ["b", "x"]
            ]));

            editor.execute(DESCENDING);
            expect(tableData()).toBe(modelTable([
                ["b", "x"],
                [{ contents: "a", rowspan: 2 }, "z"],
                ["y"]
            ]));
        });

        it("sorts a group by the cell of its first row and reports the tie", () => {
            const showInfo = vi.spyOn(editor.plugins.get(Notification), "showInfo");
            setModelData(editor.model, modelTable([
                [{ contents: "a", rowspan: 2 }, "z[]"],
                ["y"],
                ["b", "x"]
            ]));

            editor.execute(ASCENDING);
            expect(tableData()).toBe(modelTable([
                ["b", "x"],
                [{ contents: "a", rowspan: 2 }, "z"],
                ["y"]
            ]));
            expect(showInfo).toHaveBeenCalledExactlyOnceWith(TIED_MESSAGE);
        });

        it("does not report a group whose sort column holds a single cell", () => {
            const showInfo = vi.spyOn(editor.plugins.get(Notification), "showInfo");
            setModelData(editor.model, modelTable([
                [{ contents: "b[]", rowspan: 2 }, "z"],
                ["y"],
                ["a", "x"]
            ]));

            editor.execute(ASCENDING);
            expect(tableData()).toBe(modelTable([
                ["a", "x"],
                [{ contents: "b", rowspan: 2 }, "z"],
                ["y"]
            ]));
            expect(showInfo).not.toHaveBeenCalled();
        });

        it("reads a cell that spans columns under each column it covers", () => {
            setModelData(editor.model, modelTable([
                [{ contents: "c", colspan: 2 }],
                ["y", "a[]"],
                ["x", "b"]
            ]));
            editor.execute(ASCENDING);
            expect(tableData()).toBe(modelTable([
                ["y", "a"],
                ["x", "b"],
                [{ contents: "c", colspan: 2 }]
            ]));
        });

        it("sorts by the first column of a caret cell that spans columns", () => {
            setModelData(editor.model, modelTable([
                [{ contents: "c[]", colspan: 2 }],
                ["y", "a"],
                ["x", "b"]
            ]));
            editor.execute(ASCENDING);
            expect(tableData()).toBe(modelTable([
                [{ contents: "c", colspan: 2 }],
                ["x", "b"],
                ["y", "a"]
            ]));
        });
    });

    describe("locale and formats", () => {
        it("reads numbers with the content language of the note", async () => {
            setModelData(editor.model, modelTable([["1.500[]"], ["2"]]));
            editor.execute(ASCENDING);
            expect(tableData()).toBe(modelTable([["1.500"], ["2"]]));

            const german = await createTestEditor([Essentials, Paragraph, Table, TableSort],
                { language: { content: "de" } });
            setModelData(german.model, modelTable([["1.500[]"], ["2"]]));
            german.execute(ASCENDING);
            expect(tableData(german)).toBe(modelTable([["2"], ["1.500"]]));
        });

        it("recognizes the configured date formats", async () => {
            const rows = [["01|10|2026[]"], ["30|09|2026"]];
            setModelData(editor.model, modelTable(rows));
            editor.execute(ASCENDING);
            expect(tableData()).toBe(modelTable([["01|10|2026"], ["30|09|2026"]]));

            const configured = await createTestEditor([Essentials, Paragraph, Table, TableSort],
                { autoSort: { dateFormats: ["DD|MM|YYYY"] } });
            setModelData(configured.model, modelTable(rows));
            configured.execute(ASCENDING);
            expect(tableData(configured)).toBe(modelTable([["30|09|2026"], ["01|10|2026"]]));
        });
    });
});

function cellTextOf(cell: ModelElement): string {
    const paragraph = cell.getChild(0);
    const text = paragraph?.is("element") ? paragraph.getChild(0) : null;
    return text?.is("$text") ? text.data : "";
}
