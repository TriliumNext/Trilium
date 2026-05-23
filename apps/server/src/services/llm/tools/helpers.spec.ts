import { describe, expect, it } from "vitest";

import { applyTextEdits } from "./helpers.js";

describe("applyTextEdits", () => {
    it("applies a single find-and-replace edit", () => {
        const result = applyTextEdits("const x = 1;\nconst y = 2;\n", [
            { oldText: "const x = 1;", newText: "const x = 42;" }
        ]);
        expect(result).toEqual({ ok: true, content: "const x = 42;\nconst y = 2;\n" });
    });

    it("applies multiple edits in order, including one that targets earlier output", () => {
        const result = applyTextEdits("a\nb\nc\n", [
            { oldText: "a", newText: "X" },
            { oldText: "b", newText: "Y" },
            // Edit 3 matches text introduced by edit 1 — edits see prior results.
            { oldText: "X", newText: "Z" }
        ]);
        expect(result).toEqual({ ok: true, content: "Z\nY\nc\n" });
    });

    it("rejects an edit whose oldText is absent", () => {
        const result = applyTextEdits("hello world", [{ oldText: "goodbye", newText: "hi" }]);
        expect(result).toMatchObject({ ok: false, error: expect.stringContaining("not found") });
    });

    it("rejects an ambiguous oldText that matches more than once", () => {
        const result = applyTextEdits("foo foo", [{ oldText: "foo", newText: "bar" }]);
        expect(result).toMatchObject({ ok: false, error: expect.stringContaining("not unique") });
    });

    it("rejects empty and no-op edits", () => {
        expect(applyTextEdits("abc", [{ oldText: "", newText: "x" }]))
            .toMatchObject({ ok: false, error: expect.stringContaining("empty") });
        expect(applyTextEdits("abc", [{ oldText: "abc", newText: "abc" }]))
            .toMatchObject({ ok: false, error: expect.stringContaining("identical") });
    });

    it("is all-or-nothing: a later failing edit discards earlier ones and names the offender", () => {
        const result = applyTextEdits("keep this", [
            { oldText: "keep", newText: "KEEP" },
            { oldText: "missing", newText: "x" }
        ]);
        // The error pinpoints the failing edit, and no content is returned to commit —
        // so a partially-applied batch can never reach the note.
        expect(result).toMatchObject({ ok: false, error: expect.stringContaining("edit 2 of 2") });
        expect(result).not.toHaveProperty("content");
    });
});
