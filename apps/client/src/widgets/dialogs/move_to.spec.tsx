import { act } from "preact/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";

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

// The shared setup mock for ws only exposes the default export's subscribeToMessages; keep ws inert.
vi.mock("../../services/ws", () => ({
    logError: vi.fn(),
    default: { subscribeToMessages: vi.fn() }
}));

vi.mock("../../services/branches", () => ({
    default: { moveToParentNote: vi.fn(async () => undefined) }
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

import type Component from "../../components/component";
import branches from "../../services/branches";
import froca from "../../services/froca";
import { triggerRecentNotes } from "../../services/note_autocomplete";
import toast from "../../services/toast";
import tree from "../../services/tree";
import { buildNote } from "../../test/easy-froca";
import { flush, renderComponent, resetFroca } from "../../test/render";
import MoveToDialog from "./move_to";

// --- Render harness -------------------------------------------------------------------------------

let parent: Component | undefined;

function renderDialog() {
    const { container, parent: p } = renderComponent(<MoveToDialog />);
    parent = p;
    return container;
}

function dispatch(el: EventTarget | null | undefined, event: Event) {
    if (!el) return;
    act(() => { el.dispatchEvent(event); });
}

function submitForm(root: HTMLElement) {
    dispatch(root.querySelector("form"), new Event("submit", { bubbles: true, cancelable: true }));
}

function fireModalEvent(root: HTMLElement, eventName: string) {
    dispatch(root.querySelector<HTMLElement>(".modal.move-to-dialog"), new Event(eventName));
}

function fireEvent(name: string, data: unknown) {
    act(() => {
        (parent?.handleEventInChildren as (n: string, d: unknown) => void)(name, data);
    });
}

/** Open the dialog by firing the Trilium command the widget subscribes to. */
function openDialog(branchIds: string[] | undefined) {
    fireEvent("moveBranchIdsTo", { branchIds });
}

function getModal(root: HTMLElement) {
    return root.querySelector(".modal.move-to-dialog");
}

/** Drive the NoteAutocomplete `onChange` callback. */
function selectSuggestion(suggestion: unknown) {
    if (!autocompleteOnChange) throw new Error("NoteAutocomplete onChange not captured");
    act(() => autocompleteOnChange?.(suggestion));
}

const logErrorMock = vi.fn();

beforeEach(() => {
    resetFroca();
    vi.clearAllMocks();
    autocompleteOnChange = undefined;
    parent = undefined;
    // `logError` is a global normally set up by ws.ts; the dialog's onSubmit error path calls it
    // directly. froca.getBranch (used by moveNotesTo on a missing branch) also relies on it.
    logErrorMock.mockClear();
    (window as unknown as { logError: (msg: string) => void }).logError = logErrorMock;
    (branches.moveToParentNote as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
});

// --- Tests ----------------------------------------------------------------------------------------

describe("MoveToDialog", () => {
    it("renders the modal shell hidden initially (no dialog body)", () => {
        const root = renderDialog();
        expect(getModal(root)).not.toBeNull();
        // show=false -> the inner .modal-dialog is not rendered.
        expect(root.querySelector(".modal-dialog")).toBeNull();
        expect(root.querySelector("form")).toBeNull();
    });

    it("opens on moveBranchIdsTo and lists the moved notes via their branches", async () => {
        // The moved notes are referenced by branch id, so build a parent with children to get branches.
        buildNote({ id: "srcParent", title: "Source", children: [
            { id: "noteA", title: "Note A" },
            { id: "noteB", title: "Note B" }
        ] });

        const root = renderDialog();
        openDialog([ "srcParent_noteA", "srcParent_noteB" ]);
        await flush();

        // Body now rendered with the form + autocomplete input.
        expect(root.querySelector(".modal-dialog")).not.toBeNull();
        expect(root.querySelector("form")).not.toBeNull();
        expect(root.querySelector("input.note-autocomplete")).not.toBeNull();
        // NoteList resolves one <li> per moved branch's note.
        const items = root.querySelectorAll("ul li");
        expect(items.length).toBe(2);
        expect(Array.from(items).map((li) => li.textContent)).toEqual([ "Note A", "Note B" ]);
    });

    it("opens with undefined branchIds and lists nothing", async () => {
        const root = renderDialog();
        openDialog(undefined);
        await flush();

        expect(root.querySelector(".modal-dialog")).not.toBeNull();
        expect(root.querySelectorAll("ul li").length).toBe(0);
    });

    it("onShown triggers recent notes against the autocomplete input", async () => {
        buildNote({ id: "shownParent", title: "P", children: [ { id: "noteS", title: "Note S" } ] });
        const root = renderDialog();
        openDialog([ "shownParent_noteS" ]);
        await flush();

        fireModalEvent(root, "shown.bs.modal");
        expect(triggerRecentNotes).toHaveBeenCalledTimes(1);
    });

    it("submitting without a suggestion logs an error and keeps the dialog open", async () => {
        buildNote({ id: "noParent", title: "P", children: [ { id: "noteN", title: "Note N" } ] });
        const root = renderDialog();
        openDialog([ "noParent_noteN" ]);
        await flush();

        submitForm(root);
        await flush();

        expect(logErrorMock).toHaveBeenCalled();
        expect(branches.moveToParentNote).not.toHaveBeenCalled();
        // Still open.
        expect(root.querySelector(".modal-dialog")).not.toBeNull();
    });

    it("submits a move: resolves the target branch, moves the notes and toasts", async () => {
        // Build the target parent (with a child so a real branch + getNote exists for the toast).
        buildNote({ id: "destParent", title: "Dest Parent", children: [ { id: "destChild", title: "Dest Child" } ] });
        buildNote({ id: "moveSrc", title: "Move Src", children: [ { id: "moveMe", title: "Move Me" } ] });
        const targetBranchId = "destParent_destChild";
        vi.spyOn(froca, "getBranchId").mockResolvedValue(targetBranchId);

        const root = renderDialog();
        openDialog([ "moveSrc_moveMe" ]);
        await flush();

        selectSuggestion({ notePath: "root/destParent" });
        submitForm(root);
        await flush();

        expect(branches.moveToParentNote).toHaveBeenCalledWith([ "moveSrc_moveMe" ], targetBranchId);
        expect(toast.showMessage).toHaveBeenCalled();
        // Submitting hides the modal -> body unmounts.
        expect(root.querySelector(".modal-dialog")).toBeNull();
    });

    it("does nothing when the target path resolves to no parentNoteId", async () => {
        buildNote({ id: "xParent", title: "P", children: [ { id: "noteX", title: "Note X" } ] });
        vi.spyOn(tree, "getNoteIdAndParentIdFromUrl").mockReturnValue({});

        const root = renderDialog();
        openDialog([ "xParent_noteX" ]);
        await flush();

        selectSuggestion({ notePath: "whatever" });
        submitForm(root);
        await flush();

        expect(branches.moveToParentNote).not.toHaveBeenCalled();
        expect(toast.showMessage).not.toHaveBeenCalled();
        // The modal still hides on submit even when nothing is moved.
        expect(root.querySelector(".modal-dialog")).toBeNull();
    });

    it("does nothing when no target branch id can be resolved", async () => {
        buildNote({ id: "yParent", title: "P", children: [ { id: "noteY", title: "Note Y" } ] });
        vi.spyOn(tree, "getNoteIdAndParentIdFromUrl").mockReturnValue({ noteId: "destNote", parentNoteId: "destPar" });
        vi.spyOn(froca, "getBranchId").mockResolvedValue(null);

        const root = renderDialog();
        openDialog([ "yParent_noteY" ]);
        await flush();

        selectSuggestion({ notePath: "root/destPar" });
        submitForm(root);
        await flush();

        expect(branches.moveToParentNote).not.toHaveBeenCalled();
        expect(toast.showMessage).not.toHaveBeenCalled();
    });

    it("toasts even when the target branch note cannot be resolved (undefined parentBranch)", async () => {
        buildNote({ id: "ghostSrc", title: "P", children: [ { id: "ghostMove", title: "Ghost Move" } ] });
        vi.spyOn(tree, "getNoteIdAndParentIdFromUrl").mockReturnValue({ noteId: "gNote", parentNoteId: "gParent" });
        // getBranchId resolves to a branch id that is not cached -> froca.getBranch yields undefined.
        vi.spyOn(froca, "getBranchId").mockResolvedValue("ghost_branch");

        const root = renderDialog();
        openDialog([ "ghostSrc_ghostMove" ]);
        await flush();

        selectSuggestion({ notePath: "root/gParent" });
        submitForm(root);
        await flush();

        expect(branches.moveToParentNote).toHaveBeenCalledWith([ "ghostSrc_ghostMove" ], "ghost_branch");
        // parentNote is undefined -> the message still shows (with an undefined title appended).
        expect(toast.showMessage).toHaveBeenCalled();
    });

    it("does not call moveToParentNote when movedBranchIds is undefined but still toasts", async () => {
        buildNote({ id: "destOnly", title: "Dest", children: [ { id: "destOnlyChild", title: "Dest Only Child" } ] });
        const targetBranchId = "destOnly_destOnlyChild";
        vi.spyOn(froca, "getBranchId").mockResolvedValue(targetBranchId);

        const root = renderDialog();
        // Open without branch ids; movedBranchIds stays undefined.
        openDialog(undefined);
        await flush();

        selectSuggestion({ notePath: "root/destOnly" });
        submitForm(root);
        await flush();

        expect(branches.moveToParentNote).not.toHaveBeenCalled();
        // moveNotesTo still resolves the parent note and toasts.
        expect(toast.showMessage).toHaveBeenCalled();
    });

    it("onHidden resets the shown state, unmounting the body", async () => {
        buildNote({ id: "hParent", title: "P", children: [ { id: "noteH", title: "Note H" } ] });
        const root = renderDialog();
        openDialog([ "hParent_noteH" ]);
        await flush();
        expect(root.querySelector(".modal-dialog")).not.toBeNull();

        fireModalEvent(root, "hidden.bs.modal");
        expect(root.querySelector(".modal-dialog")).toBeNull();
    });
});
