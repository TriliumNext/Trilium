import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { buildNote } from "../test/easy-froca";
import branchService from "./branches.js";
import clipboard from "./clipboard.js";
import froca from "./froca.js";
import linkService from "./link.js";
import toastService from "./toast.js";
import utils from "./utils.js";
import * as ws from "./ws.js";

// `throwError` is a named export of ws.js that the global setup mock does not provide.
// Supply a throwing implementation so the "unrecognized clipboard mode" branch behaves like production.
(ws as any).throwError = vi.fn((message: string) => {
    throw new Error(message);
});

// froca.ts references a global `logError` (normally installed by the real ws.ts, which is mocked here).
// Provide a no-op so looking up an unknown branch id doesn't blow up.
(globalThis as any).logError = (globalThis as any).logError ?? (() => {});

branchService.moveAfterBranch = vi.fn(async () => {}) as typeof branchService.moveAfterBranch;
branchService.moveToParentNote = vi.fn(async () => {}) as typeof branchService.moveToParentNote;
branchService.cloneNoteAfter = vi.fn(async () => {}) as typeof branchService.cloneNoteAfter;
branchService.cloneNoteToBranch = vi.fn(async () => {}) as typeof branchService.cloneNoteToBranch;
toastService.showMessage = vi.fn() as typeof toastService.showMessage;

/** Build a parent note with a single child and return both notes plus the child's branch id. */
function buildParentWithChild() {
    const parent = buildNote({ title: "Parent", children: [{ title: "Child" }] });
    const childNoteId = parent.children[0];
    const childBranchId = parent.childToBranch[childNoteId];
    return { parent, childBranchId, childNoteId };
}

beforeEach(() => {
    vi.clearAllMocks();
    // Reset module-level clipboard state to a known-empty baseline before each test.
    clipboard.cut([]);
});

describe("cut", () => {
    it("sets cut mode and toasts when given branches; does nothing for an empty list", () => {
        const { childBranchId } = buildParentWithChild();

        clipboard.cut([childBranchId]);
        expect(clipboard.isClipboardEmpty()).toBe(false);
        expect(toastService.showMessage).toHaveBeenCalledTimes(1);

        vi.clearAllMocks();
        clipboard.cut([]);
        expect(clipboard.isClipboardEmpty()).toBe(true);
        expect(toastService.showMessage).not.toHaveBeenCalled();
    });
});

describe("isClipboardEmpty", () => {
    it("filters out branches no longer present in froca", () => {
        const { childBranchId } = buildParentWithChild();

        clipboard.cut([childBranchId, "does-not-exist"]);
        expect(clipboard.isClipboardEmpty()).toBe(false);

        clipboard.cut(["does-not-exist-either"]);
        expect(clipboard.isClipboardEmpty()).toBe(true);
    });
});

describe("copy", () => {
    afterEach(() => {
        delete (window as any).electronApi;
        delete (globalThis as any).ClipboardItem;
    });

    it("sets copy mode and toasts on a non-Electron platform", async () => {
        const { childBranchId } = buildParentWithChild();
        expect(utils.isElectron()).toBe(false);

        await clipboard.copy([childBranchId]);

        expect(clipboard.isClipboardEmpty()).toBe(false);
        expect(toastService.showMessage).toHaveBeenCalledTimes(1);
    });

    it("writes reference links to the system clipboard on Electron", async () => {
        const { parent, childBranchId, childNoteId } = buildParentWithChild();

        (window as any).electronApi = {};
        const writeSpy = vi.fn(async (..._args: any[]) => {});
        // happy-dom exposes `navigator.clipboard` as a getter-only property, so define our own.
        Object.defineProperty(navigator, "clipboard", {
            configurable: true,
            get: () => ({ write: writeSpy })
        });
        (globalThis as any).ClipboardItem = class {
            constructor(public readonly data: Record<string, unknown>) {}
        };

        const link = $("<a>").attr("href", "ref").text("Child link");
        linkService.createLink = vi.fn(async () => link) as typeof linkService.createLink;

        await clipboard.copy([childBranchId]);

        // The link key is `${branch.parentNoteId}/${branch.noteId}` with the reference-link option.
        expect(linkService.createLink).toHaveBeenCalledTimes(1);
        expect(linkService.createLink).toHaveBeenCalledWith(`${parent.noteId}/${childNoteId}`, { referenceLink: true });

        expect(writeSpy).toHaveBeenCalledTimes(1);
        const items = writeSpy.mock.calls[0][0] as any[];
        expect(items).toHaveLength(1);

        // The html slot carries the link's outerHTML; the plain slot carries its text.
        const htmlBlob = items[0].data["text/html"] as Blob;
        const plainBlob = items[0].data["text/plain"] as Blob;
        expect(htmlBlob).toBeInstanceOf(Blob);
        expect(plainBlob).toBeInstanceOf(Blob);
        expect(htmlBlob.type).toBe("text/html");
        expect(plainBlob.type).toBe("text/plain");
        expect(await htmlBlob.text()).toBe(link[0].outerHTML);
        expect(await plainBlob.text()).toBe("Child link");

        expect(toastService.showMessage).toHaveBeenCalledTimes(1);
    });
});

describe("pasteAfter", () => {
    it("returns early when the clipboard is empty", async () => {
        await clipboard.pasteAfter("any-branch");
        expect(branchService.moveAfterBranch).not.toHaveBeenCalled();
        expect(branchService.cloneNoteAfter).not.toHaveBeenCalled();
    });

    it("moves branches and clears the clipboard in cut mode", async () => {
        const { childBranchId } = buildParentWithChild();
        clipboard.cut([childBranchId]);

        await clipboard.pasteAfter("target-branch");

        expect(branchService.moveAfterBranch).toHaveBeenCalledWith([childBranchId], "target-branch");
        // Cut clears the clipboard afterwards.
        expect(clipboard.isClipboardEmpty()).toBe(true);
    });

    it("clones the note and keeps the clipboard in copy mode, skipping branches with no note", async () => {
        const { childBranchId, childNoteId } = buildParentWithChild();
        // A branch whose note resolves to null exercises the `!clipboardNote` continue.
        const orphanBranchId = "orphan-branch";
        froca.branches[orphanBranchId] = {
            branchId: orphanBranchId,
            noteId: "missing-note",
            getNote: async () => null
        } as any;

        // "missing-branch" is dropped by isClipboardEmpty()'s filter before the clone loop runs.
        clipboard.copy([childBranchId, "missing-branch", orphanBranchId]);
        vi.clearAllMocks();

        await clipboard.pasteAfter("target-branch");

        expect(branchService.cloneNoteAfter).toHaveBeenCalledTimes(1);
        expect(branchService.cloneNoteAfter).toHaveBeenCalledWith(childNoteId, "target-branch");
        // Copy keeps the clipboard so it can be pasted again.
        expect(clipboard.isClipboardEmpty()).toBe(false);

        delete froca.branches[orphanBranchId];
    });

});

describe("pasteInto", () => {
    it("returns early when the clipboard is empty", async () => {
        await clipboard.pasteInto("any-branch");
        expect(branchService.moveToParentNote).not.toHaveBeenCalled();
        expect(branchService.cloneNoteToBranch).not.toHaveBeenCalled();
    });

    it("moves branches to the parent and clears the clipboard in cut mode", async () => {
        const { childBranchId } = buildParentWithChild();
        clipboard.cut([childBranchId]);

        await clipboard.pasteInto("parent-branch");

        expect(branchService.moveToParentNote).toHaveBeenCalledWith([childBranchId], "parent-branch");
        expect(clipboard.isClipboardEmpty()).toBe(true);
    });

    it("clones the note into the parent and keeps the clipboard in copy mode, skipping branches with no note", async () => {
        const { childBranchId, childNoteId } = buildParentWithChild();
        const orphanBranchId = "orphan-branch-into";
        froca.branches[orphanBranchId] = {
            branchId: orphanBranchId,
            noteId: "missing-note",
            getNote: async () => null
        } as any;

        clipboard.copy([childBranchId, "missing-branch", orphanBranchId]);
        vi.clearAllMocks();

        await clipboard.pasteInto("parent-branch");

        expect(branchService.cloneNoteToBranch).toHaveBeenCalledTimes(1);
        expect(branchService.cloneNoteToBranch).toHaveBeenCalledWith(childNoteId, "parent-branch");
        expect(clipboard.isClipboardEmpty()).toBe(false);

        delete froca.branches[orphanBranchId];
    });
});
