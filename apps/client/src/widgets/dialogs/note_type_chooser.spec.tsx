import { act } from "preact/test-utils";
import { beforeEach, describe, expect, it, vi } from "vitest";

import type { MenuItem } from "../../menus/context_menu";
import type { TreeCommandNames } from "../../menus/tree_context_menu";
import { flush, renderComponent } from "../../test/render";

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
    // FormList builds a Bootstrap Dropdown instance in an effect.
    class Dropdown {
        static getOrCreateInstance() { return new Dropdown(); }
        static getInstance() { return null; }
        show() {}
        hide() {}
        dispose() {}
    }
    return { Modal, Tooltip, Dropdown, default: { Modal, Tooltip, Dropdown } };
});

// openDialog resolves with a jQuery-wrapped element; the Modal effect calls `.then(...)` on it.
vi.mock("../../services/dialog", () => ({
    openDialog: vi.fn(async ($el: JQuery<HTMLElement>) => $el)
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

// note_types pulls in froca + a top-level server.get; stub the single method the dialog calls.
vi.mock("../../services/note_types", () => ({
    default: { getNoteTypeItems: vi.fn(async () => []) }
}));

import note_types from "../../services/note_types";
import NoteTypeChooserDialogComponent, { type ChooseNoteTypeResponse } from "./note_type_chooser";

const getNoteTypeItems = note_types.getNoteTypeItems as ReturnType<typeof vi.fn>;

// --- Render harness -------------------------------------------------------------------------------

let fireEvent: (name: string, data: unknown) => void = () => {};

function renderDialog() {
    const { container, parent } = renderComponent(<NoteTypeChooserDialogComponent />);
    fireEvent = (name, data) => act(() => {
        (parent.handleEventInChildren as (n: string, d: unknown) => void)(name, data);
    });
    return container;
}

function dispatch(el: EventTarget | null | undefined, event: Event) {
    if (!el) return;
    act(() => { el.dispatchEvent(event); });
}

function fireModalEvent(root: HTMLElement, eventName: string) {
    dispatch(root.querySelector<HTMLElement>(".modal.note-type-chooser-dialog"), new Event(eventName));
}

function getModal(root: HTMLElement) {
    return root.querySelector(".modal.note-type-chooser-dialog");
}

/** Open the dialog by firing the Trilium command the widget subscribes to, capturing the callback. */
function openDialog() {
    const callback = vi.fn<(data: ChooseNoteTypeResponse) => void>();
    fireEvent("chooseNoteType", { callback });
    return callback;
}

/** Click the FormList dropdown item whose data-value equals `value` (drives onNoteTypeSelected). */
function clickItem(root: HTMLElement, value: string) {
    const item = root.querySelector<HTMLElement>(`.dropdown-item[data-value="${value}"]`);
    if (item) {
        act(() => { item.click(); });
    }
    return item;
}

const buildItems = (): MenuItem<TreeCommandNames>[] => [
    { title: "Text", type: "text", uiIcon: "bx bx-note", badges: [] },
    { kind: "separator" },
    { title: "Built-in", type: "doc", uiIcon: "bx bx-book", templateNoteId: "tplA", badges: [ { title: "New", className: "new-note-type-badge" } ] },
    { kind: "separator" },
    { title: "User Tpl", kind: "header" },
    { title: "My Template", type: "text", uiIcon: "bx bx-star", templateNoteId: "tplB" }
];

beforeEach(() => {
    vi.clearAllMocks();
    autocompleteOnChange = undefined;
    getNoteTypeItems.mockResolvedValue([]);
});

// --- Tests ----------------------------------------------------------------------------------------

describe("NoteTypeChooserDialogComponent", () => {
    it("renders the modal shell hidden initially (no dialog body)", async () => {
        const root = renderDialog();
        await flush();
        expect(getModal(root)).not.toBeNull();
        // show=false -> the inner .modal-dialog is not rendered.
        expect(root.querySelector(".modal-dialog")).toBeNull();
        expect(getNoteTypeItems).toHaveBeenCalledTimes(1);
    });

    it("opens on chooseNoteType: shows body, autocomplete and the mapped note-type list", async () => {
        getNoteTypeItems.mockResolvedValue(buildItems());
        const root = renderDialog();
        await flush();
        openDialog();

        expect(root.querySelector(".modal-dialog")).not.toBeNull();
        expect(root.querySelector("input.note-autocomplete")).not.toBeNull();

        // Two separators map to two headers ("Built-in Templates" / "Templates"); the explicit
        // header from getNoteTypeItems is rendered too -> 3 dropdown-header elements total.
        const headers = root.querySelectorAll(".dropdown-header");
        expect(headers.length).toBe(3);

        // Command items render as dropdown-item with the joined `type,templateNoteId` value.
        const items = root.querySelectorAll(".dropdown-item");
        expect(items.length).toBe(3);
        const values = Array.from(items).map((i) => i.getAttribute("data-value"));
        expect(values).toContain("text,");
        expect(values).toContain("doc,tplA");
        expect(values).toContain("text,tplB");

        // Badge from the built-in item renders inside its FormListItem.
        expect(root.querySelector(".dropdown-item .badge")).not.toBeNull();
    });

    it("turns each separator into a distinct header, in order", async () => {
        getNoteTypeItems.mockResolvedValue([
            { title: "Text", type: "text", uiIcon: "bx bx-note", badges: [] },
            { kind: "separator" },
            { title: "Doc", type: "doc", uiIcon: "bx bx-book", badges: [] },
            { kind: "separator" },
            { title: "Code", type: "code", uiIcon: "bx bx-code", badges: [] }
        ]);
        const root = renderDialog();
        await flush();
        openDialog();

        // Two separators -> two header rows (the index counter advances 0 then 1 across them).
        expect(root.querySelectorAll(".dropdown-header").length).toBe(2);
        // All three command items still render between/around the headers.
        expect(root.querySelectorAll(".dropdown-item").length).toBe(3);
    });

    it("handles a null result from getNoteTypeItems (no items rendered)", async () => {
        getNoteTypeItems.mockResolvedValue(null as unknown as MenuItem<TreeCommandNames>[]);
        const root = renderDialog();
        await flush();
        openDialog();

        expect(root.querySelector(".modal-dialog")).not.toBeNull();
        expect(root.querySelectorAll(".dropdown-item").length).toBe(0);
        expect(root.querySelectorAll(".dropdown-header").length).toBe(0);
    });

    it("selecting a note type calls the callback with type, template and current path, then hides", async () => {
        getNoteTypeItems.mockResolvedValue(buildItems());
        const root = renderDialog();
        await flush();
        const callback = openDialog();

        // Provide a parent note path via the autocomplete onChange.
        act(() => autocompleteOnChange?.({ notePath: "root/somewhere" }));

        expect(clickItem(root, "doc,tplA")).not.toBeNull();

        expect(callback).toHaveBeenCalledWith({
            success: true,
            noteType: "doc",
            templateNoteId: "tplA",
            notePath: "root/somewhere"
        });
        // setShown(false) -> Modal body unmounts.
        expect(root.querySelector(".modal-dialog")).toBeNull();
    });

    it("selecting a note type with no chosen parent passes an undefined notePath", async () => {
        getNoteTypeItems.mockResolvedValue(buildItems());
        const root = renderDialog();
        await flush();
        const callback = openDialog();

        clickItem(root, "text,");

        expect(callback).toHaveBeenCalledWith({
            success: true,
            noteType: "text",
            templateNoteId: "",
            notePath: undefined
        });
    });

    it("onHidden reports failure via the callback and unmounts the body", async () => {
        getNoteTypeItems.mockResolvedValue(buildItems());
        const root = renderDialog();
        await flush();
        const callback = openDialog();
        expect(root.querySelector(".modal-dialog")).not.toBeNull();

        fireModalEvent(root, "hidden.bs.modal");

        expect(callback).toHaveBeenCalledWith({ success: false });
        expect(root.querySelector(".modal-dialog")).toBeNull();
    });

    it("onShown focuses and selects the autocomplete input", async () => {
        getNoteTypeItems.mockResolvedValue(buildItems());
        const root = renderDialog();
        await flush();
        openDialog();

        const input = root.querySelector<HTMLInputElement>("input.note-autocomplete");
        expect(input).not.toBeNull();
        const focusSpy = input ? vi.spyOn(input, "focus") : undefined;

        // onShown calls refToJQuerySelector(autocompleteRef).trigger("focus").trigger("select").
        fireModalEvent(root, "shown.bs.modal");
        expect(focusSpy).toHaveBeenCalled();
    });

    it("tolerates being opened without any callback selection happening (selection no-op safe)", async () => {
        getNoteTypeItems.mockResolvedValue(buildItems());
        const root = renderDialog();
        await flush();

        // Open then immediately select an item; with the callback set this is the happy path, but
        // clicking a non-existent value must not throw.
        openDialog();
        expect(clickItem(root, "does,not-exist")).toBeNull();
        expect(root.querySelector(".modal-dialog")).not.toBeNull();
    });
});
