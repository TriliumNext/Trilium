import { beforeEach, describe, expect, it, vi } from "vitest";

// tree.ts subscribes a single ws message handler at import time (for the "openNote" message).
// We capture that callback through a hoisted ws mock so we can drive it directly. We keep the
// froca-relevant ws surface (waitForMaxKnownEntityChangeId) intact, and install the bare global
// `logError` that froca.ts / tree.ts rely on (normally set by the real ws.ts as a side effect).
const { wsCallbacks, logErrorMock } = vi.hoisted(() => ({
    wsCallbacks: [] as ((message: any) => void)[],
    logErrorMock: vi.fn()
}));

vi.mock("./ws.js", () => {
    (window as any).logError = logErrorMock;
    const subscribeToMessages = (cb: (message: any) => void) => {
        wsCallbacks.push(cb);
    };
    return {
        default: {
            subscribeToMessages,
            waitForMaxKnownEntityChangeId: async () => {},
            logError: logErrorMock
        },
        subscribeToMessages,
        logError: logErrorMock
    };
});

import appContext from "../components/app_context.js";
import { buildNote } from "../test/easy-froca.js";
import froca from "./froca.js";
import hoistedNoteService from "./hoisted_note.js";
import treeService, { NOTE_PATH_TITLE_SEPARATOR } from "./tree.js";

/** A minimal Fancytree-node-like stub usable by the node-based helpers. */
function fakeNode(noteId: string | undefined, parent: any = null, isProtected = false): any {
    return {
        data: { noteId, isProtected },
        getParent: () => parent
    };
}

/** Ensure a "root" note exists in froca and wire the given note as its direct child. */
async function wireUnderRoot(note: { noteId: string; addParent: (p: string, b: string, s?: boolean) => void }) {
    const root = froca.notes["root"] ?? buildNote({ id: "root", title: "Root" });
    const branchId = `root_${note.noteId}`;
    const { default: FBranch } = await import("../entities/fbranch.js");
    froca.branches[branchId] = new FBranch(froca, {
        branchId,
        noteId: note.noteId,
        parentNoteId: "root",
        notePosition: 0,
        fromSearchNote: false
    } as any);
    (root as any).addChild(note.noteId, branchId, false);
    note.addParent("root", branchId, false);
    return root;
}

describe("ws openNote subscriber", () => {
    it("activates/opens the note and shows the window on an openNote message", () => {
        expect(wsCallbacks.length).toBeGreaterThan(0);
        const activateOrOpenNote = vi.fn();
        const showWindow = vi.fn();
        appContext.tabManager = { activateOrOpenNote } as any;
        (window as any).electronApi = { window: { showWindow } };

        for (const cb of wsCallbacks) {
            cb({ type: "openNote", noteId: "abc123" });
        }
        expect(activateOrOpenNote).toHaveBeenCalledWith("abc123");
        expect(showWindow).toHaveBeenCalled();
    });

    it("ignores unrelated message types and tolerates a missing electronApi", () => {
        const activateOrOpenNote = vi.fn();
        appContext.tabManager = { activateOrOpenNote } as any;
        (window as any).electronApi = undefined;

        for (const cb of wsCallbacks) {
            cb({ type: "somethingElse", noteId: "abc123" });
        }
        expect(activateOrOpenNote).not.toHaveBeenCalled();
    });
});

describe("getNoteIdFromUrl", () => {
    it("returns null for empty/nullish input", () => {
        expect(treeService.getNoteIdFromUrl(null)).toBeNull();
        expect(treeService.getNoteIdFromUrl(undefined)).toBeNull();
        expect(treeService.getNoteIdFromUrl("")).toBeNull();
    });

    it("returns the last path segment, ignoring a query suffix", () => {
        expect(treeService.getNoteIdFromUrl("root/a/b?foo=bar")).toBe("b");
        expect(treeService.getNoteIdFromUrl("solo")).toBe("solo");
    });
});

describe("getNoteIdAndParentIdFromUrl", () => {
    it("returns an empty object for empty input", () => {
        expect(treeService.getNoteIdAndParentIdFromUrl("")).toEqual({});
    });

    it("maps the special 'root' path to root/none", () => {
        expect(treeService.getNoteIdAndParentIdFromUrl("root")).toEqual({ noteId: "root", parentNoteId: "none" });
    });

    it("derives note and parent from a multi-segment path, stripping a query suffix", () => {
        expect(treeService.getNoteIdAndParentIdFromUrl("root/aaa/bbb?x=1")).toEqual({
            noteId: "bbb",
            parentNoteId: "aaa"
        });
    });

    it("defaults parent to root for a single-segment path", () => {
        expect(treeService.getNoteIdAndParentIdFromUrl("ccc")).toEqual({
            noteId: "ccc",
            parentNoteId: "root"
        });
    });

    it("leaves note/parent at their defaults when the path is empty after stripping params", () => {
        // urlOrNotePath is truthy but notePath (the part before "?") is empty -> inner `if (notePath)` is false.
        expect(treeService.getNoteIdAndParentIdFromUrl("?onlyparams")).toEqual({
            noteId: "",
            parentNoteId: "root"
        });
    });
});

describe("getBranchIdFromUrl", () => {
    beforeEach(() => vi.clearAllMocks());

    it("returns null when there is no resolvable parent", async () => {
        // "root" maps to parentNoteId "none" which is falsy after the guard? -> parentNoteId is "none" (truthy)
        // use a single-segment non-root path with no parent in cache instead
        expect(await treeService.getBranchIdFromUrl("")).toBeNull();
    });

    it("delegates to froca.getBranchId when a parent is present", async () => {
        const spy = vi.spyOn(froca, "getBranchId").mockResolvedValue("branch-xyz");
        const result = await treeService.getBranchIdFromUrl("root/parentX/childY");
        expect(spy).toHaveBeenCalledWith("parentX", "childY");
        expect(result).toBe("branch-xyz");
        spy.mockRestore();
    });
});

describe("getParentProtectedStatus", () => {
    it("returns false for a hoisted node", () => {
        hoistedNoteService.isHoistedNode = vi.fn(() => true);
        expect(treeService.getParentProtectedStatus(fakeNode("n1"))).toBe(false);
    });

    it("returns the parent's protected flag for a non-hoisted node", () => {
        hoistedNoteService.isHoistedNode = vi.fn(() => false);
        const parent = fakeNode("p1", null, true);
        expect(treeService.getParentProtectedStatus(fakeNode("n1", parent))).toBe(true);
    });
});

describe("getNotePath", () => {
    beforeEach(() => vi.clearAllMocks());

    it("logs and returns empty string for a null node", () => {
        expect(treeService.getNotePath(null as any)).toBe("");
        expect(logErrorMock).toHaveBeenCalledWith("Node is null");
    });

    it("walks ancestors and skips nodes without a noteId", () => {
        const root = fakeNode("root");
        const middle = fakeNode(undefined, root); // skipped (no noteId)
        const leaf = fakeNode("leaf", middle);
        expect(treeService.getNotePath(leaf)).toBe("root/leaf");
    });
});

describe("getNoteTitle", () => {
    it("returns a placeholder when the note is missing", async () => {
        const spy = vi.spyOn(froca, "getNote").mockResolvedValue(null as any);
        expect(await treeService.getNoteTitle("does-not-exist")).toBe("[not found]");
        spy.mockRestore();
    });

    it("returns the plain title when no parent is given", async () => {
        const note = buildNote({ title: "Plain title" });
        expect(await treeService.getNoteTitle(note.noteId)).toBe("Plain title");
    });

    it("prefixes the title with the branch prefix when one exists", async () => {
        const parent = buildNote({ title: "Parent", children: [{ title: "Child" }] });
        const child = froca.getNoteFromCache(parent.children[0])!;
        const branchId = child.parentToBranch[parent.noteId];
        froca.branches[branchId].prefix = "PFX";
        expect(await treeService.getNoteTitle(child.noteId, parent.noteId)).toBe("PFX - Child");
    });

    it("returns the unprefixed title when the branch has no prefix", async () => {
        const parent = buildNote({ title: "Parent2", children: [{ title: "Child2" }] });
        const child = froca.getNoteFromCache(parent.children[0])!;
        expect(await treeService.getNoteTitle(child.noteId, parent.noteId)).toBe("Child2");
    });

    it("returns the title when the parent has no branch to the note", async () => {
        const note = buildNote({ title: "NoBranch" });
        expect(await treeService.getNoteTitle(note.noteId, "unrelated-parent")).toBe("NoBranch");
    });
});

describe("getNotePathTitleComponents / getNotePathTitle / getNoteTitleWithPathAsSuffix", () => {
    it("returns just the root title for the 'root' path", async () => {
        buildNote({ id: "root", title: "RootTitle" });
        expect(await treeService.getNotePathTitleComponents("root")).toEqual(["RootTitle"]);
    });

    it("strips a leading 'root/' and builds a component per segment", async () => {
        buildNote({ id: "root", title: "RootTitle" });
        const a = buildNote({ title: "Alpha" });
        const b = buildNote({ title: "Beta" });
        const components = await treeService.getNotePathTitleComponents(`root/${a.noteId}/${b.noteId}`);
        expect(components).toEqual(["Alpha", "Beta"]);

        const joined = await treeService.getNotePathTitle(`root/${a.noteId}/${b.noteId}`);
        expect(joined).toBe(["Alpha", "Beta"].join(NOTE_PATH_TITLE_SEPARATOR));
    });

    it("builds a span with the last component as title and the rest as path", async () => {
        const a = buildNote({ title: "Alpha2" });
        const b = buildNote({ title: "Beta2" });
        const $result = await treeService.getNoteTitleWithPathAsSuffix(`${a.noteId}/${b.noteId}`) as JQuery<HTMLElement>;
        expect($result.hasClass("note-title-with-path")).toBe(true);
        expect($result.find(".note-title").text()).toBe("Beta2");
        // path portion contains the leading title ("Alpha2")
        expect($result.find(".note-path").text()).toContain("Alpha2");
    });

    // The empty-components guard inside getNoteTitleWithPathAsSuffix is unreachable through the
    // public API: getNotePathTitleComponents always pushes at least one component (the loop runs
    // for "" via split("/") -> [""]), and the internal call is to the local function (not the
    // exported one, so it cannot be stubbed). It is annotated with a v8-ignore in the source.
});

describe("formatNotePath", () => {
    it("returns an empty span for an empty path", () => {
        const $result = treeService.formatNotePath([]);
        expect($result.hasClass("note-path")).toBe(true);
        expect($result.find(".path-bracket").length).toBe(0);
    });

    it("renders brackets, segments and delimiters for a multi-segment path", () => {
        const $result = treeService.formatNotePath(["one", "two", "three"]);
        expect($result.find(".path-bracket").length).toBe(2);
        expect($result.find(".path-delimiter").length).toBe(2); // one fewer than segments
        expect($result.text()).toContain("one");
        expect($result.text()).toContain("three");
    });

    it("renders no delimiter for a single-segment path", () => {
        const $result = treeService.formatNotePath(["only"]);
        expect($result.find(".path-delimiter").length).toBe(0);
    });
});

describe("isNotePathInHiddenSubtree", () => {
    it("detects the hidden subtree prefix", () => {
        expect(treeService.isNotePathInHiddenSubtree("root/_hidden/x")).toBe(true);
        expect(treeService.isNotePathInHiddenSubtree("root/abc")).toBe(false);
        expect(treeService.isNotePathInHiddenSubtree(undefined as any)).toBeFalsy();
    });
});

describe("resolveNotePath / resolveNotePathToSegments", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        appContext.tabManager = { getActiveContextNotePath: () => null } as any;
    });

    it("returns null for an empty path (after stripping a query suffix)", async () => {
        expect(await treeService.resolveNotePathToSegments("?onlyparams")).toBeNull();
        expect(await treeService.resolveNotePath("")).toBeNull();
    });

    it("resolves a valid root-anchored path to its segments and joined form", async () => {
        const child = buildNote({ title: "ChildA" });
        await wireUnderRoot(child);

        const path = `root/${child.noteId}`;
        expect(await treeService.resolveNotePathToSegments(path)).toEqual(["root", child.noteId]);
        expect(await treeService.resolveNotePath(path)).toBe(path);
    });

    it("logs and returns null when an intermediate child note is missing", async () => {
        // The inner getNote(childNoteId) resolves to null -> "Can't find note" branch.
        const spy = vi.spyOn(froca, "getNote").mockResolvedValue(null as any);
        const result = await treeService.resolveNotePathToSegments("missingParent/missingChild");
        expect(result).toBeNull();
        expect(logErrorMock).toHaveBeenCalled();
        spy.mockRestore();
    });

    it("returns null silently when child is missing and logErrors is false", async () => {
        const spy = vi.spyOn(froca, "getNote").mockResolvedValue(null as any);
        const result = await treeService.resolveNotePathToSegments("mp2/mc2", "root", false);
        expect(result).toBeNull();
        expect(logErrorMock).not.toHaveBeenCalled();
        spy.mockRestore();
    });

    it("returns null when the child note has no parents (logErrors=true)", async () => {
        const orphan = buildNote({ title: "Orphan" });
        // path "root/orphan": iterating, childNoteId becomes "orphan" with no parents
        const result = await treeService.resolveNotePathToSegments(`root/${orphan.noteId}`);
        expect(result).toBeNull();
        expect(logErrorMock).toHaveBeenCalled();
    });

    it("returns null when the child note has no parents (logErrors=false, no logging)", async () => {
        const orphan = buildNote({ title: "Orphan2" });
        const result = await treeService.resolveNotePathToSegments(`root/${orphan.noteId}`, "root", false);
        expect(result).toBeNull();
        expect(logErrorMock).not.toHaveBeenCalled();
    });

    it("falls back to the best note path when the requested (cached) parent doesn't match", async () => {
        // note really lives under root; we request a wrong parent that DOES exist in froca,
        // exercising the `parent ? parent.title : "n/a"` truthy branch in the debug log.
        const note = buildNote({ title: "Target" });
        await wireUnderRoot(note);
        const wrongParent = buildNote({ title: "WrongButReal" });

        const result = await treeService.resolveNotePathToSegments(`${wrongParent.noteId}/${note.noteId}`);
        expect(result).toEqual(["root", note.noteId]);
    });

    it("logs 'n/a' when the mismatched parent is not present in the cache", async () => {
        // note lives under root; we request a parent id that is NOT in froca,
        // exercising the `parent ? parent.title : "n/a"` falsy branch in the debug log.
        const note = buildNote({ title: "Target2" });
        await wireUnderRoot(note);

        const result = await treeService.resolveNotePathToSegments(`not-in-cache/${note.noteId}`);
        expect(result).toEqual(["root", note.noteId]);
    });

    it("skips the best-path extension when the mismatched child has no best path (logErrors=false)", async () => {
        // child whose only parent is NOT root and has no route to root -> getBestNotePath() is falsy,
        // so the mismatch block breaks without pushing extra segments. The else branch then also finds
        // no path for the note and throws. This covers the logErrors=false + falsy-bestNotePath branches.
        const lonelyParent = buildNote({ title: "LonelyParent" });
        const child = buildNote({ title: "DeadEndChild" });
        const branchId = `${lonelyParent.noteId}_${child.noteId}`;
        const { default: FBranch } = await import("../entities/fbranch.js");
        froca.branches[branchId] = new FBranch(froca, {
            branchId,
            noteId: child.noteId,
            parentNoteId: lonelyParent.noteId,
            notePosition: 0,
            fromSearchNote: false
        } as any);
        lonelyParent.addChild(child.noteId, branchId, false);
        child.addParent(lonelyParent.noteId, branchId, false);

        await expect(
            treeService.resolveNotePathToSegments(`wrongP/${child.noteId}`, "root", false)
        ).rejects.toThrow();
        expect(logErrorMock).not.toHaveBeenCalled();
    });
});

describe("resolveNotePathToSegments error/else branches", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        appContext.tabManager = { getActiveContextNotePath: () => null } as any;
    });

    it("throws when no path segments are found for the note (else branch, no best path)", async () => {
        // single existing note whose only parent is NOT root and NOT the hoisted id.
        const note = buildNote({ title: "Lonely" });
        await expect(
            treeService.resolveNotePathToSegments(note.noteId, "hoist-XYZ")
        ).rejects.toThrow();
    });

    it("throws in the else branch when the note cannot be found from the URL", async () => {
        // A single-segment path so the loop pushes one (non-root) segment -> else branch.
        // froca.getNote(noteId) resolves to null -> line-103 throw.
        const spy = vi.spyOn(froca, "getNote").mockResolvedValue(null as any);
        await expect(treeService.resolveNotePathToSegments("loneNoteId")).rejects.toThrow(
            /Unable to find note/
        );
        spy.mockRestore();
    });

    it("returns the best note path in the else branch when it includes the hoisted note", async () => {
        const note = buildNote({ title: "ElseTarget" });
        await wireUnderRoot(note);

        // A single-segment path equal to the note id: loop runs once, no childNoteId comparison,
        // effectivePathSegments=[noteId] which does NOT include "root" -> else branch.
        // hoistedNoteId default "root"; bestNotePath = ["root", noteId] which includes "root".
        const result = await treeService.resolveNotePathToSegments(note.noteId);
        expect(result).toEqual(["root", note.noteId]);
    });

    it("falls back to the original segments in the else branch when the best path lacks the hoisted note", async () => {
        const note = buildNote({ title: "ElseTarget2" });
        await wireUnderRoot(note);

        // hoistedNoteId not on any path -> bestNotePath (["root", noteId]) does not include it,
        // so the ternary returns the originally-resolved effectivePathSegments ([noteId]).
        const result = await treeService.resolveNotePathToSegments(note.noteId, "hoist-NOPE");
        expect(result).toEqual([note.noteId]);
    });
});
