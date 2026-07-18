import { beforeEach, describe, expect, it, vi } from "vitest";

// branches.ts registers two ws.subscribeToMessages callbacks at import time. branches.ts is loaded
// transitively (via app_context -> main_tree_executors) before any top-level spec code runs, so we
// must capture those subscribers through a hoisted ws mock. We still provide
// waitForMaxKnownEntityChangeId so froca keeps working.
const { wsCallbacks } = vi.hoisted(() => ({ wsCallbacks: [] as ((message: any) => Promise<void>)[] }));

vi.mock("./ws.js", () => {
    const logError = (message: string) => console.error(message);
    const logInfo = (message: string) => console.log(message);
    // ws.ts sets these window globals as a side effect; froca.ts relies on the global logError.
    (window as any).logError = logError;
    (window as any).logInfo = logInfo;
    const subscribeToMessages = (cb: (message: any) => Promise<void>) => {
        wsCallbacks.push(cb);
    };
    return {
        default: {
            subscribeToMessages,
            waitForMaxKnownEntityChangeId: async () => {},
            getMaxKnownEntityChangeSyncId: () => 0,
            logError
        },
        subscribeToMessages,
        logError,
        logInfo,
        throwError: (message: string) => {
            throw new Error(message);
        }
    };
});

/** Dispatch a websocket message to every captured subscriber (branches filters by taskType). */
async function dispatchWs(message: any) {
    for (const cb of wsCallbacks) {
        await cb(message);
    }
}

import appContext from "../components/app_context.js";
import FBranch from "../entities/fbranch.js";
import { buildNote } from "../test/easy-froca.js";
import branches from "./branches.js";
import froca from "./froca.js";
import hoistedNoteService from "./hoisted_note.js";
import server from "./server.js";
import toastService from "./toast.js";
import utils from "./utils.js";

// Seed the "root" note so branches whose parent/target is "root" resolve from the froca cache
// instead of triggering the throwing tree/load POST.
buildNote({ id: "root", title: "root" });

/** Register a branch directly in froca with full control over its ids. */
function makeBranch(branchId: string, noteId: string, parentNoteId = "root") {
    const branch = new FBranch(froca, {
        branchId,
        noteId,
        parentNoteId,
        notePosition: 0,
        fromSearchNote: false
    });
    froca.branches[branchId] = branch;
    return branch;
}

beforeEach(() => {
    vi.clearAllMocks();
    // Reset commonly-overridden collaborators back to safe defaults.
    server.put = vi.fn(async () => ({ success: true, message: "" })) as typeof server.put;
    server.remove = vi.fn(async () => ({})) as typeof server.remove;
    toastService.showError = vi.fn();
    toastService.showPersistent = vi.fn();
    toastService.closePersistent = vi.fn();
    hoistedNoteService.getHoistedNoteId = vi.fn(() => "root");
    appContext.tabManager = { getActiveContext: () => undefined } as any;
});

describe("moveBeforeBranch", () => {
    it("filters root/search branches, moves valid ones and bails on server failure", async () => {
        const targetNote = buildNote({ title: "Target" });
        const beforeBranch = makeBranch("before1", targetNote.noteId);
        const a = makeBranch("a1", buildNote({ title: "A" }).noteId);

        // virt- branches and root/hoisted branches are filtered out before the loop.
        makeBranch("rootBranch", "root");

        await branches.moveBeforeBranch(["virt-x", "rootBranch", "a1"], "before1");
        expect(server.put).toHaveBeenCalledTimes(1);
        expect(server.put).toHaveBeenCalledWith(`branches/a1/move-before/before1`);
        expect(beforeBranch.noteId).toBe(targetNote.noteId);
        expect(a).toBeDefined();

        // server failure -> error toast and early return
        server.put = vi.fn(async () => ({ success: false, message: "nope" })) as typeof server.put;
        await branches.moveBeforeBranch(["a1"], "before1");
        expect(toastService.showError).toHaveBeenCalledWith("nope");
    });

    it("returns early when before-branch is missing", async () => {
        await branches.moveBeforeBranch(["a1"], "does-not-exist");
        expect(server.put).not.toHaveBeenCalled();
    });

    it("rejects moving before root or launch bar config", async () => {
        makeBranch("rootDest", "root");
        await branches.moveBeforeBranch(["a1"], "rootDest");
        expect(toastService.showError).toHaveBeenCalledTimes(1);

        const lbSpy = vi.spyOn(utils, "isLaunchBarConfig").mockReturnValue(true);
        makeBranch("lbDest", "_lbVisibleLaunchers");
        await branches.moveBeforeBranch(["a1"], "lbDest");
        expect(toastService.showError).toHaveBeenCalledTimes(2);
        lbSpy.mockRestore();
    });
});

describe("moveAfterBranch", () => {
    it("moves valid branches in reverse and bails on server failure", async () => {
        const dest = buildNote({ title: "Dest" });
        makeBranch("afterDest", dest.noteId);
        const n1 = buildNote({ title: "N1" });
        const n2 = buildNote({ title: "N2" });
        makeBranch("m1", n1.noteId);
        makeBranch("m2", n2.noteId);

        await branches.moveAfterBranch(["m1", "m2"], "afterDest");
        expect(server.put).toHaveBeenCalledTimes(2);
        // reversed order: m2 first, then m1
        expect((server.put as any).mock.calls[0][0]).toBe("branches/m2/move-after/afterDest");
        expect((server.put as any).mock.calls[1][0]).toBe("branches/m1/move-after/afterDest");

        server.put = vi.fn(async () => ({ success: false, message: "fail" })) as typeof server.put;
        await branches.moveAfterBranch(["m1"], "afterDest");
        expect(toastService.showError).toHaveBeenCalledWith("fail");
    });

    it("returns early when after-note is missing", async () => {
        await branches.moveAfterBranch(["m1"], "missing");
        expect(server.put).not.toHaveBeenCalled();
    });

    it("rejects moving after a forbidden destination note", async () => {
        // dest note id "root" is in the forbidden list
        makeBranch("forbiddenDest", "root");
        await branches.moveAfterBranch(["m1"], "forbiddenDest");
        expect(toastService.showError).toHaveBeenCalledTimes(1);
        expect(server.put).not.toHaveBeenCalled();
    });
});

describe("moveToParentNote", () => {
    it("returns early when new parent branch is missing", async () => {
        await branches.moveToParentNote(["m1"], "no-parent");
        expect(server.put).not.toHaveBeenCalled();
    });

    it("rejects moving into _lbRoot", async () => {
        makeBranch("lbRootBranch", "_lbRoot");
        await branches.moveToParentNote(["m1"], "lbRootBranch");
        expect(toastService.showError).toHaveBeenCalledTimes(1);
        expect(server.put).not.toHaveBeenCalled();
    });

    it("skips missing/hoisted/search-parent branches and moves valid ones", async () => {
        const parentNote = buildNote({ title: "Parent" });
        makeBranch("destParent", parentNote.noteId);

        // a regular note under root
        const regular = buildNote({ title: "Regular" });
        makeBranch("regularBranch", regular.noteId, "root");

        // a note whose parent is a search note -> skipped
        const searchParent = buildNote({ title: "Search", type: "search" });
        const childOfSearch = buildNote({ title: "Child" });
        makeBranch("searchChildBranch", childOfSearch.noteId, searchParent.noteId);

        // a hoisted note branch -> skipped
        hoistedNoteService.getHoistedNoteId = vi.fn(() => regular.noteId === "x" ? "" : "hoistedId");
        const hoisted = buildNote({ id: "hoistedId", title: "Hoisted" });
        makeBranch("hoistedBranch", hoisted.noteId, "root");

        await branches.moveToParentNote(["missingBranch", "hoistedBranch", "searchChildBranch", "regularBranch"], "destParent", "comp-1");

        expect(server.put).toHaveBeenCalledTimes(1);
        expect(server.put).toHaveBeenCalledWith("branches/regularBranch/move-to/destParent", undefined, "comp-1");
    });

    it("shows error and bails when the move fails", async () => {
        const parentNote = buildNote({ title: "Parent2" });
        makeBranch("destParent2", parentNote.noteId);
        const regular = buildNote({ title: "Regular2" });
        makeBranch("regularBranch2", regular.noteId, "root");

        server.put = vi.fn(async () => ({ success: false, message: "boom" })) as typeof server.put;
        await branches.moveToParentNote(["regularBranch2"], "destParent2");
        expect(toastService.showError).toHaveBeenCalledWith("boom");
    });
});

describe("deleteNotes", () => {
    it("returns false when nothing remains after filtering root notes", async () => {
        makeBranch("onlyRoot", "root");
        const result = await branches.deleteNotes(["onlyRoot"]);
        expect(result).toBe(false);
    });

    it("returns false when the user cancels the dialog", async () => {
        const note = buildNote({ title: "Del" });
        makeBranch("delBranch", note.noteId, "root");
        appContext.triggerCommand = vi.fn((_name: any, data: any) => {
            data.callback({ proceed: false });
        }) as any;
        const result = await branches.deleteNotes(["delBranch"]);
        expect(result).toBe(false);
    });

    it("deletes a single branch, navigates to parent, and returns true", async () => {
        const note = buildNote({ title: "Del2" });
        makeBranch("delBranch2", note.noteId, "root");
        const note2 = buildNote({ title: "Del2b" });
        makeBranch("delBranch2b", note2.noteId, "root");

        const setNote = vi.fn(async () => {});
        appContext.tabManager = {
            getActiveContext: () => ({ notePathArray: ["root", note.noteId], setNote })
        } as any;
        appContext.triggerCommand = vi.fn((_name: any, data: any) => {
            data.callback({ proceed: true, deleteAllClones: false, eraseNotes: false });
        }) as any;

        // Two branches -> first iteration has last=false, second has last=true.
        const result = await branches.deleteNotes(["delBranch2", "delBranch2b"]);
        expect(result).toBe(true);
        expect(server.remove).toHaveBeenCalledTimes(2);
        const firstArg = (server.remove as any).mock.calls[0][0] as string;
        const secondArg = (server.remove as any).mock.calls[1][0] as string;
        expect(firstArg.startsWith(`branches/delBranch2?taskId=`)).toBe(true);
        expect(firstArg).toContain("eraseNotes=false");
        expect(firstArg).toContain("last=false");
        expect(secondArg).toContain("last=true");
        // navigated to the parent path ("root")
        expect(setNote).toHaveBeenCalledWith("root");
    });

    it("deletes all clones (note endpoint), erases & reloads, and tolerates navigation errors", async () => {
        const note = buildNote({ title: "Del3" });
        makeBranch("delBranch3", note.noteId, "root");

        appContext.tabManager = {
            getActiveContext: () => {
                throw new Error("navigation blew up");
            }
        } as any;
        appContext.triggerCommand = vi.fn((_name: any, data: any) => {
            data.callback({ proceed: true, deleteAllClones: true, eraseNotes: true });
        }) as any;
        const reloadSpy = vi.spyOn(utils, "reloadFrontendApp").mockImplementation(() => {});
        const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});

        const result = await branches.deleteNotes(["delBranch3"], false, true, "comp-9");
        expect(result).toBe(true);
        // deleteAllClones -> notes/<noteId> endpoint
        const removeArg = (server.remove as any).mock.calls[0][0] as string;
        expect(removeArg.startsWith(`notes/${note.noteId}?taskId=`)).toBe(true);
        expect(removeArg).toContain("eraseNotes=true");
        expect(reloadSpy).toHaveBeenCalledTimes(1);
        expect(errSpy).toHaveBeenCalled();
        reloadSpy.mockRestore();
        errSpy.mockRestore();
    });

    it("skips parent navigation when moveToParent is false", async () => {
        const note = buildNote({ title: "Del4" });
        makeBranch("delBranch4", note.noteId, "root");
        const getActiveContext = vi.fn(() => undefined);
        appContext.tabManager = { getActiveContext } as any;
        appContext.triggerCommand = vi.fn((_name: any, data: any) => {
            data.callback({ proceed: true, deleteAllClones: false, eraseNotes: false });
        }) as any;

        const result = await branches.deleteNotes(["delBranch4"], false, false);
        expect(result).toBe(true);
        // getActiveContext only used by activateParentNotePath, which is skipped
        expect(getActiveContext).not.toHaveBeenCalled();
    });

    it("handles a deleteAllClones request where the branch is no longer in froca", async () => {
        // filterRootNote keeps non-root ids even if the branch is gone? No: filterRootNote drops
        // unknown branches. So to exercise the `deleteAllClones && !branch` fallback we keep a real
        // branch through filtering, then remove it from froca before the delete loop runs.
        const note = buildNote({ title: "Del5" });
        makeBranch("delBranch5", note.noteId, "root");
        appContext.triggerCommand = vi.fn((_name: any, data: any) => {
            // remove the branch right when the dialog "resolves", before the delete loop reads it
            delete froca.branches["delBranch5"];
            data.callback({ proceed: true, deleteAllClones: true, eraseNotes: false });
        }) as any;

        const result = await branches.deleteNotes(["delBranch5"], false, false);
        expect(result).toBe(true);
        // branch missing -> falls back to deleting the branch id endpoint
        const removeArg = (server.remove as any).mock.calls[0][0] as string;
        expect(removeArg.startsWith("branches/delBranch5?taskId=")).toBe(true);
    });
});

describe("activateParentNotePath (via deleteNotes navigation)", () => {
    it("does not navigate when the deleted note is not on the active path", async () => {
        const note = buildNote({ title: "Off" });
        makeBranch("offBranch", note.noteId, "root");
        const setNote = vi.fn(async () => {});
        appContext.tabManager = {
            getActiveContext: () => ({ notePathArray: ["someOtherNote"], setNote })
        } as any;
        appContext.triggerCommand = vi.fn((_name: any, data: any) => {
            data.callback({ proceed: true, deleteAllClones: false, eraseNotes: false });
        }) as any;

        await branches.deleteNotes(["offBranch"]);
        expect(setNote).not.toHaveBeenCalled();
    });

    it("does not navigate when the deleted note is the path root (no parent path)", async () => {
        const note = buildNote({ title: "Top" });
        makeBranch("topBranch", note.noteId, "root");
        const setNote = vi.fn(async () => {});
        appContext.tabManager = {
            getActiveContext: () => ({ notePathArray: [note.noteId, "child"], setNote })
        } as any;
        appContext.triggerCommand = vi.fn((_name: any, data: any) => {
            data.callback({ proceed: true, deleteAllClones: false, eraseNotes: false });
        }) as any;

        await branches.deleteNotes(["topBranch"]);
        // earliestIndex is 0 -> parentPath is empty -> no setNote
        expect(setNote).not.toHaveBeenCalled();
    });

    it("ignores deleted-then-missing branches and a context without a note path", async () => {
        const noteA = buildNote({ title: "Ancestor" });
        makeBranch("ancBranch", noteA.noteId, "root");
        const setNote = vi.fn(async () => {});
        // Active context exists but has no notePathArray -> the `?? []` fallback is exercised.
        appContext.tabManager = {
            getActiveContext: () => ({ notePathArray: undefined, setNote })
        } as any;
        appContext.triggerCommand = vi.fn((_name: any, data: any) => {
            // Remove the branch after filtering but before navigation, so activateParentNotePath's
            // `froca.getBranch(...)` returns undefined and the `if (branch)` false arm is taken.
            delete froca.branches["ancBranch"];
            data.callback({ proceed: true, deleteAllClones: false, eraseNotes: false });
        }) as any;

        const result = await branches.deleteNotes(["ancBranch"]);
        expect(result).toBe(true);
        // empty note path + missing branch -> no navigation
        expect(setNote).not.toHaveBeenCalled();
    });
});

describe("moveNodeUpInHierarchy", () => {
    function fakeNode(opts: { parentNoteType?: string; parentBranchId?: string; branchId?: string }) {
        const parent: any = {
            data: { noteType: opts.parentNoteType, branchId: opts.parentBranchId },
            getParent: () => null
        };
        return {
            data: { branchId: opts.branchId },
            getParent: () => parent
        } as unknown as Fancytree.FancytreeNode;
    }

    it("returns early for hoisted, top-level or search-parent nodes", async () => {
        // hoisted node
        hoistedNoteService.isHoistedNode = vi.fn(() => true);
        hoistedNoteService.isTopLevelNode = vi.fn(() => false);
        await branches.moveNodeUpInHierarchy(fakeNode({ parentNoteType: "text" }));
        expect(server.put).not.toHaveBeenCalled();

        // top-level node
        hoistedNoteService.isHoistedNode = vi.fn(() => false);
        hoistedNoteService.isTopLevelNode = vi.fn(() => true);
        await branches.moveNodeUpInHierarchy(fakeNode({ parentNoteType: "text" }));
        expect(server.put).not.toHaveBeenCalled();

        // search-parent node
        hoistedNoteService.isTopLevelNode = vi.fn(() => false);
        await branches.moveNodeUpInHierarchy(fakeNode({ parentNoteType: "search" }));
        expect(server.put).not.toHaveBeenCalled();
    });

    it("moves the node after its parent's branch and shows error on failure", async () => {
        hoistedNoteService.isHoistedNode = vi.fn(() => false);
        hoistedNoteService.isTopLevelNode = vi.fn(() => false);

        await branches.moveNodeUpInHierarchy(fakeNode({ parentNoteType: "text", parentBranchId: "pb", branchId: "cb" }));
        expect(server.put).toHaveBeenCalledWith("branches/cb/move-after/pb");

        server.put = vi.fn(async () => ({ success: false, message: "denied" })) as typeof server.put;
        await branches.moveNodeUpInHierarchy(fakeNode({ parentNoteType: "text", parentBranchId: "pb", branchId: "cb" }));
        expect(toastService.showError).toHaveBeenCalledWith("denied");
    });
});

describe("clone helpers", () => {
    it("cloneNoteToBranch calls server and surfaces errors", async () => {
        await branches.cloneNoteToBranch("childN", "parentB", "px");
        expect(server.put).toHaveBeenCalledWith("notes/childN/clone-to-branch/parentB", { prefix: "px" });

        server.put = vi.fn(async () => ({ success: false, message: "e1" })) as typeof server.put;
        await branches.cloneNoteToBranch("childN", "parentB");
        expect(toastService.showError).toHaveBeenCalledWith("e1");
    });

    it("cloneNoteToParentNote calls server and surfaces errors", async () => {
        await branches.cloneNoteToParentNote("childN", "parentN", "py");
        expect(server.put).toHaveBeenCalledWith("notes/childN/clone-to-note/parentN", { prefix: "py" });

        server.put = vi.fn(async () => ({ success: false, message: "e2" })) as typeof server.put;
        await branches.cloneNoteToParentNote("childN", "parentN");
        expect(toastService.showError).toHaveBeenCalledWith("e2");
    });

    it("cloneNoteAfter calls server and surfaces errors", async () => {
        await branches.cloneNoteAfter("noteN", "afterB");
        expect(server.put).toHaveBeenCalledWith("notes/noteN/clone-after/afterB");

        server.put = vi.fn(async () => ({ success: false, message: "e3" })) as typeof server.put;
        await branches.cloneNoteAfter("noteN", "afterB");
        expect(toastService.showError).toHaveBeenCalledWith("e3");
    });
});

describe("ws task-message subscribers", () => {
    it("registered at least the two branch task subscribers at import time", () => {
        // Other modules also subscribe; branches.ts contributes two, identified by their taskType filter.
        expect(wsCallbacks.length).toBeGreaterThanOrEqual(2);
    });

    it("deleteNotes subscriber reacts to error/progress/success and ignores other task types", async () => {
        // Messages without a matching taskType (or without taskType at all) -> ignored by branch subscribers.
        await dispatchWs({ type: "taskProgressCount", taskId: "t", progressCount: 1 });
        await dispatchWs({ taskType: "deleteNotes" }); // matching taskType but no recognized type -> no branch taken
        expect(toastService.showError).not.toHaveBeenCalled();
        expect(toastService.showPersistent).not.toHaveBeenCalled();

        await dispatchWs({ taskType: "deleteNotes", type: "taskError", taskId: "e1", message: "boom" });
        expect(toastService.closePersistent).toHaveBeenCalledWith("e1");
        expect(toastService.showError).toHaveBeenCalledWith("boom");

        await dispatchWs({ taskType: "deleteNotes", type: "taskProgressCount", taskId: "p1", progressCount: 3 });
        expect(toastService.showPersistent).toHaveBeenCalledTimes(1);
        expect((toastService.showPersistent as any).mock.calls[0][0].id).toBe("p1");

        await dispatchWs({ taskType: "deleteNotes", type: "taskSucceeded", taskId: "s1" });
        const succeededToast = (toastService.showPersistent as any).mock.calls[1][0];
        expect(succeededToast.id).toBe("s1");
        expect(succeededToast.timeout).toBe(5000);
        expect(succeededToast.icon).toBe("trash");
    });

    it("undeleteNotes subscriber reacts to error/progress/success and ignores other task types", async () => {
        // undelete message with no recognized type -> falls through every else-if (no toast).
        await dispatchWs({ taskType: "undeleteNotes" });
        expect(toastService.showError).not.toHaveBeenCalled();
        expect(toastService.showPersistent).not.toHaveBeenCalled();

        // a deleteNotes message must NOT be handled by the undelete subscriber as an undelete,
        // but it IS handled by the delete subscriber. Assert the undelete-specific outcome instead.
        await dispatchWs({ taskType: "undeleteNotes", type: "taskError", taskId: "ue1", message: "undel-boom" });
        expect(toastService.closePersistent).toHaveBeenCalledWith("ue1");
        expect(toastService.showError).toHaveBeenCalledWith("undel-boom");

        await dispatchWs({ taskType: "undeleteNotes", type: "taskProgressCount", taskId: "ue2", progressCount: 7 });
        expect(toastService.showPersistent).toHaveBeenCalledTimes(1);
        expect((toastService.showPersistent as any).mock.calls[0][0].id).toBe("ue2");

        await dispatchWs({ taskType: "undeleteNotes", type: "taskSucceeded", taskId: "ue3" });
        const succeededToast = (toastService.showPersistent as any).mock.calls[1][0];
        expect(succeededToast.id).toBe("ue3");
        expect(succeededToast.timeout).toBe(5000);
    });
});
