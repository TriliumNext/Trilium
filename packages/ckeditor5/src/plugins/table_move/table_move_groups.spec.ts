import { _setModelData as setModelData, Essentials, Paragraph, Table } from "ckeditor5";
import type { ClassicEditor, ModelElement } from "ckeditor5";
import { beforeEach, describe, expect, it } from "vitest";

import { createTestEditor } from "../../../test/editor-kit.js";
import { modelTable } from "../../../test/table-kit.js";
import { adjustedHeadingCount, planGroupMove, splitIntoGroups } from "./table_move_groups.js";

describe("planGroupMove", () => {
    let editor: ClassicEditor;

    beforeEach(async () => {
        editor = await createTestEditor([Essentials, Paragraph, Table]);
    });

    function getTable(markup: string): ModelElement {
        setModelData(editor.model, markup);
        const table = editor.model.document.getRoot()?.getChild(0);
        if (!table?.is("element", "table")) {
            throw new Error("Fixture did not produce a table.");
        }
        return table;
    }

    it("plans single-row moves in a table without merged cells", () => {
        const table = getTable(modelTable([["a"], ["b"], ["c"]]));

        expect(planGroupMove(table, "row", { first: 1, last: 1 }, true))
            .toEqual({ source: { first: 1, last: 1 }, target: { first: 2, last: 2 } });
        expect(planGroupMove(table, "row", { first: 1, last: 1 }, false))
            .toEqual({ source: { first: 1, last: 1 }, target: { first: 0, last: 0 } });
    });

    it("returns null at the table edges", () => {
        const table = getTable(modelTable([["a"], ["b"]]));

        expect(planGroupMove(table, "row", { first: 0, last: 0 }, false)).toBeNull();
        expect(planGroupMove(table, "row", { first: 1, last: 1 }, true)).toBeNull();
    });

    it("expands the source over the rows a merged cell binds together", () => {
        const table = getTable(modelTable([
            ["a", "b"],
            [{ contents: "c", rowspan: 2 }, "d"],
            ["e"],
            ["f", "g"]
        ]));

        expect(planGroupMove(table, "row", { first: 1, last: 1 }, true))
            .toEqual({ source: { first: 1, last: 2 }, target: { first: 3, last: 3 } });
        expect(planGroupMove(table, "row", { first: 2, last: 2 }, false))
            .toEqual({ source: { first: 1, last: 2 }, target: { first: 0, last: 0 } });
    });

    it("expands the target over the rows a merged cell binds together", () => {
        const table = getTable(modelTable([
            ["a", "b"],
            [{ contents: "c", rowspan: 2 }, "d"],
            ["e"],
            ["f", "g"]
        ]));

        expect(planGroupMove(table, "row", { first: 0, last: 0 }, true))
            .toEqual({ source: { first: 0, last: 0 }, target: { first: 1, last: 2 } });
        expect(planGroupMove(table, "row", { first: 3, last: 3 }, false))
            .toEqual({ source: { first: 3, last: 3 }, target: { first: 1, last: 2 } });
    });

    it("returns null when a merged cell spans the whole table", () => {
        const table = getTable(modelTable([
            [{ contents: "a", rowspan: 2 }, "b"],
            ["c"]
        ]));

        expect(planGroupMove(table, "row", { first: 0, last: 0 }, true)).toBeNull();
        expect(planGroupMove(table, "row", { first: 1, last: 1 }, false)).toBeNull();
    });

    it("plans column moves around a colspan group", () => {
        const table = getTable(modelTable([
            ["a", { contents: "b", colspan: 2 }, "d"],
            ["e", "f", "g", "h"]
        ]));

        expect(planGroupMove(table, "column", { first: 1, last: 1 }, true))
            .toEqual({ source: { first: 1, last: 2 }, target: { first: 3, last: 3 } });
        expect(planGroupMove(table, "column", { first: 0, last: 0 }, true))
            .toEqual({ source: { first: 0, last: 0 }, target: { first: 1, last: 2 } });
        expect(planGroupMove(table, "column", { first: 0, last: 0 }, false)).toBeNull();
        expect(planGroupMove(table, "column", { first: 3, last: 3 }, true)).toBeNull();
    });

    it("expands a multi-group selection to cover every touched group", () => {
        const table = getTable(modelTable([
            ["a", "b"],
            [{ contents: "c", rowspan: 2 }, "d"],
            ["e"],
            ["f", "g"]
        ]));

        expect(planGroupMove(table, "row", { first: 0, last: 1 }, true))
            .toEqual({ source: { first: 0, last: 2 }, target: { first: 3, last: 3 } });
    });
});

describe("adjustedHeadingCount", () => {
    it("keeps a zero heading count", () => {
        const plan = { source: { first: 0, last: 0 }, target: { first: 1, last: 1 } };
        expect(adjustedHeadingCount(0, plan, true)).toBe(0);
    });

    it("drops heading status from rows moved below the heading band", () => {
        const plan = { source: { first: 0, last: 0 }, target: { first: 1, last: 1 } };
        expect(adjustedHeadingCount(1, plan, true)).toBe(0);
    });

    it("grants heading status to rows moved into the heading band", () => {
        const plan = { source: { first: 1, last: 1 }, target: { first: 0, last: 0 } };
        expect(adjustedHeadingCount(1, plan, false)).toBe(2);
    });

    it("keeps the count for moves inside the heading band", () => {
        const plan = { source: { first: 0, last: 0 }, target: { first: 1, last: 1 } };
        expect(adjustedHeadingCount(2, plan, true)).toBe(2);
    });

    it("keeps the count for moves inside the body", () => {
        expect(adjustedHeadingCount(
            1, { source: { first: 1, last: 1 }, target: { first: 2, last: 2 } }, true
        )).toBe(1);
        expect(adjustedHeadingCount(
            1, { source: { first: 2, last: 2 }, target: { first: 1, last: 1 } }, false
        )).toBe(1);
    });

    it("counts only the heading part of a source that straddles the band boundary", () => {
        const down = { source: { first: 1, last: 2 }, target: { first: 3, last: 3 } };
        expect(adjustedHeadingCount(2, down, true)).toBe(1);

        const up = { source: { first: 1, last: 2 }, target: { first: 0, last: 0 } };
        expect(adjustedHeadingCount(1, up, false)).toBe(3);
    });
});

describe("splitIntoGroups", () => {
    let editor: ClassicEditor;

    beforeEach(async () => {
        editor = await createTestEditor([Essentials, Paragraph, Table]);
    });

    function getTable(markup: string): ModelElement {
        setModelData(editor.model, markup);
        const table = editor.model.document.getRoot()?.getChild(0);
        if (!table?.is("element", "table")) {
            throw new Error("Fixture did not produce a table.");
        }
        return table;
    }

    it("puts every row of a table without merged cells in a group of its own", () => {
        const table = getTable(modelTable([["a"], ["b"], ["c"]]));
        expect(splitIntoGroups(table, "row", { first: 0, last: 2 }))
            .toEqual([{ first: 0, last: 0 }, { first: 1, last: 1 }, { first: 2, last: 2 }]);
        expect(splitIntoGroups(table, "row", { first: 1, last: 1 }))
            .toEqual([{ first: 1, last: 1 }]);
    });

    it("keeps the rows of a merged cell together and widens the range to them", () => {
        const table = getTable(modelTable([
            [{ contents: "a", rowspan: 2 }, "b"],
            ["c"],
            ["d", "e"]
        ]));
        const expected = [{ first: 0, last: 1 }, { first: 2, last: 2 }];
        expect(splitIntoGroups(table, "row", { first: 0, last: 2 })).toEqual(expected);
        expect(splitIntoGroups(table, "row", { first: 1, last: 2 })).toEqual(expected);
        expect(splitIntoGroups(table, "row", { first: 2, last: 2 }))
            .toEqual([{ first: 2, last: 2 }]);
    });

    it("groups columns the same way", () => {
        const table = getTable(modelTable([
            [{ contents: "a", colspan: 2 }, "b"],
            ["c", "d", "e"]
        ]));
        expect(splitIntoGroups(table, "column", { first: 0, last: 2 }))
            .toEqual([{ first: 0, last: 1 }, { first: 2, last: 2 }]);
    });
});
