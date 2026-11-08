import { describe, expect, it } from "vitest";

import { resolveViewType } from "./interface";

describe("resolveViewType", () => {
    it("defaults a saved search to the search preview and a collection to the grid", () => {
        expect(resolveViewType({ type: "search" }, undefined)).toBe("searchPreview");
        expect(resolveViewType({ type: "book" }, undefined)).toBe("grid");
    });

    it("keeps an explicit view type, including a list on a saved search", () => {
        expect(resolveViewType({ type: "search" }, "list")).toBe("list");
        expect(resolveViewType({ type: "search" }, "searchPreview")).toBe("searchPreview");
        expect(resolveViewType({ type: "book" }, "list")).toBe("list");
    });

    it("falls back when the search preview is set on a note that is not a saved search", () => {
        expect(resolveViewType({ type: "book" }, "searchPreview")).toBe("grid");
    });

    it("ignores a label naming no view type, and answers nothing without a note", () => {
        expect(resolveViewType({ type: "book" }, "bogus")).toBe("grid");
        expect(resolveViewType(null, "list")).toBeUndefined();
    });
});
