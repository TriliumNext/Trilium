import { describe, expect, it } from "vitest";

import {
    boardColumnsKey, DEFAULT_BOARD_GROUP_BY, isBoardColumnsKey, normalizeBoardGroupBy
} from "./board_columns.js";

describe("boardColumnsKey", () => {
    it("keeps the default grouping on the key every board used before", () => {
        for (const groupBy of [ DEFAULT_BOARD_GROUP_BY, "#status", " status ", "", "  ", undefined,
                null ]) {
            expect(boardColumnsKey(groupBy), String(groupBy)).toBe("columns");
        }
    });

    it("gives every other label a key of its own", () => {
        expect(boardColumnsKey("priority")).toBe("priorityViewColumns");
        expect(boardColumnsKey("#priority")).toBe("priorityViewColumns");
        expect(boardColumnsKey(" priority ")).toBe("priorityViewColumns");
    });

    it("tells a relation apart from a label of the same name", () => {
        expect(boardColumnsKey("~status")).toBe("~statusViewColumns");
        expect(boardColumnsKey("~assignee")).toBe("~assigneeViewColumns");
        expect(boardColumnsKey("~assignee")).not.toBe(boardColumnsKey("assignee"));
    });
});

describe("normalizeBoardGroupBy", () => {
    it("drops the label prefix and keeps the relation one", () => {
        expect(normalizeBoardGroupBy("#priority")).toBe("priority");
        expect(normalizeBoardGroupBy(" # priority ")).toBe("priority");
        expect(normalizeBoardGroupBy("~assignee")).toBe("~assignee");
        expect(normalizeBoardGroupBy(undefined)).toBe("");
    });
});

describe("isBoardColumnsKey", () => {
    it("recognises a keyed column list and nothing else", () => {
        expect(isBoardColumnsKey("priorityViewColumns")).toBe(true);
        expect(isBoardColumnsKey("~assigneeViewColumns")).toBe(true);
        expect(isBoardColumnsKey("columns")).toBe(false);
        expect(isBoardColumnsKey("ViewColumns")).toBe(false);
        expect(isBoardColumnsKey("templates")).toBe(false);
    });
});
