import { beforeEach, describe, expect, it, vi } from "vitest";

import { buildNote } from "../test/easy-froca";
import froca from "./froca";
import server from "./server.js";
import ws from "./ws.js";

// ---- Mocks for non-froca collaborators --------------------------------------
// All mock state lives in a hoisted holder so the (hoisted) vi.mock factories
// can safely reference it.
const h = vi.hoisted(() => {
    const tabManager = {
        activeNoteType: "text" as string | null,
        activeContext: null as any,
        getActiveContextNoteType: () => tabManager.activeNoteType,
        getActiveContext: () => tabManager.activeContext
    };
    return {
        tabManager,
        protectedAvailable: { value: false },
        triggerEvent: vi.fn(),
        triggerCommand: vi.fn(),
        showMessage: vi.fn()
    };
});
const { tabManager, protectedAvailable, triggerEvent, triggerCommand, showMessage } = h;

vi.mock("../components/app_context.js", () => ({
    default: {
        tabManager: h.tabManager,
        triggerEvent: (...args: unknown[]) => h.triggerEvent(...args),
        triggerCommand: (...args: unknown[]) => h.triggerCommand(...args)
    }
}));

vi.mock("./protected_session_holder.js", () => ({
    default: {
        isProtectedSessionAvailable: () => h.protectedAvailable.value
    }
}));

vi.mock("./tree.js", () => ({
    default: {
        // parentNotePath here is what we pass in; strip query, take last segment
        getNoteIdFromUrl: (url?: string) => (url ? url.split("?")[0].split("/").pop() : null)
    }
}));

vi.mock("./toast.js", () => ({
    default: {
        showMessage: (...args: unknown[]) => h.showMessage(...args)
    }
}));

// i18n returns the key so we can assert on structure, never on translated text
vi.mock("./i18n.js", () => ({
    t: (key: string, opts?: Record<string, unknown>) => `${key}:${JSON.stringify(opts ?? {})}`
}));

import noteCreateService from "./note_create.js";

// Build a real note + parent branch in froca so getNote/getBranch resolve.
const parentNote = buildNote({
    title: "Parent",
    children: [{ title: "Child" }]
});
const childBranchId = parentNote.children[0];
const childNote = froca.getNoteFromCache(childBranchId)!;
const NOTE_ID = childNote.noteId;
const BRANCH_ID = `${parentNote.noteId}_${NOTE_ID}`;

function setActiveContext(activate = true) {
    const setNote = vi.fn(async () => {});
    tabManager.activeContext = activate ? { ntxId: "ntx-1", setNote } : null;
    return setNote;
}

beforeEach(() => {
    vi.clearAllMocks();
    tabManager.activeNoteType = "text";
    protectedAvailable.value = false;
    ws.waitForMaxKnownEntityChangeId = vi.fn(async () => {});
    server.post = vi.fn(async () => ({
        note: { noteId: NOTE_ID },
        branch: { branchId: BRANCH_ID }
    })) as typeof server.post;
});

describe("createNote", () => {
    it("posts with merged defaults, activates and focuses the title, returns froca entities", async () => {
        const setNote = setActiveContext(true);

        const result = await noteCreateService.createNote("root", { title: "Hello" }, "comp-1");

        // URL reflects default target=into and empty targetBranchId; parentNoteId from tree mock
        // parentNoteId comes from the last path segment via the tree mock
        expect(server.post).toHaveBeenCalledWith(
            `notes/root/children?target=into&targetBranchId=`,
            expect.objectContaining({ title: "Hello", content: "", isProtected: false }),
            "comp-1"
        );
        expect(setNote).toHaveBeenCalledWith(`root/${NOTE_ID}`, { keepActiveDialog: false });
        expect(triggerEvent).toHaveBeenCalledWith("focusAndSelectTitle", { isNewNote: true, ntxId: "ntx-1" });
        expect(result.note).toBe(childNote);
        expect(result.branch).toBe(froca.getBranch(BRANCH_ID));
    });

    it("activates in the supplied noteContext (popup) and keeps the dialog open", async () => {
        // The tab manager's active context must remain untouched (background tab)
        const activeSetNote = setActiveContext(true);
        const popupSetNote = vi.fn(async () => {});
        const popupContext = { ntxId: "ntx-popup", setNote: popupSetNote } as any;

        await noteCreateService.createNote("root", { noteContext: popupContext });

        expect(popupSetNote).toHaveBeenCalledWith(`root/${NOTE_ID}`, { keepActiveDialog: true });
        expect(activeSetNote).not.toHaveBeenCalled();
        expect(triggerEvent).toHaveBeenCalledWith("focusAndSelectTitle", { isNewNote: true, ntxId: "ntx-popup" });
    });

    it("focuses content when focus=content", async () => {
        setActiveContext(true);
        await noteCreateService.createNote("root", { focus: "content" });
        expect(triggerEvent).toHaveBeenCalledWith("focusOnDetail", { ntxId: "ntx-1" });
        expect(triggerEvent).not.toHaveBeenCalledWith("focusAndSelectTitle", expect.anything());
    });

    it("activates without firing a focus event when focus is neither title nor content", async () => {
        const setNote = setActiveContext(true);
        // an out-of-range focus value still activates the note but triggers no focus event
        await noteCreateService.createNote("root", { focus: undefined as any });
        expect(setNote).toHaveBeenCalledWith(`root/${NOTE_ID}`, { keepActiveDialog: false });
        expect(triggerEvent).not.toHaveBeenCalled();
    });

    it("does not activate when activate=false, and skips activation when there is no active context", async () => {
        // activate=false with a context present
        const setNote = setActiveContext(true);
        await noteCreateService.createNote("root", { activate: false });
        expect(setNote).not.toHaveBeenCalled();
        expect(triggerEvent).not.toHaveBeenCalled();

        // no active context at all
        setActiveContext(false);
        await noteCreateService.createNote("root", { activate: true });
        expect(triggerEvent).not.toHaveBeenCalled();
    });

    it("keeps isProtected only when requested AND session is available", async () => {
        setActiveContext(true);

        // requested but session unavailable -> forced to false
        protectedAvailable.value = false;
        await noteCreateService.createNote("root", { isProtected: true });
        expect(server.post).toHaveBeenLastCalledWith(
            expect.any(String),
            expect.objectContaining({ isProtected: false }),
            undefined
        );

        // requested and session available -> stays true
        protectedAvailable.value = true;
        await noteCreateService.createNote("root", { isProtected: true });
        expect(server.post).toHaveBeenLastCalledWith(
            expect.any(String),
            expect.objectContaining({ isProtected: true }),
            undefined
        );
    });

    it("parses a heading selection into title/content and removes the selection (text context)", async () => {
        setActiveContext(true);
        const removeSelection = vi.fn();
        const textEditor = {
            getSelectedHtml: () => "<h2>My Heading</h2><p>body</p>",
            removeSelection
        } as any;

        await noteCreateService.createNote("root", {
            saveSelection: true,
            textEditor
        });

        expect(server.post).toHaveBeenCalledWith(
            expect.any(String),
            expect.objectContaining({ title: "My Heading", content: "<p>body</p>" }),
            undefined
        );
        expect(removeSelection).toHaveBeenCalled();
    });

    it("treats a non-heading selection as content with no title", async () => {
        setActiveContext(true);
        const textEditor = {
            getSelectedHtml: () => "<p>just a paragraph</p>",
            removeSelection: vi.fn()
        } as any;

        await noteCreateService.createNote("root", { saveSelection: true, textEditor });

        expect(server.post).toHaveBeenCalledWith(
            expect.any(String),
            expect.objectContaining({ title: null, content: "<p>just a paragraph</p>" }),
            undefined
        );
    });

    it("disables saveSelection when the active context note type is not text", async () => {
        setActiveContext(true);
        tabManager.activeNoteType = "code";
        const removeSelection = vi.fn();
        const textEditor = {
            getSelectedHtml: vi.fn(() => "<h1>x</h1>"),
            removeSelection
        } as any;

        await noteCreateService.createNote("root", { saveSelection: true, textEditor });

        // selection parsing was skipped, so getSelectedHtml/removeSelection untouched
        expect(textEditor.getSelectedHtml).not.toHaveBeenCalled();
        expect(removeSelection).not.toHaveBeenCalled();
    });

    it("honors an explicit target and targetBranchId in the URL", async () => {
        setActiveContext(true);
        await noteCreateService.createNote("root", { target: "after", targetBranchId: "tb-9" });
        expect(server.post).toHaveBeenCalledWith(
            `notes/root/children?target=after&targetBranchId=tb-9`,
            expect.anything(),
            undefined
        );
    });
});

describe("createNoteWithTypePrompt", () => {
    it("returns undefined and posts nothing when the chooser is cancelled", async () => {
        triggerCommand.mockImplementation((_name: string, data: any) => {
            data.callback({ success: false });
        });

        const result = await noteCreateService.createNoteWithTypePrompt("root", {});
        expect(result).toBeUndefined();
        expect(server.post).not.toHaveBeenCalled();
        expect(triggerCommand).toHaveBeenCalledWith("chooseNoteType", expect.anything());
    });

    it("creates a note with chosen type/template, preferring the chooser notePath", async () => {
        setActiveContext(true);
        triggerCommand.mockImplementation((_name: string, data: any) => {
            data.callback({
                success: true,
                noteType: "code",
                templateNoteId: "tpl-1",
                notePath: "chosen-parent"
            });
        });

        await noteCreateService.createNoteWithTypePrompt("fallback-parent", {});

        expect(server.post).toHaveBeenCalledWith(
            `notes/chosen-parent/children?target=into&targetBranchId=`,
            expect.objectContaining({ type: "code", templateNoteId: "tpl-1" }),
            undefined
        );
    });

    it("falls back to the passed parentNotePath when the chooser returns none", async () => {
        setActiveContext(true);
        triggerCommand.mockImplementation((_name: string, data: any) => {
            data.callback({ success: true, noteType: "text" });
        });

        await noteCreateService.createNoteWithTypePrompt("fallback-parent", {});

        expect(server.post).toHaveBeenCalledWith(
            `notes/fallback-parent/children?target=into&targetBranchId=`,
            expect.anything(),
            undefined
        );
    });
});

describe("chooseNoteType", () => {
    it("resolves with whatever the chooser callback is invoked with", async () => {
        const payload = { success: true, noteType: "render" };
        triggerCommand.mockImplementation((_name: string, data: any) => data.callback(payload));
        await expect(noteCreateService.chooseNoteType()).resolves.toEqual(payload);
    });
});

describe("duplicateSubtree", () => {
    it("posts the duplicate, activates the new note when a context exists, and toasts the original title", async () => {
        const setNote = setActiveContext(true);
        server.post = vi.fn(async () => ({ note: { noteId: NOTE_ID } })) as typeof server.post;

        await noteCreateService.duplicateSubtree(NOTE_ID, "root");

        expect(server.post).toHaveBeenCalledWith(`notes/${NOTE_ID}/duplicate/root`);
        expect(setNote).toHaveBeenCalledWith(`root/${NOTE_ID}`);
        expect(showMessage).toHaveBeenCalledWith(expect.stringContaining("note_create.duplicated"));
    });

    it("does not throw when there is no active context", async () => {
        setActiveContext(false);
        server.post = vi.fn(async () => ({ note: { noteId: NOTE_ID } })) as typeof server.post;

        await expect(noteCreateService.duplicateSubtree(NOTE_ID, "root")).resolves.toBeUndefined();
        expect(showMessage).toHaveBeenCalled();
    });
});
