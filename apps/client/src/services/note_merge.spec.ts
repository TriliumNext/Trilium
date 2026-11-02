import { afterEach, describe, expect, it, vi } from "vitest";

import appContext from "../components/app_context";
import dialog from "./dialog";
import froca from "./froca";
import server from "./server";
import * as spacedUpdate from "./spaced_update";
import toast from "./toast";
import {
    armMergeSelection, canMergeNote, distinctNoteIds, isMergeUndoAttachment, mergeNoteFrom,
    mergeNotes, peekMergeSelection, planSelectionAfterMerge, setMergeResult, takeMergeSelection,
    undoMerge, type MergeTreeNode
} from "./note_merge";

const target: MergeTreeNode = { branchId: "root_target", noteId: "target" };
const source: MergeTreeNode = { branchId: "root_source", noteId: "source" };
const other: MergeTreeNode = { branchId: "root_other", noteId: "other" };

describe("planSelectionAfterMerge", () => {
    it("keeps the selected note when the merge did not consume it", () => {
        const plan = planSelectionAfterMerge([ target, other ], target, "target", [ "source" ]);
        expect(plan).toEqual({
            branchIds: [ "root_target", "root_other" ],
            selectTarget: false,
            activeNoteId: "target"
        });
    });

    it("selects the note that remains when the selected note was merged away", () => {
        const plan = planSelectionAfterMerge([ source ], source, "target", [ "source" ]);
        expect(plan).toEqual({
            branchIds: [],
            selectTarget: true,
            activeNoteId: "target"
        });
    });

    it("keeps the other selected notes and adds the note that remains", () => {
        const plan = planSelectionAfterMerge(
            [ source, other ], source, "target", [ "source" ]
        );
        expect(plan).toEqual({
            branchIds: [ "root_other" ],
            selectTarget: true,
            activeNoteId: "target"
        });
    });

    it("uses the open note when nothing in the tree is multi-selected", () => {
        const plan = planSelectionAfterMerge([], other, "target", [ "source" ]);
        expect(plan.activeNoteId).toBe("other");
        expect(plan.branchIds).toEqual([ "root_other" ]);
        expect(plan.selectTarget).toBe(false);
    });

    it("drops an empty row and does not select the same branch twice", () => {
        const plan = planSelectionAfterMerge(
            [ { branchId: "blank", noteId: "" }, other, { branchId: "root_other", noteId: "other" } ],
            null, "target", [ "source" ]
        );
        expect(plan).toEqual({
            branchIds: [ "root_other" ],
            selectTarget: false,
            activeNoteId: "target"
        });
    });

    it("keeps the open note when a different selected note was merged away", () => {
        const plan = planSelectionAfterMerge([ source, target ], other, "target", [ "source" ]);
        expect(plan.branchIds).toEqual([ "root_target" ]);
        expect(plan.selectTarget).toBe(false);
        expect(plan.activeNoteId).toBe("other");
    });

    it("selects the note that remains when the tree had no selection", () => {
        const plan = planSelectionAfterMerge([], null, "target", [ "source" ]);
        expect(plan).toEqual({
            branchIds: [],
            selectTarget: true,
            activeNoteId: "target"
        });
    });
});

describe("canMergeNote", () => {
    it("accepts an ordinary note and refuses the root, system notes, search and launchers", () => {
        expect(canMergeNote({ noteId: "note", type: "text" })).toBe(true);
        expect(canMergeNote({ noteId: "root", type: "text" })).toBe(false);
        expect(canMergeNote({ noteId: "_help", type: "text" })).toBe(false);
        expect(canMergeNote({ noteId: "note", type: "search" })).toBe(false);
        expect(canMergeNote({ noteId: "note", type: "launcher" })).toBe(false);
    });
});

describe("isMergeUndoAttachment", () => {
    it("recognises the two history records and nothing else", () => {
        expect(isMergeUndoAttachment({ role: "mergeUndo" })).toBe(true);
        expect(isMergeUndoAttachment({ role: "mergeUndoBlob" })).toBe(true);
        expect(isMergeUndoAttachment({ role: "file" })).toBe(false);
    });
});

describe("distinctNoteIds", () => {
    it("keeps the first occurrence of each id", () => {
        expect(distinctNoteIds([ "a", "b", "a", "b" ])).toEqual([ "a", "b" ]);
        expect(distinctNoteIds([])).toEqual([]);
    });
});

describe("the selection remembered across the request", () => {
    afterEach(() => {
        takeMergeSelection();
    });

    it("records the new note once the request has named it, and then hands the record over", () => {
        expect(peekMergeSelection()).toBeNull();
        setMergeResult("merged");
        expect(peekMergeSelection()).toBeNull();

        armMergeSelection({
            selected: [],
            active: null,
            consumedNoteIds: [ "source" ],
            resultNoteId: null,
            deletionsSeen: false
        });
        expect(peekMergeSelection()?.resultNoteId).toBeNull();
        setMergeResult("merged");
        expect(peekMergeSelection()?.resultNoteId).toBe("merged");
        expect(takeMergeSelection()?.consumedNoteIds).toEqual([ "source" ]);
        expect(takeMergeSelection()).toBeNull();
    });
});

describe("mergeNotes", () => {
    const tree = appContext.noteTreeWidget;
    const tabs = appContext.tabManager;

    afterEach(() => {
        appContext.noteTreeWidget = tree;
        appContext.tabManager = tabs;
        takeMergeSelection();
        vi.restoreAllMocks();
    });

    function note(noteId: string, title = noteId) {
        return { noteId, type: "text", title };
    }

    it("asks which note to merge when only one is selected", async () => {
        const chooseNote = vi.spyOn(dialog, "chooseNote").mockResolvedValue(null);
        vi.spyOn(froca, "getNote").mockResolvedValue(note("only") as never);

        await mergeNotes([]);
        expect(chooseNote).not.toHaveBeenCalled();

        await mergeNotes([ "" ]);
        expect(chooseNote).not.toHaveBeenCalled();

        await mergeNotes([ "only", "only" ]);
        expect(chooseNote).toHaveBeenCalledOnce();
    });

    it("stops when the chosen note is missing, the same note, or not one that can be merged", async () => {
        const showError = vi.spyOn(toast, "showError").mockImplementation(() => {});
        const getNote = vi.spyOn(froca, "getNote");
        const chooseNote = vi.spyOn(dialog, "chooseNote");

        getNote.mockResolvedValue(null);
        await mergeNoteFrom("gone");
        expect(chooseNote).not.toHaveBeenCalled();

        getNote.mockResolvedValue({ noteId: "root", type: "text", title: "Root" } as never);
        await mergeNoteFrom("root");
        expect(chooseNote).not.toHaveBeenCalled();

        getNote.mockResolvedValue(note("only") as never);
        chooseNote.mockResolvedValue(null);
        await mergeNoteFrom("only");
        expect(showError).not.toHaveBeenCalled();

        chooseNote.mockResolvedValue("only");
        await mergeNoteFrom("only");
        expect(showError).toHaveBeenCalledOnce();

        showError.mockClear();
        chooseNote.mockResolvedValue("missing");
        getNote.mockImplementation(async (noteId: string) => (
            noteId === "only" ? note("only") as never : null
        ));
        await mergeNoteFrom("only");
        expect(showError).toHaveBeenCalledOnce();
    });

    it("stops when a selected note is missing, the title is cancelled, or the title is blank", async () => {
        const showError = vi.spyOn(toast, "showError").mockImplementation(() => {});
        const post = vi.spyOn(server, "post");
        vi.spyOn(froca, "getNotes").mockResolvedValue([ note("a") ] as never);
        await mergeNotes([ "a", "b" ]);
        expect(showError).toHaveBeenCalledOnce();

        vi.mocked(froca.getNotes).mockResolvedValue([] as never);
        showError.mockClear();
        await mergeNotes([ "a", "b" ]);
        expect(showError).toHaveBeenCalledOnce();

        vi.mocked(froca.getNotes).mockResolvedValue([ note("a", "Alpha"), note("b", "Beta") ] as never);
        const prompt = vi.spyOn(dialog, "prompt").mockResolvedValue(null);
        showError.mockClear();
        await mergeNotes([ "a", "b" ]);
        expect(showError).not.toHaveBeenCalled();
        expect(post).not.toHaveBeenCalled();

        prompt.mockResolvedValue("   ");
        await mergeNotes([ "a", "b" ]);
        expect(showError).toHaveBeenCalledOnce();
        expect(post).not.toHaveBeenCalled();
    });

    it("posts the merge, then lets the tree correct the selection", async () => {
        const showMessage = vi.spyOn(toast, "showMessage").mockImplementation(() => {});
        vi.spyOn(froca, "getNotes").mockResolvedValue([
            note("a", "Alpha"), note("b", "Beta")
        ] as never);
        vi.spyOn(dialog, "prompt").mockResolvedValue("  Combined  ");
        const flush = vi.spyOn(spacedUpdate, "flushPendingNoteSaves").mockResolvedValue();
        const post = vi.spyOn(server, "post").mockResolvedValue({ noteId: "merged" });
        const apply = vi.fn(async () => {});
        appContext.noteTreeWidget = {
            getActiveNode: () => ({ data: { noteId: "b", branchId: "root_b" } }),
            getSelectedNodes: () => [
                { data: { noteId: "b", branchId: "root_b" } },
                { data: { noteId: 12, branchId: "ignored" } }
            ],
            applyPendingMergeSelection: apply
        } as unknown as typeof appContext.noteTreeWidget;
        appContext.tabManager = {
            getActiveContext: () => ({ note: { noteId: "open" } })
        } as unknown as typeof appContext.tabManager;

        await mergeNotes([ "a", "b" ]);

        expect(flush).toHaveBeenCalledWith([ "a", "b" ]);
        expect(post).toHaveBeenCalledWith("notes/a/merge", {
            sourceNoteIds: [ "b" ],
            title: "Combined"
        });
        expect(showMessage).toHaveBeenCalledOnce();
        expect(apply).toHaveBeenCalledOnce();
        expect(peekMergeSelection()?.resultNoteId).toBe("merged");
    });

    it("opens the merged note itself when the layout has no tree", async () => {
        vi.spyOn(toast, "showMessage").mockImplementation(() => {});
        vi.spyOn(froca, "getNote").mockResolvedValue(note("only", "Only") as never);
        vi.spyOn(dialog, "chooseNote").mockResolvedValue("other");
        vi.spyOn(froca, "getNote").mockImplementation(async (noteId: string) => (
            note(noteId, noteId === "only" ? "Only" : "Other") as never
        ));
        vi.spyOn(server, "post").mockResolvedValue({ noteId: "merged" });
        const setNote = vi.fn(async () => {});
        appContext.noteTreeWidget = undefined;
        appContext.tabManager = {
            getActiveContext: () => ({ note: { noteId: "open" }, setNote })
        } as unknown as typeof appContext.tabManager;

        await mergeNoteFrom("only");
        expect(setNote).toHaveBeenCalledWith("merged");
        expect(peekMergeSelection()).toBeNull();

        setNote.mockClear();
        vi.mocked(server.post).mockResolvedValue({ noteId: "open" });
        appContext.tabManager = {
            getActiveContext: () => ({ note: { noteId: "open" }, setNote })
        } as unknown as typeof appContext.tabManager;
        await mergeNoteFrom("only");
        expect(setNote).not.toHaveBeenCalled();

        appContext.tabManager = {
            getActiveContext: () => undefined
        } as unknown as typeof appContext.tabManager;
        await mergeNoteFrom("only");
        expect(setNote).not.toHaveBeenCalled();
    });

    it("uses the open note when the tree has no active row", async () => {
        vi.spyOn(toast, "showMessage").mockImplementation(() => {});
        vi.spyOn(froca, "getNotes").mockResolvedValue([ note("a"), note("b") ] as never);
        vi.spyOn(dialog, "prompt").mockResolvedValue("Combined");
        vi.spyOn(server, "post").mockResolvedValue({ noteId: "merged" });
        const apply = vi.fn(async () => {});
        appContext.noteTreeWidget = {
            getActiveNode: () => undefined,
            getSelectedNodes: () => [ { data: {} } ],
            applyPendingMergeSelection: apply
        } as unknown as typeof appContext.noteTreeWidget;
        appContext.tabManager = {
            getActiveContext: () => ({ note: { noteId: "open" } })
        } as unknown as typeof appContext.tabManager;

        await mergeNotes([ "a", "b" ]);
        expect(peekMergeSelection()?.active).toEqual({ branchId: "", noteId: "open" });
        expect(peekMergeSelection()?.selected).toEqual([]);
    });

    it("forgets the selection when the merge is refused", async () => {
        vi.spyOn(toast, "showMessage").mockImplementation(() => {});
        vi.spyOn(froca, "getNotes").mockResolvedValue([ note("a"), note("b") ] as never);
        vi.spyOn(dialog, "prompt").mockResolvedValue("Combined");
        vi.spyOn(server, "post").mockRejectedValue(new Error("no"));
        appContext.noteTreeWidget = {
            getActiveNode: () => null,
            getSelectedNodes: () => [],
            applyPendingMergeSelection: vi.fn()
        } as unknown as typeof appContext.noteTreeWidget;
        appContext.tabManager = {
            getActiveContext: () => undefined
        } as unknown as typeof appContext.tabManager;

        await mergeNotes([ "a", "b" ]);
        expect(peekMergeSelection()).toBeNull();
        expect(toast.showMessage).not.toHaveBeenCalled();
    });
});

describe("undoMerge", () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("restores the newest note, or the one that was asked for", async () => {
        const showMessage = vi.spyOn(toast, "showMessage").mockImplementation(() => {});
        const post = vi.spyOn(server, "post").mockResolvedValue({});

        await undoMerge("merged");
        expect(post).toHaveBeenCalledWith("notes/merged/merge-undo", {});
        expect(showMessage).toHaveBeenCalledOnce();

        await undoMerge("merged", "entry");
        expect(post).toHaveBeenLastCalledWith("notes/merged/merge-undo", { entryId: "entry" });
    });

    it("stays quiet when the restore is refused", async () => {
        const showMessage = vi.spyOn(toast, "showMessage").mockImplementation(() => {});
        vi.spyOn(server, "post").mockRejectedValue(new Error("expired"));

        await undoMerge("merged", "entry");
        expect(showMessage).not.toHaveBeenCalled();
    });
});
