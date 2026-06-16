import { describe, expect, it, vi } from "vitest";

import type { Froca } from "../services/froca-interface.js";
import FBranch, { type FBranchRow } from "./fbranch.js";

describe("FBranch", () => {
    it("delegates getNote/getNoteFromCache/getParentNote to froca", async () => {
        const note = { noteId: "child" };
        const parentNote = { noteId: "parent" };
        const getNote = vi.fn(async (id: string) => (id === "parent" ? parentNote : note));
        const getNoteFromCache = vi.fn(() => note);
        const froca = { getNote, getNoteFromCache } as unknown as Froca;
        const branch = new FBranch(froca, buildRow());

        await expect(branch.getNote()).resolves.toBe(note);
        expect(getNote).toHaveBeenCalledWith("child");

        expect(branch.getNoteFromCache()).toBe(note);
        expect(getNoteFromCache).toHaveBeenCalledWith("child");

        await expect(branch.getParentNote()).resolves.toBe(parentNote);
        expect(getNote).toHaveBeenCalledWith("parent");
    });

    it("isTopLevel reflects whether parent is root", () => {
        const froca = makeFroca();
        expect(new FBranch(froca, buildRow({ parentNoteId: "root" })).isTopLevel()).toBe(true);
        expect(new FBranch(froca, buildRow({ parentNoteId: "parent" })).isTopLevel()).toBe(false);
    });

    it("toString getter contains the branchId", () => {
        const branch = new FBranch(makeFroca(), buildRow({ branchId: "br-99" }));
        expect(branch.toString).toContain("br-99");
        expect(typeof branch.toString).toBe("string");
    });

    it("pojo getter returns a plain object without the froca property", () => {
        const branch = new FBranch(makeFroca(), buildRow({ branchId: "br-pojo" }));
        const pojo = branch.pojo as Record<string, unknown>;

        expect("froca" in pojo).toBe(false);
        expect(pojo.branchId).toBe("br-pojo");
        expect(pojo.noteId).toBe("child");
    });

    it("update coerces isExpanded/fromSearchNote to booleans", () => {
        const branch = new FBranch(makeFroca(), buildRow());
        branch.update(buildRow({ isExpanded: 1 as unknown as boolean, fromSearchNote: 0 as unknown as boolean }));

        expect(branch.isExpanded).toBe(true);
        expect(branch.fromSearchNote).toBe(false);
        expect(branch.prefix).toBeUndefined();
    });
});

function makeFroca() {
    const note = { noteId: "n" };
    return {
        getNote: vi.fn(async () => note),
        getNoteFromCache: vi.fn(() => note)
    } as unknown as Froca;
}

function buildRow(overrides: Partial<FBranchRow> = {}): FBranchRow {
    return {
        branchId: "br-1",
        noteId: "child",
        parentNoteId: "parent",
        notePosition: 10,
        fromSearchNote: false,
        ...overrides
    };
}
