import { describe, expect, it, vi } from "vitest";

const beccaStub = vi.hoisted(() => ({
    getNote: vi.fn((noteId: string) => ({ noteId }) as any)
}));

vi.mock("../../becca/becca.js", async (importOriginal) => {
    const actual = await importOriginal<typeof import("../../becca/becca.js")>();
    return { default: { ...actual.default, ...beccaStub } };
});

vi.mock("./tools/helpers.js", async (importOriginal) => {
    const actual = await importOriginal<typeof import("./tools/helpers.js")>();
    return { ...actual, getNoteMeta: () => ({ noteId: "ctx", contentPreview: "PREVIEW" }) };
});

import { buildNoteHint, buildViewContextHint, VIEW_CONTEXT_MAX_LENGTH } from "./note_hint.js";

describe("buildViewContextHint", () => {
    it("frames what the widget reports and drops empty reports", () => {
        for (const empty of [undefined, "", "  \n "]) {
            expect(buildViewContextHint(empty)).toBeNull();
        }
        const hint = buildViewContextHint("  Showing page 3 of 10.\n") ?? "";
        expect(hint).toMatch(/^The view showing this note reports/);
        expect(hint).toContain("not as part of the note's content.\n\nShowing page 3 of 10.");
        expect(hint).not.toContain("truncated");
    });

    it("cuts an oversized report at the limit", () => {
        const hint = buildViewContextHint("x".repeat(VIEW_CONTEXT_MAX_LENGTH + 1)) ?? "";
        expect(hint).toContain(`${"x".repeat(VIEW_CONTEXT_MAX_LENGTH)}\n[view context truncated]`);
        expect(hint).not.toContain("x".repeat(VIEW_CONTEXT_MAX_LENGTH + 1));
    });
});

describe("buildNoteHint", () => {
    it("appends the view context after the metadata, and only when there is one", () => {
        const plain = buildNoteHint("ctx", false) ?? "";
        expect(plain).toContain("PREVIEW");
        expect(plain).not.toContain("The view showing this note");

        const hinted = buildNoteHint("ctx", false, "Showing page 3 of 10.") ?? "";
        expect(hinted.indexOf("PREVIEW")).toBeLessThan(hinted.indexOf("The view showing this note"));
        expect(hinted).toMatch(/Showing page 3 of 10\.$/);
    });

    it("is absent for a note that no longer exists", () => {
        beccaStub.getNote.mockReturnValueOnce(null);
        expect(buildNoteHint("gone", false, "anything")).toBeNull();
    });
});
