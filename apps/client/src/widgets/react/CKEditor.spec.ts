import { describe, expect, it } from "vitest";

import { groupQuoteLinesIntoParagraphs } from "./CKEditor.js";

describe("groupQuoteLinesIntoParagraphs", () => {
    it("keeps contiguous lines in a single paragraph", () => {
        expect(groupQuoteLinesIntoParagraphs(["a", "b", "c"])).toEqual([["a", "b", "c"]]);
    });

    it("starts a new paragraph at a blank line", () => {
        expect(groupQuoteLinesIntoParagraphs(["a", "", "b"])).toEqual([["a"], ["b"]]);
    });

    it("collapses consecutive blank lines into a single paragraph break", () => {
        expect(groupQuoteLinesIntoParagraphs(["a", "", "", "b"])).toEqual([["a"], ["b"]]);
    });

    it("ignores leading and trailing blank lines", () => {
        expect(groupQuoteLinesIntoParagraphs(["", "a", "b", ""])).toEqual([["a", "b"]]);
    });

    it("returns no paragraphs for an all-blank quote", () => {
        expect(groupQuoteLinesIntoParagraphs([])).toEqual([]);
        expect(groupQuoteLinesIntoParagraphs(["", ""])).toEqual([]);
    });
});
