import { OptionNames } from "@triliumnext/commons";
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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
// `triggerRecentNotes` is a named export used by the dialog's onShown. The mock fn is created inside
// the (hoisted) factory and captured after import via `vi.mocked`.
vi.mock("../../services/note_autocomplete", () => ({
    default: {
        showRecentNotes: vi.fn(),
        setText: vi.fn(),
        initNoteAutocomplete: vi.fn()
    },
    triggerRecentNotes: vi.fn()
}));

// The real NoteAutocomplete registers jQuery plugin methods that only exist once note_autocomplete.ts
// initialises them. Replace it with a plain input whose onChange callback we drive directly.
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

// The dialog (via hooks) imports the named `logError`; the shared ws mock only exposes the default.
vi.mock("../../services/ws", () => ({
    logError: vi.fn(),
    default: { subscribeToMessages: vi.fn() }
}));

vi.mock("../../services/tree", () => ({
    default: {
        getNoteIdFromUrl: vi.fn((notePath: string | null | undefined) => {
            if (!notePath) return null;
            const [path] = notePath.split("?");
            const segments = path.split("/");
            return segments[segments.length - 1];
        })
    }
}));

import Component from "../../components/component";
import froca from "../../services/froca";
import { triggerRecentNotes } from "../../services/note_autocomplete";
import options from "../../services/options";
import server from "../../services/server";
import tree from "../../services/tree";
import { buildNote } from "../../test/easy-froca";
import { ParentComponent } from "../react/react_utils";
import type { CKEditorApi } from "../type_widgets/text/CKEditorWithWatchdog";
import IncludeNoteDialog from "./include_note";

const triggerRecentNotesMock = vi.mocked(triggerRecentNotes);

// --- Render harness for the full dialog -----------------------------------------------------------

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
                <IncludeNoteDialog />
            </ParentComponent.Provider>,
            c
        );
    });
    return c;
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

function submitForm(root: HTMLElement) {
    dispatch(root.querySelector("form"), new Event("submit", { bubbles: true, cancelable: true }));
}

function fireModalEvent(root: HTMLElement, eventName: string) {
    dispatch(root.querySelector<HTMLElement>(".modal.include-note-dialog"), new Event(eventName));
}

function fireEvent(name: string, data: unknown) {
    act(() => {
        (parent?.handleEventInChildren as (n: string, d: unknown) => void)(name, data);
    });
}

async function flush() {
    await act(async () => { await new Promise((resolve) => setTimeout(resolve, 0)); });
}

function makeEditorApi(overrides: Partial<Pick<CKEditorApi, "addIncludeNote" | "addImage">> = {}) {
    return {
        addIncludeNote: vi.fn(),
        addImage: vi.fn(async () => undefined),
        ...overrides
    };
}

/** Open the dialog by firing the Trilium command the widget subscribes to. */
function openDialog(editorApi: Pick<CKEditorApi, "addIncludeNote" | "addImage">) {
    fireEvent("showIncludeNoteDialog", { editorApi });
}

function getModal(root: HTMLElement) {
    return root.querySelector(".modal.include-note-dialog");
}

/** Drive the NoteAutocomplete `onChange` callback (the dialog's only suggestion source). */
function selectSuggestion(suggestion: unknown) {
    if (!autocompleteOnChange) throw new Error("NoteAutocomplete onChange not captured");
    act(() => autocompleteOnChange?.(suggestion));
}

function setOptions(values: Record<string, string>) {
    options.load(values as Record<OptionNames, string>);
}

beforeEach(() => {
    for (const key of Object.keys(froca.notes)) delete froca.notes[key];
    for (const key of Object.keys(froca.attributes)) delete froca.attributes[key];
    for (const key of Object.keys(froca.branches)) delete froca.branches[key];
    vi.clearAllMocks();
    autocompleteOnChange = undefined;
    setOptions({ includeNoteDefaultBoxSize: "medium" });
    // The shared setup mock for server only defines get/post; the option setter calls server.put.
    Object.assign(server, { put: vi.fn(async () => undefined) });
    (tree.getNoteIdFromUrl as ReturnType<typeof vi.fn>).mockImplementation((notePath: string | null | undefined) => {
        if (!notePath) return null;
        const [path] = notePath.split("?");
        const segments = path.split("/");
        return segments[segments.length - 1];
    });
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

describe("IncludeNoteDialog", () => {
    it("renders the modal shell hidden initially (no dialog body)", () => {
        const root = renderDialog();
        const modal = getModal(root);
        expect(modal).not.toBeNull();
        // show=false -> the inner .modal-dialog is not rendered.
        expect(root.querySelector(".modal-dialog")).toBeNull();
        expect(root.querySelector("input.note-autocomplete")).toBeNull();
    });

    it("opens on showIncludeNoteDialog: shows body, autocomplete and the four box-size radios (default checked)", () => {
        const root = renderDialog();
        openDialog(makeEditorApi());

        expect(root.querySelector(".modal-dialog")).not.toBeNull();
        expect(root.querySelector("input.note-autocomplete")).not.toBeNull();

        const radios = Array.from(root.querySelectorAll<HTMLInputElement>("input[type='radio']"));
        expect(radios.map((r) => r.value)).toEqual([ "small", "medium", "full", "expandable" ]);
        // boxSize is reset to the default option ("medium") when opening.
        const checked = radios.find((r) => r.checked);
        expect(checked?.value).toBe("medium");
    });

    it("onShown triggers recent notes for the autocomplete input", () => {
        const root = renderDialog();
        openDialog(makeEditorApi());
        fireModalEvent(root, "shown.bs.modal");
        expect(triggerRecentNotesMock).toHaveBeenCalledTimes(1);
    });

    it("onHidden (close/backdrop) closes the dialog body", () => {
        const root = renderDialog();
        openDialog(makeEditorApi());
        expect(root.querySelector(".modal-dialog")).not.toBeNull();

        fireModalEvent(root, "hidden.bs.modal");
        expect(root.querySelector(".modal-dialog")).toBeNull();
    });

    it("changing the box size selects the new radio", () => {
        const root = renderDialog();
        openDialog(makeEditorApi());

        expect(selectRadio(root, "full")).toBeDefined();
        const radios = Array.from(root.querySelectorAll<HTMLInputElement>("input[type='radio']"));
        expect(radios.find((r) => r.checked)?.value).toBe("full");
    });

    it("submitting without a selected suggestion does nothing and keeps the dialog open", async () => {
        const editorApi = makeEditorApi();
        const root = renderDialog();
        openDialog(editorApi);

        submitForm(root);
        await flush();

        expect(editorApi.addIncludeNote).not.toHaveBeenCalled();
        expect(editorApi.addImage).not.toHaveBeenCalled();
        expect(server.put).not.toHaveBeenCalled();
        // Still shown.
        expect(root.querySelector(".modal-dialog")).not.toBeNull();
    });

    it("submitting a text note suggestion inserts an include-note with the chosen box size", async () => {
        buildNote({ id: "textNote", title: "Text Note", type: "text" });
        const editorApi = makeEditorApi();

        const root = renderDialog();
        openDialog(editorApi);
        selectSuggestion({ notePath: "root/textNote" });
        // keep box size at the default ("medium") -> no option save.
        submitForm(root);
        await flush();

        expect(editorApi.addIncludeNote).toHaveBeenCalledWith("textNote", "medium");
        expect(editorApi.addImage).not.toHaveBeenCalled();
        // box size unchanged from default -> not persisted.
        expect(server.put).not.toHaveBeenCalled();
        // Dialog hides after a successful submit.
        expect(root.querySelector(".modal-dialog")).toBeNull();
    });

    it("persists the chosen box size as the new default when it differs", async () => {
        buildNote({ id: "textNote2", title: "Text Note 2", type: "text" });
        const editorApi = makeEditorApi();

        const root = renderDialog();
        openDialog(editorApi);
        selectSuggestion({ notePath: "root/textNote2" });
        selectRadio(root, "full");
        submitForm(root);
        await flush();

        expect(editorApi.addIncludeNote).toHaveBeenCalledWith("textNote2", "full");
        // box size changed -> persisted via options.save -> server.put.
        expect(server.put).toHaveBeenCalledWith("options", { includeNoteDefaultBoxSize: "full" });
    });

    it.each([ "image", "canvas", "mermaid" ])("inserts an IMG tag (not include-note) for a %s note", async (type) => {
        buildNote({ id: `media-${type}`, title: type, type: type as never });
        const editorApi = makeEditorApi();

        const root = renderDialog();
        openDialog(editorApi);
        selectSuggestion({ notePath: `root/media-${type}` });
        submitForm(root);
        await flush();

        expect(editorApi.addImage).toHaveBeenCalledWith(`media-${type}`);
        expect(editorApi.addIncludeNote).not.toHaveBeenCalled();
    });

    it("ignores a suggestion whose notePath resolves to no note id (no insertion)", async () => {
        (tree.getNoteIdFromUrl as ReturnType<typeof vi.fn>).mockReturnValue(null);
        const getNoteSpy = vi.spyOn(froca, "getNote");
        const editorApi = makeEditorApi();

        const root = renderDialog();
        openDialog(editorApi);
        selectSuggestion({ notePath: "root/whatever" });
        submitForm(root);
        await flush();

        expect(getNoteSpy).not.toHaveBeenCalled();
        expect(editorApi.addIncludeNote).not.toHaveBeenCalled();
        expect(editorApi.addImage).not.toHaveBeenCalled();
    });

    it("falls back to addIncludeNote when the resolved note cannot be found (null note type)", async () => {
        const getNoteSpy = vi.spyOn(froca, "getNote").mockResolvedValue(null);
        const editorApi = makeEditorApi();

        const root = renderDialog();
        openDialog(editorApi);
        selectSuggestion({ notePath: "root/missing" });
        submitForm(root);
        await flush();

        expect(getNoteSpy).toHaveBeenCalledWith("missing");
        // note is null -> type "" -> not media -> include-note branch.
        expect(editorApi.addIncludeNote).toHaveBeenCalledWith("missing", "medium");
        expect(editorApi.addImage).not.toHaveBeenCalled();
    });

    it("reopening resets the box size back to the (possibly changed) default option", async () => {
        const root = renderDialog();
        openDialog(makeEditorApi());

        // Change selection away from default within the session.
        selectRadio(root, "expandable");
        expect(Array.from(root.querySelectorAll<HTMLInputElement>("input[type='radio']")).find((r) => r.checked)?.value)
            .toBe("expandable");

        // Reopen -> boxSize is reset to the default option value ("medium").
        openDialog(makeEditorApi());
        await flush();
        expect(Array.from(root.querySelectorAll<HTMLInputElement>("input[type='radio']")).find((r) => r.checked)?.value)
            .toBe("medium");
    });
});
