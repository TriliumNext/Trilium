import { beforeEach, describe, expect, it, vi } from "vitest";

// app_context pulls in a very large module graph; mock it to a tiny tab manager surface.
const activeContextRef: { current: { hoistedNoteId: string; unhoist: () => Promise<void> } | null } = {
    current: null
};
const unhoistSpy = vi.fn(async () => {});

vi.mock("../components/app_context.js", () => ({
    default: {
        tabManager: {
            getActiveContext: () => activeContextRef.current
        }
    }
}));

const resolveNotePath = vi.fn<(notePath: string, hoistedNoteId?: string) => Promise<string | null>>();
const getNoteIdFromUrl = vi.fn<(notePath: string) => string | null>();
vi.mock("./tree.js", () => ({
    default: {
        resolveNotePath: (notePath: string, hoistedNoteId?: string) => resolveNotePath(notePath, hoistedNoteId),
        getNoteIdFromUrl: (notePath: string) => getNoteIdFromUrl(notePath)
    }
}));

const confirm = vi.fn<(message: string) => Promise<boolean>>();
vi.mock("./dialog.js", () => ({
    default: {
        confirm: (message: string) => confirm(message)
    }
}));

import type NoteContext from "../components/note_context.js";
import { buildNote } from "../test/easy-froca";
import hoistedNoteService from "./hoisted_note.js";

function setActiveContext(hoistedNoteId: string | null) {
    if (hoistedNoteId === null) {
        activeContextRef.current = null;
    } else {
        activeContextRef.current = { hoistedNoteId, unhoist: unhoistSpy };
    }
}

/** Minimal Fancytree node stub: only `data.noteId` and `getParent()` are read by the service. */
function fakeNode(noteId: string, parent?: { data: { noteId: string } }): Fancytree.FancytreeNode {
    return {
        data: { noteId },
        getParent: () => parent
    } as unknown as Fancytree.FancytreeNode;
}

describe("hoisted_note service", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        setActiveContext(null);
    });

    describe("getHoistedNoteId", () => {
        it("returns the active context's hoisted note id, or root without an active context", () => {
            setActiveContext("someNote");
            expect(hoistedNoteService.getHoistedNoteId()).toBe("someNote");

            setActiveContext(null);
            expect(hoistedNoteService.getHoistedNoteId()).toBe("root");
        });
    });

    describe("unhoist", () => {
        it("delegates to the active context when present and is a no-op otherwise", async () => {
            setActiveContext("someNote");
            await hoistedNoteService.unhoist();
            expect(unhoistSpy).toHaveBeenCalledTimes(1);

            unhoistSpy.mockClear();
            setActiveContext(null);
            await hoistedNoteService.unhoist();
            expect(unhoistSpy).not.toHaveBeenCalled();
        });
    });

    describe("isHoistedNode / isTopLevelNode", () => {
        it("matches root, matches the hoisted note id, and rejects anything else", () => {
            setActiveContext("hoistedX");

            expect(hoistedNoteService.isHoistedNode(fakeNode("root"))).toBe(true);
            expect(hoistedNoteService.isHoistedNode(fakeNode("hoistedX"))).toBe(true);
            expect(hoistedNoteService.isHoistedNode(fakeNode("other"))).toBe(false);
        });

        it("isTopLevelNode checks the node's parent against the hoisted node", () => {
            setActiveContext("hoistedX");

            const topLevel = fakeNode("child", { data: { noteId: "hoistedX" } });
            const deep = fakeNode("child", { data: { noteId: "other" } });
            expect(hoistedNoteService.isTopLevelNode(topLevel)).toBe(true);
            expect(hoistedNoteService.isTopLevelNode(deep)).toBe(false);
        });
    });

    describe("isHoistedInHiddenSubtree", () => {
        it("returns false when hoisted on root", async () => {
            setActiveContext("root");
            expect(await hoistedNoteService.isHoistedInHiddenSubtree()).toBe(false);
        });

        it("reflects isHiddenCompletely of the hoisted note", async () => {
            // A note cloned directly under root is NOT hidden completely.
            buildNote({ id: "root", title: "Root" });
            const visible = buildNote({ title: "Visible" });
            visible.parents.push("root");
            setActiveContext(visible.noteId);
            expect(await hoistedNoteService.isHoistedInHiddenSubtree()).toBe(false);

            // A note with no visible parent path is hidden completely.
            const orphan = buildNote({ title: "Orphan" });
            setActiveContext(orphan.noteId);
            expect(await hoistedNoteService.isHoistedInHiddenSubtree()).toBe(true);
        });

        it("honours an explicit hoistedNoteId over the active context (e.g. a tree popup)", async () => {
            buildNote({ id: "root", title: "Root" });
            const visible = buildNote({ title: "Visible" });
            visible.parents.push("root");
            const orphan = buildNote({ title: "Orphan" }); // hidden completely

            // Active tab hoisted on a visible note, but the caller (a popup tree) is hoisted into the
            // hidden subtree — the explicit argument must win.
            setActiveContext(visible.noteId);
            expect(await hoistedNoteService.isHoistedInHiddenSubtree(orphan.noteId)).toBe(true);
            expect(await hoistedNoteService.isHoistedInHiddenSubtree("root")).toBe(false);
        });
    });

    describe("checkNoteAccess", () => {
        function ctx(hoistedNoteId: string): NoteContext {
            return { hoistedNoteId } as NoteContext;
        }

        it("returns false when the note path cannot be resolved", async () => {
            resolveNotePath.mockResolvedValue(null);
            expect(await hoistedNoteService.checkNoteAccess("nope", ctx("root"))).toBe(false);
        });

        it("returns true when the resolved path already contains the hoisted note", async () => {
            resolveNotePath.mockResolvedValue("hoistedX/target");
            expect(await hoistedNoteService.checkNoteAccess("p", ctx("hoistedX"))).toBe(true);
            expect(getNoteIdFromUrl).not.toHaveBeenCalled();
            expect(confirm).not.toHaveBeenCalled();
        });

        it("returns true (skips the guard) when the path is inside _hidden but not bookmarks", async () => {
            resolveNotePath.mockResolvedValue("_hidden/something");
            expect(await hoistedNoteService.checkNoteAccess("p", ctx("hoistedX"))).toBe(true);
            expect(confirm).not.toHaveBeenCalled();
        });

        it("returns false when the resolved path yields no note id", async () => {
            resolveNotePath.mockResolvedValue("foo/bar");
            getNoteIdFromUrl.mockReturnValue(null);
            expect(await hoistedNoteService.checkNoteAccess("p", ctx("hoistedX"))).toBe(false);
        });

        it("prompts and unhoists when the hoisted note is not in the hidden subtree", async () => {
            const requested = buildNote({ title: "Requested" });
            // hoisted note cloned only under root -> hasAncestor('_hidden') is false
            const hoisted = buildNote({ title: "Hoisted" });

            resolveNotePath.mockResolvedValue("foo/bar");
            getNoteIdFromUrl.mockReturnValue(requested.noteId);
            confirm.mockResolvedValue(true);
            setActiveContext(hoisted.noteId);

            const result = await hoistedNoteService.checkNoteAccess("p", ctx(hoisted.noteId));
            expect(result).toBe(true);
            expect(confirm).toHaveBeenCalledTimes(1);
            expect(unhoistSpy).toHaveBeenCalledTimes(1);
        });

        it("returns false when the user declines the unhoist confirmation", async () => {
            const requested = buildNote({ title: "Requested" });
            const hoisted = buildNote({ title: "Hoisted" });

            resolveNotePath.mockResolvedValue("foo/bar");
            getNoteIdFromUrl.mockReturnValue(requested.noteId);
            confirm.mockResolvedValue(false);

            const result = await hoistedNoteService.checkNoteAccess("p", ctx(hoisted.noteId));
            expect(result).toBe(false);
            expect(unhoistSpy).not.toHaveBeenCalled();
        });

        it("skips the confirmation when the hoisted note is already inside _hidden", async () => {
            // hoisted note IS under _hidden -> hasAncestor('_hidden') is true, so the
            // inner `!hasAncestor('_hidden')` is false; with a non-bookmark path the
            // OR short-circuits false, the `&&` skips confirm(), and unhoist runs.
            buildNote({ id: "_hidden", title: "Hidden" });
            const hoisted = buildNote({ title: "HoistedHidden" });
            hoisted.parents.push("_hidden");
            const requested = buildNote({ title: "Target" });

            resolveNotePath.mockResolvedValue("foo/bar");
            getNoteIdFromUrl.mockReturnValue(requested.noteId);
            setActiveContext(hoisted.noteId);

            const result = await hoistedNoteService.checkNoteAccess("p", ctx(hoisted.noteId));
            expect(result).toBe(true);
            expect(confirm).not.toHaveBeenCalled();
            expect(unhoistSpy).toHaveBeenCalledTimes(1);
        });

        it("still prompts for a bookmark path even when the hoisted note is inside _hidden", async () => {
            // A bookmark target (`_lbBookmarks`) re-enables the guard on BOTH decision points:
            //  - line 52: the path includes `_hidden` (would normally skip) but the
            //    `|| includes("_lbBookmarks")` clause forces entry into the guard block.
            //  - line 61: the hoisted note IS under `_hidden` (so `!hasAncestor("_hidden")`
            //    is false), but the `|| includes("_lbBookmarks")` clause forces confirm().
            // This is the exact inverse of the previous (non-bookmark) test, which skips confirm.
            buildNote({ id: "_hidden", title: "Hidden" });
            const hoisted = buildNote({ title: "HoistedHidden" });
            hoisted.parents.push("_hidden");
            const requested = buildNote({ title: "Bookmark target" });

            resolveNotePath.mockResolvedValue("_hidden/_lbBookmarks/target");
            getNoteIdFromUrl.mockReturnValue(requested.noteId);
            confirm.mockResolvedValue(false);
            setActiveContext(hoisted.noteId);

            const result = await hoistedNoteService.checkNoteAccess("p", ctx(hoisted.noteId));
            // confirm was declined -> access denied, no unhoist.
            expect(result).toBe(false);
            expect(confirm).toHaveBeenCalledTimes(1);
            expect(unhoistSpy).not.toHaveBeenCalled();
        });

        it("unhoists for a confirmed bookmark path when the hoisted note is inside _hidden", async () => {
            // Same bookmark-path branch as above, but the user confirms: access is granted
            // and unhoist runs, proving the `_lbBookmarks` clause at line 61 reaches confirm()
            // and the post-confirm unhoist on this otherwise-skipped (_hidden) path.
            buildNote({ id: "_hidden", title: "Hidden" });
            const hoisted = buildNote({ title: "HoistedHidden2" });
            hoisted.parents.push("_hidden");
            const requested = buildNote({ title: "Bookmark target 2" });

            resolveNotePath.mockResolvedValue("_hidden/_lbBookmarks/target");
            getNoteIdFromUrl.mockReturnValue(requested.noteId);
            confirm.mockResolvedValue(true);
            setActiveContext(hoisted.noteId);

            const result = await hoistedNoteService.checkNoteAccess("p", ctx(hoisted.noteId));
            expect(result).toBe(true);
            expect(confirm).toHaveBeenCalledTimes(1);
            expect(unhoistSpy).toHaveBeenCalledTimes(1);
        });
    });
});
