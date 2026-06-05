import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// --- Module mocks (hoisted above the component import) --------------------------------------------

// The real bootstrap Modal/Tooltip machinery does not behave under happy-dom; provide inert stubs.
vi.mock("bootstrap", () => {
    class Modal {
        static instances = new Map<Element, Modal>();
        static getOrCreateInstance(el: Element) {
            let inst = Modal.instances.get(el);
            if (!inst) {
                inst = new Modal(el);
                Modal.instances.set(el, inst);
            }
            return inst;
        }
        static getInstance(el: Element) { return Modal.instances.get(el) ?? null; }
        element: Element;
        constructor(el: Element) { this.element = el; }
        show() {}
        hide() {}
        dispose() { Modal.instances.delete(this.element); }
    }
    // hooks.tsx patches Tooltip.prototype.dispose at import time, so it must be present.
    class Tooltip {
        static getInstance() { return null; }
        dispose() {}
        show() {}
        hide() {}
    }
    return { Modal, Tooltip, default: { Modal, Tooltip } };
});

// openDialog resolves with a jQuery-wrapped element; the Modal effect calls `.then(...)` on it.
vi.mock("../../services/dialog", () => ({
    openDialog: vi.fn(async ($el: JQuery<HTMLElement>) => $el)
}));

// note_autocomplete pulls in jQuery autocomplete plugins + a top-level server.get; stub it. Only the
// named `triggerRecentNotes` is imported at runtime by the dialog.
vi.mock("../../services/note_autocomplete", () => ({
    triggerRecentNotes: vi.fn(),
    default: {}
}));

// The real NoteAutocomplete registers jQuery plugin methods that only exist once note_autocomplete.ts
// initialises them. Replace it with a plain input whose onChange callback we can drive from tests.
let autocompleteOnChange: ((s: unknown) => void) | undefined;
vi.mock("../react/NoteAutocomplete", () => ({
    default: ({ inputRef, onChange }: { inputRef?: { current: HTMLInputElement | null }; onChange?: (s: unknown) => void }) => {
        autocompleteOnChange = onChange;
        return (
            <div className="input-group">
                <input ref={inputRef} className="note-autocomplete form-control" />
            </div>
        );
    }
}));

// The shared setup mock for ws only exposes the default export's subscribeToMessages; the dialog
// imports the named `logError`, so provide it here.
vi.mock("../../services/ws", () => ({
    logError: vi.fn(),
    default: { subscribeToMessages: vi.fn() }
}));

vi.mock("../../services/tree", () => ({
    default: {
        getNoteIdAndParentIdFromUrl: vi.fn((notePath: string | null | undefined) => {
            if (!notePath) return {};
            const [path] = notePath.split("?");
            const segments = path.split("/");
            return { noteId: segments[segments.length - 1], parentNoteId: segments[segments.length - 2] ?? "root" };
        })
    }
}));

vi.mock("../../services/branches", () => ({
    default: { cloneNoteToBranch: vi.fn(async () => undefined) }
}));

vi.mock("../../services/toast", () => ({
    default: { showMessage: vi.fn(), showError: vi.fn() }
}));

vi.mock("../../components/app_context", () => ({
    default: {
        tabManager: { getActiveContextNoteId: vi.fn(() => null) },
        triggerCommand: vi.fn()
    }
}));

import appContext from "../../components/app_context";
import Component from "../../components/component";
import branches from "../../services/branches";
import froca from "../../services/froca";
import { triggerRecentNotes } from "../../services/note_autocomplete";
import toast from "../../services/toast";
import tree from "../../services/tree";
import { logError } from "../../services/ws";
import { buildNote } from "../../test/easy-froca";
import { ParentComponent } from "../react/react_utils";
import CloneToDialog from "./clone_to";

// --- Render harness -------------------------------------------------------------------------------

let container: HTMLDivElement | undefined;
let parent: Component | undefined;

function renderDialog() {
    const p = new Component();
    const c = document.createElement("div");
    parent = p;
    container = c;
    document.body.appendChild(c);
    act(() => {
        render(
            <ParentComponent.Provider value={p}>
                <CloneToDialog />
            </ParentComponent.Provider>,
            c
        );
    });
    return c;
}

function dispatch(el: EventTarget | null | undefined, event: Event) {
    if (!el) return;
    act(() => { el.dispatchEvent(event); });
}

function submitForm(root: HTMLElement) {
    dispatch(root.querySelector("form"), new Event("submit", { bubbles: true, cancelable: true }));
}

function fireModalEvent(root: HTMLElement, eventName: string) {
    dispatch(root.querySelector<HTMLElement>(".modal.clone-to-dialog"), new Event(eventName));
}

function fireEvent(name: string, data: unknown) {
    act(() => {
        (parent?.handleEventInChildren as (n: string, d: unknown) => void)(name, data);
    });
}

async function flush() {
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
}

/** Open the dialog by firing the Trilium command the widget subscribes to. */
function openDialog(noteIds: string[] | undefined) {
    fireEvent("cloneNoteIdsTo", { noteIds });
}

function getModal(root: HTMLElement) {
    return root.querySelector(".modal.clone-to-dialog");
}

/** Drive the NoteAutocomplete `onChange` callback. */
function selectSuggestion(suggestion: unknown) {
    if (!autocompleteOnChange) throw new Error("NoteAutocomplete onChange not captured");
    act(() => autocompleteOnChange?.(suggestion));
}

function clearFroca() {
    for (const key of Object.keys(froca.notes)) delete froca.notes[key];
    for (const key of Object.keys(froca.attributes)) delete froca.attributes[key];
    for (const key of Object.keys(froca.branches)) delete froca.branches[key];
}

beforeEach(() => {
    clearFroca();
    vi.clearAllMocks();
    autocompleteOnChange = undefined;
    // `logError` is a global set up by ws.ts at runtime; ws is mocked, so provide a no-op so the real
    // froca.getBranch (used by cloneNotesTo for missing branches) does not crash on it.
    (window as unknown as { logError: (msg: string) => void }).logError = vi.fn();
    (appContext.tabManager.getActiveContextNoteId as ReturnType<typeof vi.fn>).mockReturnValue(null);
    (tree.getNoteIdAndParentIdFromUrl as ReturnType<typeof vi.fn>).mockImplementation((notePath: string | null | undefined) => {
        if (!notePath) return {};
        const [path] = notePath.split("?");
        const segments = path.split("/");
        return { noteId: segments[segments.length - 1], parentNoteId: segments[segments.length - 2] ?? "root" };
    });
    (branches.cloneNoteToBranch as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
});

afterEach(() => {
    if (container) {
        act(() => { render(null, container ?? document.createElement("div")); });
        container.remove();
        container = undefined;
    }
    parent = undefined;
    vi.restoreAllMocks();
});

// --- Tests ----------------------------------------------------------------------------------------

describe("CloneToDialog", () => {
    it("renders the modal shell hidden initially (no dialog body)", () => {
        const root = renderDialog();
        expect(getModal(root)).not.toBeNull();
        // show=false -> the inner .modal-dialog is not rendered.
        expect(root.querySelector(".modal-dialog")).toBeNull();
        expect(root.querySelector("form")).toBeNull();
    });

    it("opens on cloneNoteIdsTo with explicit ids, deduplicating and listing them", async () => {
        buildNote({ id: "noteA", title: "Note A" });
        buildNote({ id: "noteB", title: "Note B" });

        const root = renderDialog();
        // Pass a duplicate so the dedup loop is exercised.
        openDialog([ "noteA", "noteB", "noteA" ]);
        await flush();

        // Body now rendered with the form + autocomplete input.
        expect(root.querySelector(".modal-dialog")).not.toBeNull();
        expect(root.querySelector("form")).not.toBeNull();
        expect(root.querySelector("input.note-autocomplete")).not.toBeNull();
        // NoteList renders one <li> per unique cloned note.
        const items = root.querySelectorAll("ul li");
        expect(items.length).toBe(2);
        expect(Array.from(items).map((li) => li.textContent)).toEqual([ "Note A", "Note B" ]);
    });

    it("falls back to the active context note id when no ids are passed", async () => {
        buildNote({ id: "activeNote", title: "Active" });
        (appContext.tabManager.getActiveContextNoteId as ReturnType<typeof vi.fn>).mockReturnValue("activeNote");

        const root = renderDialog();
        openDialog(undefined);
        await flush();

        const items = root.querySelectorAll("ul li");
        expect(items.length).toBe(1);
        expect(items[0].textContent).toBe("Active");
    });

    it("uses an empty fallback id when no ids and no active note", async () => {
        (appContext.tabManager.getActiveContextNoteId as ReturnType<typeof vi.fn>).mockReturnValue(null);
        // The single (empty) fallback id is not cached; stub getNotes so NoteList does not hit the server.
        const getNotesSpy = vi.spyOn(froca, "getNotes").mockResolvedValue([]);

        const root = renderDialog();
        openDialog([]);
        await flush();

        // Dialog opens; the cloned-note list resolves to nothing.
        expect(root.querySelector(".modal-dialog")).not.toBeNull();
        expect(getNotesSpy).toHaveBeenCalledWith([ "" ]);
        expect(root.querySelectorAll("ul li").length).toBe(0);
    });

    it("onShown triggers recent notes against the autocomplete input", async () => {
        buildNote({ id: "noteS", title: "Note S" });
        const root = renderDialog();
        openDialog([ "noteS" ]);
        await flush();

        fireModalEvent(root, "shown.bs.modal");
        expect(triggerRecentNotes).toHaveBeenCalledTimes(1);
    });

    it("submitting without a suggestion logs an error and keeps the dialog open", async () => {
        buildNote({ id: "noteN", title: "Note N" });
        const root = renderDialog();
        openDialog([ "noteN" ]);
        await flush();

        submitForm(root);
        await flush();

        expect(logError).toHaveBeenCalled();
        expect(branches.cloneNoteToBranch).not.toHaveBeenCalled();
        // Still open.
        expect(root.querySelector(".modal-dialog")).not.toBeNull();
    });

    it("submits a clone: resolves the target branch, clones each note and toasts", async () => {
        // Build the target parent with the cloned note already as a child so getBranchId resolves.
        buildNote({ id: "parentP", title: "Parent P", children: [ { id: "cloneC", title: "Clone C" } ] });
        const targetBranchId = "parentP_cloneC";
        vi.spyOn(froca, "getBranchId").mockResolvedValue(targetBranchId);

        const root = renderDialog();
        openDialog([ "cloneC" ]);
        await flush();

        selectSuggestion({ notePath: "root/parentP" });
        submitForm(root);
        await flush();

        expect(tree.getNoteIdAndParentIdFromUrl).toHaveBeenCalledWith("root/parentP");
        expect(branches.cloneNoteToBranch).toHaveBeenCalledWith("cloneC", targetBranchId, "");
        expect(toast.showMessage).toHaveBeenCalled();
        // Submitting hides the modal -> body unmounts.
        expect(root.querySelector(".modal-dialog")).toBeNull();
    });

    it("passes the entered prefix through to the clone call", async () => {
        buildNote({ id: "parentQ", title: "Parent Q", children: [ { id: "cloneQ", title: "Clone Q" } ] });
        const targetBranchId = "parentQ_cloneQ";
        vi.spyOn(froca, "getBranchId").mockResolvedValue(targetBranchId);

        const root = renderDialog();
        openDialog([ "cloneQ" ]);
        await flush();

        // Type a prefix into the FormTextBox (Preact maps onChange to the native "input" event).
        const prefixInput = Array.from(root.querySelectorAll<HTMLInputElement>("input")).find((i) => !i.classList.contains("note-autocomplete"));
        expect(prefixInput).toBeTruthy();
        if (prefixInput) {
            prefixInput.value = "pre-";
            dispatch(prefixInput, new Event("input", { bubbles: true }));
        }

        selectSuggestion({ notePath: "root/parentQ" });
        submitForm(root);
        await flush();

        expect(branches.cloneNoteToBranch).toHaveBeenCalledWith("cloneQ", targetBranchId, "pre-");
    });

    it("does nothing when the target path resolves to no noteId/parentNoteId", async () => {
        buildNote({ id: "noteX", title: "Note X" });
        (tree.getNoteIdAndParentIdFromUrl as ReturnType<typeof vi.fn>).mockReturnValue({});

        const root = renderDialog();
        openDialog([ "noteX" ]);
        await flush();

        selectSuggestion({ notePath: "whatever" });
        submitForm(root);
        await flush();

        expect(branches.cloneNoteToBranch).not.toHaveBeenCalled();
        expect(toast.showMessage).not.toHaveBeenCalled();
    });

    it("does nothing when no target branch id can be resolved", async () => {
        buildNote({ id: "noteY", title: "Note Y" });
        vi.spyOn(froca, "getBranchId").mockResolvedValue(null);

        const root = renderDialog();
        openDialog([ "noteY" ]);
        await flush();

        selectSuggestion({ notePath: "root/parentZ" });
        submitForm(root);
        await flush();

        expect(branches.cloneNoteToBranch).not.toHaveBeenCalled();
        expect(toast.showMessage).not.toHaveBeenCalled();
    });

    it("skips the toast when the cloned note or target branch is missing", async () => {
        buildNote({ id: "noteMiss", title: "Note Miss" });
        vi.spyOn(froca, "getBranchId").mockResolvedValue("ghost_branch");
        // getNote returns null -> the per-note loop continues without toasting.
        vi.spyOn(froca, "getNote").mockResolvedValue(null);
        // No branch cached under "ghost_branch" so getBranch also yields undefined.

        const root = renderDialog();
        openDialog([ "noteMiss" ]);
        await flush();

        selectSuggestion({ notePath: "root/parentMiss" });
        submitForm(root);
        await flush();

        expect(branches.cloneNoteToBranch).toHaveBeenCalledWith("noteMiss", "ghost_branch", "");
        expect(toast.showMessage).not.toHaveBeenCalled();
    });

    it("skips the toast when the target branch note cannot be resolved", async () => {
        // Build a real branch whose getNote resolves to nothing.
        buildNote({ id: "tgtParent", title: "Target Parent", children: [ { id: "tgtChild", title: "Target Child" } ] });
        buildNote({ id: "cloneT", title: "Clone T" });
        const branchId = "tgtParent_tgtChild";
        vi.spyOn(froca, "getBranchId").mockResolvedValue(branchId);
        const targetBranch = froca.branches[branchId];
        if (targetBranch) {
            vi.spyOn(targetBranch, "getNote").mockResolvedValue(null as never);
        }

        const root = renderDialog();
        openDialog([ "cloneT" ]);
        await flush();

        selectSuggestion({ notePath: "root/tgtParent" });
        submitForm(root);
        await flush();

        expect(branches.cloneNoteToBranch).toHaveBeenCalledWith("cloneT", branchId, "");
        expect(toast.showMessage).not.toHaveBeenCalled();
    });

    it("onHidden resets the shown state, unmounting the body", async () => {
        buildNote({ id: "noteH", title: "Note H" });
        const root = renderDialog();
        openDialog([ "noteH" ]);
        await flush();
        expect(root.querySelector(".modal-dialog")).not.toBeNull();

        fireModalEvent(root, "hidden.bs.modal");
        expect(root.querySelector(".modal-dialog")).toBeNull();
    });
});
