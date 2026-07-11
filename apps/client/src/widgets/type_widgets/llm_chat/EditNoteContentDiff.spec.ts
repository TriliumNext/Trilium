import { describe, expect, it } from "vitest";

import { diffLines, isSmallEdit, parseNoteContentEdits } from "./EditNoteContentDiff.js";

describe("diffLines", () => {
    it("marks a replaced line as remove then add, keeping surrounding context", () => {
        const diff = diffLines(
            "const a = 1;\nconst b = 2;\nconst c = 3;",
            "const a = 1;\nconst b = 20;\nconst c = 3;"
        );
        expect(diff).toEqual([
            { type: "context", text: "const a = 1;" },
            { type: "remove", text: "const b = 2;" },
            { type: "add", text: "const b = 20;" },
            { type: "context", text: "const c = 3;" }
        ]);
    });

    it("treats pure insertions and deletions correctly", () => {
        expect(diffLines("line", "line\nextra")).toEqual([
            { type: "context", text: "line" },
            { type: "add", text: "extra" }
        ]);
        expect(diffLines("line\nextra", "line")).toEqual([
            { type: "context", text: "line" },
            { type: "remove", text: "extra" }
        ]);
    });

    it("returns all context when the texts are identical", () => {
        expect(diffLines("a\nb", "a\nb")).toEqual([
            { type: "context", text: "a" },
            { type: "context", text: "b" }
        ]);
    });
});

describe("isSmallEdit", () => {
    it("treats a few changed lines as small", () => {
        expect(isSmallEdit([{ oldText: "a\nb\nc", newText: "a\nB\nc" }])).toBe(true);
    });

    it("treats a large rewrite as not small", () => {
        const oldText = Array.from({ length: 20 }, (_, i) => `old ${i}`).join("\n");
        const newText = Array.from({ length: 20 }, (_, i) => `new ${i}`).join("\n");
        expect(isSmallEdit([{ oldText, newText }])).toBe(false);
    });

    it("sums changed lines across multiple edits", () => {
        const edit = { oldText: "x", newText: "y" };
        expect(isSmallEdit(Array.from({ length: 4 }, () => edit))).toBe(true);
        expect(isSmallEdit(Array.from({ length: 6 }, () => edit))).toBe(false);
    });
});

describe("parseNoteContentEdits", () => {
    it("accepts a well-formed edits array", () => {
        expect(parseNoteContentEdits([{ oldText: "a", newText: "b" }])).toEqual([
            { oldText: "a", newText: "b" }
        ]);
    });

    it("rejects empty, non-array, or malformed input", () => {
        expect(parseNoteContentEdits([])).toBeNull();
        expect(parseNoteContentEdits(undefined)).toBeNull();
        expect(parseNoteContentEdits("nope")).toBeNull();
        expect(parseNoteContentEdits([{ oldText: "a" }])).toBeNull();
        expect(parseNoteContentEdits([{ oldText: 1, newText: 2 }])).toBeNull();
    });
});
