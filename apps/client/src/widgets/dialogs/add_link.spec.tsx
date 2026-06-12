import { act } from "preact/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";

// --- Module mocks (hoisted above the component import) --------------------------------------------

// The real bootstrap Modal/Tooltip machinery does not behave under happy-dom; provide inert stubs.
vi.mock("bootstrap", () => {
    class Modal {
        static getOrCreateInstance() { return new Modal(); }
        static getInstance() { return null; }
        show() {}
        hide() {}
        dispose() {}
    }
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

// note_autocomplete pulls in jQuery autocomplete plugins + a top-level server.get; stub it entirely.
vi.mock("../../services/note_autocomplete", () => ({
    default: {
        showRecentNotes: vi.fn(),
        setText: vi.fn(),
        initNoteAutocomplete: vi.fn()
    }
}));

// The real NoteAutocomplete registers jQuery plugin methods ($.fn.setSelectedNotePath, .setNote, ...)
// that only exist once note_autocomplete.ts initialises them. Replace it with a plain input whose
// onChange callback we can drive directly from tests.
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
        getNoteTitle: vi.fn(async () => "Default Title"),
        getNoteIdFromUrl: vi.fn((notePath: string | null | undefined) => {
            if (!notePath) return null;
            const [path] = notePath.split("?");
            const segments = path.split("/");
            return segments[segments.length - 1];
        })
    }
}));

import froca from "../../services/froca";
import note_autocomplete from "../../services/note_autocomplete";
import tree from "../../services/tree";
import { logError } from "../../services/ws";
import Component from "../../components/component";
import { buildNote } from "../../test/easy-froca";
import { flush, renderComponent, resetFroca } from "../../test/render";
import AddLinkDialog, { type AddLinkOpts } from "./add_link";

// --- Render harness for the full dialog -----------------------------------------------------------

let parent: Component | undefined;

function renderDialog() {
    const result = renderComponent(<AddLinkDialog />);
    parent = result.parent;
    return result.container;
}

/** Dispatch a DOM event inside `act` without leaking the boolean return value (typing). */
function dispatch(el: EventTarget | null | undefined, event: Event) {
    if (!el) return;
    act(() => { el.dispatchEvent(event); });
}

/** Select the radio with the given value within `root` and fire its change event. */
function selectRadio(root: HTMLElement, value: string) {
    const radio = Array.from(root.querySelectorAll<HTMLInputElement>("input[type='radio']")).find((r) => r.value === value);
    if (radio) {
        radio.checked = true;
        dispatch(radio, new Event("change", { bubbles: true }));
    }
    return radio;
}

function changeSelectValue(select: HTMLSelectElement | null, value: string) {
    if (!select) return;
    select.value = value;
    dispatch(select, new Event("change", { bubbles: true }));
}

function submitForm(root: HTMLElement) {
    dispatch(root.querySelector("form"), new Event("submit", { bubbles: true, cancelable: true }));
}

function fireModalEvent(root: HTMLElement, eventName: string) {
    dispatch(root.querySelector<HTMLElement>(".modal.add-link-dialog"), new Event(eventName));
}

function fireEvent(name: string, data: unknown) {
    act(() => {
        (parent?.handleEventInChildren as (n: string, d: unknown) => void)(name, data);
    });
}

function makeOpts(overrides: Partial<AddLinkOpts> = {}): AddLinkOpts {
    return {
        text: "",
        hasSelection: false,
        addLink: vi.fn(async () => undefined),
        ...overrides
    };
}

/** Open the dialog by firing the Trilium command the widget subscribes to. */
function openDialog(opts: AddLinkOpts) {
    fireEvent("showAddLinkDialog", opts);
}

function getModal(root: HTMLElement) {
    return root.querySelector(".modal.add-link-dialog");
}

/** Drive the NoteAutocomplete `onChange` callback (the dialog's only suggestion source). */
function selectSuggestion(suggestion: unknown) {
    if (!autocompleteOnChange) throw new Error("NoteAutocomplete onChange not captured");
    act(() => autocompleteOnChange?.(suggestion));
}

beforeEach(() => {
    resetFroca();
    vi.clearAllMocks();
    autocompleteOnChange = undefined;
    (tree.getNoteTitle as ReturnType<typeof vi.fn>).mockResolvedValue("Default Title");
    // clearAllMocks wipes call history but keeps per-test impls (e.g. mockReturnValue(null)); reset it.
    (tree.getNoteIdFromUrl as ReturnType<typeof vi.fn>).mockImplementation((notePath: string | null | undefined) => {
        if (!notePath) return null;
        const [path] = notePath.split("?");
        const segments = path.split("/");
        return segments[segments.length - 1];
    });
});

// --- Tests ----------------------------------------------------------------------------------------

describe("AddLinkDialog", () => {
    it("renders the modal shell hidden initially (no dialog body, no title settings)", () => {
        const root = renderDialog();
        const modal = getModal(root);
        expect(modal).not.toBeNull();
        // show=false -> the inner .modal-dialog is not rendered.
        expect(root.querySelector(".modal-dialog")).toBeNull();
        expect(root.querySelector(".add-link-title-settings")).toBeNull();
    });

    it("opens on showAddLinkDialog without a selection: shows body + radio group, no title input", () => {
        const root = renderDialog();
        openDialog(makeOpts({ hasSelection: false }));

        // Body now rendered.
        expect(root.querySelector(".modal-dialog")).not.toBeNull();
        // No selection -> title settings block present with a radio group, but no link-title input yet
        // (linkType defaults to "reference-link").
        const settings = root.querySelector(".add-link-title-settings");
        expect(settings).not.toBeNull();
        expect(root.querySelector("[role='group']")).not.toBeNull();
        expect(root.querySelector("input.link-title")).toBeNull();
        // The autocomplete input is always present in the body.
        expect(root.querySelector("input.note-autocomplete")).not.toBeNull();
    });

    it("opens with a selection: hyper-link default and no title-settings block", () => {
        const root = renderDialog();
        openDialog(makeOpts({ hasSelection: true }));

        expect(root.querySelector(".modal-dialog")).not.toBeNull();
        // hasSelection -> the entire title-settings block is suppressed.
        expect(root.querySelector(".add-link-title-settings")).toBeNull();
        expect(root.querySelector("[role='group']")).toBeNull();
    });

    it("switching link type to hyper-link reveals the editable link-title input", () => {
        const root = renderDialog();
        openDialog(makeOpts({ hasSelection: false }));

        // Switch radio to "hyper-link".
        expect(selectRadio(root, "hyper-link")).toBeDefined();

        const titleInput = root.querySelector<HTMLInputElement>("input.link-title");
        expect(titleInput).not.toBeNull();

        // Typing into the title input updates the controlled value.
        if (titleInput) {
            titleInput.value = "Custom title";
            dispatch(titleInput, new Event("input", { bubbles: true }));
            expect(titleInput.value).toBe("Custom title");
        }
    });

    it("selecting a note suggestion loads its title and renders bookmark anchors from labels", async () => {
        buildNote({
            id: "noteA",
            title: "Note A",
            "#internalBookmark": "intro"
        });
        (tree.getNoteTitle as ReturnType<typeof vi.fn>).mockResolvedValue("Note A");

        const root = renderDialog();
        openDialog(makeOpts({ hasSelection: false }));
        selectSuggestion({ notePath: "root/noteA" });
        await flush();

        expect(tree.getNoteTitle).toHaveBeenCalledWith("noteA");
        const anchorSelect = root.querySelector("select.form-select");
        expect(anchorSelect).not.toBeNull();
        const options = root.querySelectorAll("select.form-select option");
        // none + 1 label
        expect(options.length).toBe(2);
        expect(Array.from(options).map((o) => o.getAttribute("value"))).toContain("intro");
    });

    it("falls back to scanning note content for anchor ids when there are no bookmark labels", async () => {
        buildNote({
            id: "noteB",
            title: "Note B",
            type: "text",
            content: `<p><a id="a1"></a>x</p><a name="skip" id='a2'>t</a><a href="#" id="ignored"></a><a id="a1"></a>`
        });
        (tree.getNoteTitle as ReturnType<typeof vi.fn>).mockResolvedValue("Note B");

        const root = renderDialog();
        openDialog(makeOpts({ hasSelection: false }));
        selectSuggestion({ notePath: "root/noteB" });
        await flush();

        const options = root.querySelectorAll("select.form-select option");
        // none + a1 + a2 (a1 deduped, href-bearing anchor ignored).
        const values = Array.from(options).map((o) => o.getAttribute("value"));
        expect(values).toContain("a1");
        expect(values).toContain("a2");
        expect(values).not.toContain("ignored");
        // Selecting a bookmark updates the link title (noteTitle - bookmark).
        changeSelectValue(root.querySelector<HTMLSelectElement>("select.form-select"), "a2");
        // Switch to hyper-link to expose the title input and read the combined value.
        selectRadio(root, "hyper-link");
        const titleInput = root.querySelector<HTMLInputElement>("input.link-title");
        expect(titleInput?.value).toBe("Note B - a2");
    });

    it("an external-link suggestion switches link type and sets the title", async () => {
        const root = renderDialog();
        openDialog(makeOpts({ hasSelection: false }));
        selectSuggestion({ externalLink: "https://example.com" });
        await flush();

        // external-link hides the radio group entirely but keeps the title input.
        expect(root.querySelector("[role='group']")).toBeNull();
        const titleInput = root.querySelector<HTMLInputElement>("input.link-title");
        expect(titleInput).not.toBeNull();
        expect(titleInput?.value).toBe("https://example.com");
    });

    it("clearing the suggestion resets external-link back to reference-link and removes anchors", async () => {
        buildNote({ id: "noteC", title: "Note C", "#internalBookmark": "top" });
        (tree.getNoteTitle as ReturnType<typeof vi.fn>).mockResolvedValue("Note C");

        const root = renderDialog();
        openDialog(makeOpts({ hasSelection: false }));

        // First go external (sets link type to external-link).
        selectSuggestion({ externalLink: "https://x.test" });
        await flush();
        expect(root.querySelector("[role='group']")).toBeNull();

        // Now clear -> reset resets external-link to reference-link, radio group reappears.
        selectSuggestion(null);
        await flush();
        expect(root.querySelector("[role='group']")).not.toBeNull();
        expect(root.querySelector("select.form-select")).toBeNull();
    });

    it("onShown shows recent notes when there is no preset text, else seeds the text", () => {
        const root = renderDialog();
        openDialog(makeOpts({ text: "" }));
        expect(root.querySelector(".modal.add-link-dialog")).not.toBeNull();
        fireModalEvent(root, "shown.bs.modal");
        expect(note_autocomplete.showRecentNotes).toHaveBeenCalled();
        expect(note_autocomplete.setText).not.toHaveBeenCalled();
    });

    it("onShown seeds preset text via note_autocomplete.setText", () => {
        const root = renderDialog();
        openDialog(makeOpts({ text: "hello" }));
        fireModalEvent(root, "shown.bs.modal");
        expect(note_autocomplete.setText).toHaveBeenCalled();
        expect(note_autocomplete.showRecentNotes).not.toHaveBeenCalled();
    });

    it("submitting without a suggestion logs an error and keeps the dialog open", () => {
        const root = renderDialog();
        openDialog(makeOpts({ hasSelection: false }));
        expect(root.querySelector("form")).not.toBeNull();
        submitForm(root);
        expect(logError).toHaveBeenCalled();
        // Still rendered (not hidden).
        expect(root.querySelector(".modal-dialog")).not.toBeNull();
    });

    it("submitting a note suggestion inserts a reference link on hide (null title)", async () => {
        buildNote({ id: "noteD", title: "Note D" });
        (tree.getNoteTitle as ReturnType<typeof vi.fn>).mockResolvedValue("Note D");
        const addLink = vi.fn(async () => undefined);

        const root = renderDialog();
        openDialog(makeOpts({ hasSelection: false, addLink }));
        selectSuggestion({ notePath: "root/noteD" });
        await flush();

        submitForm(root);
        // onHidden runs the insertion. Drive it via the modal's hidden event.
        fireModalEvent(root, "hidden.bs.modal");

        // reference-link -> title argument is null.
        expect(addLink).toHaveBeenCalledWith("root/noteD", null);
    });

    it("submitting a note suggestion with a chosen bookmark inserts an anchored link", async () => {
        buildNote({ id: "noteE", title: "Note E", "#internalBookmark": "sec one" });
        (tree.getNoteTitle as ReturnType<typeof vi.fn>).mockResolvedValue("Note E");
        const addLink = vi.fn(async () => undefined);

        const root = renderDialog();
        openDialog(makeOpts({ hasSelection: false, addLink }));
        selectSuggestion({ notePath: "root/noteE" });
        await flush();

        changeSelectValue(root.querySelector<HTMLSelectElement>("select.form-select"), "sec one");
        // Switch to hyper-link so the inserted title is the (non-null) link title.
        selectRadio(root, "hyper-link");

        submitForm(root);
        fireModalEvent(root, "hidden.bs.modal");

        expect(addLink).toHaveBeenCalledTimes(1);
        const [path, title] = (addLink as ReturnType<typeof vi.fn>).mock.calls[0];
        expect(path).toBe(`root/noteE?bookmark=${encodeURIComponent("sec one")}`);
        expect(title).toBe("Note E - sec one");
    });

    it("submitting an external-link suggestion inserts it as an external link on hide", async () => {
        const addLink = vi.fn(async () => undefined);
        const root = renderDialog();
        openDialog(makeOpts({ hasSelection: false, addLink }));
        selectSuggestion({ externalLink: "https://ext.test" });
        await flush();

        submitForm(root);
        fireModalEvent(root, "hidden.bs.modal");

        expect(addLink).toHaveBeenCalledWith("https://ext.test", "https://ext.test", true);
    });

    it("hiding without a prior submit does not insert any link and resets state", async () => {
        buildNote({ id: "noteF", title: "Note F", "#internalBookmark": "x" });
        (tree.getNoteTitle as ReturnType<typeof vi.fn>).mockResolvedValue("Note F");
        const addLink = vi.fn(async () => undefined);

        const root = renderDialog();
        openDialog(makeOpts({ hasSelection: false, addLink }));
        selectSuggestion({ notePath: "root/noteF" });
        await flush();
        expect(root.querySelector("select.form-select")).not.toBeNull();

        // Hide via close (no submit) -> no insertion, anchors cleared.
        fireModalEvent(root, "hidden.bs.modal");

        expect(addLink).not.toHaveBeenCalled();
        expect(root.querySelector("select.form-select")).toBeNull();
    });

    it("ignores a note suggestion whose notePath resolves to no note id", async () => {
        // notePath is truthy but getNoteIdFromUrl yields a falsy id -> the inner branch is skipped.
        (tree.getNoteIdFromUrl as ReturnType<typeof vi.fn>).mockReturnValue(null);
        const getNoteSpy = vi.spyOn(froca, "getNote");

        const root = renderDialog();
        openDialog(makeOpts({ hasSelection: false }));
        selectSuggestion({ notePath: "root/whatever" });
        await flush();

        expect(getNoteSpy).not.toHaveBeenCalled();
        expect(root.querySelector("select.form-select")).toBeNull();
    });

    it("submitting a suggestion with neither notePath nor externalLink inserts nothing", async () => {
        const addLink = vi.fn(async () => undefined);
        const root = renderDialog();
        openDialog(makeOpts({ hasSelection: false, addLink }));
        // A truthy suggestion (so onSubmit proceeds) but with no notePath / externalLink fields.
        selectSuggestion({ noteTitle: "orphan" });
        await flush();

        submitForm(root);
        fireModalEvent(root, "hidden.bs.modal");

        expect(addLink).not.toHaveBeenCalled();
    });

    it("ignores a note suggestion whose note cannot be resolved (no anchors rendered)", async () => {
        // notePath resolves to a noteId that is NOT cached; froca.getNote returns null after a guarded
        // load. Spy froca.getNote to return null so no server load is attempted.
        const getNoteSpy = vi.spyOn(froca, "getNote").mockResolvedValue(null);
        (tree.getNoteTitle as ReturnType<typeof vi.fn>).mockResolvedValue("[not found]");

        const root = renderDialog();
        openDialog(makeOpts({ hasSelection: false }));
        selectSuggestion({ notePath: "root/missing" });
        await flush();

        expect(getNoteSpy).toHaveBeenCalledWith("missing");
        expect(root.querySelector("select.form-select")).toBeNull();
    });
});
