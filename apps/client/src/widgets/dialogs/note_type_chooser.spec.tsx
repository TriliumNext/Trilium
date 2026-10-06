import { render } from "preact";
import { useEffect, useRef } from "preact/hooks";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import Component from "../../components/component";
import { ParentComponent } from "../react/react_utils";

vi.mock("bootstrap", () => ({
    Dropdown: { getOrCreateInstance: () => ({ dispose() {} }) },
    Tooltip: class { static getInstance() { return null; } }
}));

vi.mock("../../services/i18n", () => ({
    t: (key: string) => key
}));

/** The note types as the menus lay them out: a submenu of languages and one of templates. */
const noteTypeItems = vi.hoisted(() => {
    const items = [
        { title: "Text", type: "text", uiIcon: "bx bx-note" },
        {
            title: "Code", type: "code", mime: "text/plain", uiIcon: "bx bx-code", items: [
                { title: "Plain text", type: "code", mime: "text/plain" },
                { title: "Python", type: "code", mime: "text/x-python" }
            ]
        },
        { kind: "separator" },
        { title: "note_types.book", uiIcon: "bx bx-book", items: [ { title: "Board", type: "book", templateNoteId: "_template_board" } ] }
    ];
    let resolveItems: (value: typeof items) => void = () => {};
    let promise = Promise.resolve(items);

    return {
        resetDeferred() {
            promise = new Promise((resolve) => {
                resolveItems = resolve;
            });
        },
        resolve() {
            resolveItems(items);
            return promise;
        },
        get() {
            return promise;
        }
    };
});

vi.mock("../../services/note_types", () => ({
    default: {
        loadNoteTypeData: () => noteTypeItems.get(),
        buildNoteTypeItems: (data: unknown) => data
    }
}));

vi.mock("../react/NoteAutocomplete", () => ({
    default: function NoteAutocompleteStub() {
        return <input className="note-autocomplete" />;
    }
}));

vi.mock("../react/Modal", () => ({
    default: function ModalStub({
        show, children, onShown, modalRef, className
    }: {
        show: boolean;
        children: preact.ComponentChildren;
        onShown?: () => void;
        modalRef?: { current: HTMLDivElement | null };
        className: string;
    }) {
        const ref = useRef<HTMLDivElement>(null);

        useEffect(() => {
            if (modalRef) {
                modalRef.current = ref.current;
            }
            if (show) {
                onShown?.();
            }
        });

        if (!show) {
            return null;
        }

        return <div className={className} ref={ref}>{children}</div>;
    }
}));

import NoteTypeChooserDialogComponent from "./note_type_chooser";

describe("NoteTypeChooserDialog", () => {
    let container: HTMLElement;
    let host: Component;

    beforeEach(() => {
        noteTypeItems.resetDeferred();
        container = document.createElement("div");
        document.body.appendChild(container);
        host = new Component();

        act(() => {
            render(
                <ParentComponent.Provider value={host}>
                    <NoteTypeChooserDialogComponent />
                </ParentComponent.Provider>,
                container
            );
        });
    });

    afterEach(() => {
        render(null, container);
        container.remove();
    });

    it("starts at Text, so Enter creates a text note", async () => {
        const callback = await openChooser();
        await resolveNoteTypes();

        await vi.waitFor(() => expect(activeRow()).toBe("Text"));
        expect(document.activeElement).toBe(menu());
        key("Enter");

        expect(callback).toHaveBeenCalledExactlyOnceWith({
            success: true,
            noteType: "text",
            mime: undefined,
            templateNoteId: undefined,
            notePath: undefined
        });
    });

    it("does not steal focus from the parent-path field when types arrive late", async () => {
        await openChooser();

        const input = parentPathInput();
        input.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
        input.focus();
        expect(document.activeElement).toBe(input);

        await resolveNoteTypes();

        await vi.waitFor(() => expect(menu()).not.toBeNull());
        expect(document.activeElement).toBe(input);
    });

    it("lists the note types as the menus do, and filters them, nested ones included", async () => {
        const callback = await openChooser();
        await resolveNoteTypes();
        await vi.waitFor(() => expect(activeRow()).toBe("Text"));

        // In the dialog's flow, where the list of types stood, rather than beside an anchor.
        expect(menu()?.classList.contains("tn-menu-inline")).toBe(true);
        expect(menu()?.parentElement?.classList.contains("note-type-chooser-list")).toBe(true);
        // The submenus of the menus, and the input that filters through them.
        expect(menu()?.querySelectorAll("li.dropdown-submenu")).toHaveLength(2);
        const filter = () => menu()?.querySelector<HTMLInputElement>("input.tn-menu-filter-input");
        expect(filter()).not.toBeNull();

        key("p");
        await vi.waitFor(() => expect(document.activeElement).toBe(filter()));
        const input = filter();
        if (!input) throw new Error("no filter input");
        input.value = "pyt";
        input.dispatchEvent(new Event("input", { bubbles: true }));
        await vi.waitFor(() => expect(activeRow()).toMatch(/^Python/));
        key("Enter");

        // A language is a code note of its own MIME type.
        expect(callback).toHaveBeenCalledExactlyOnceWith({
            success: true,
            noteType: "code",
            mime: "text/x-python",
            templateNoteId: undefined,
            notePath: undefined
        });
    });

    it("hands back the template of a collection, and closes on Escape", async () => {
        const callback = await openChooser();
        await resolveNoteTypes();
        await vi.waitFor(() => expect(activeRow()).toBe("Text"));

        key("b");
        const input = () => menu()?.querySelector<HTMLInputElement>("input.tn-menu-filter-input");
        await vi.waitFor(() => expect(document.activeElement).toBe(input()));
        await vi.waitFor(() => expect(activeRow()).toMatch(/^Board/));
        key("Enter");
        expect(callback).toHaveBeenCalledWith(expect.objectContaining({
            success: true, noteType: "book", templateNoteId: "_template_board"
        }));
        await vi.waitFor(() => expect(menu()).toBeNull());

        await openChooser();
        await vi.waitFor(() => expect(activeRow()).toBe("Text"));
        key("Escape");
        await vi.waitFor(() => expect(menu()).toBeNull());
    });

    async function openChooser(callback = vi.fn()) {
        await act(async () => {
            await host.handleEventInChildren("chooseNoteType", { callback });
        });
        return callback;
    }

    async function resolveNoteTypes() {
        await act(async () => {
            await noteTypeItems.resolve();
        });
    }

    function menu() {
        return container.querySelector<HTMLElement>(".note-type-chooser-dialog [role=menu].tn-menu");
    }

    function key(name: string) {
        const event = new KeyboardEvent("keydown", { key: name, bubbles: true, cancelable: true });
        (document.activeElement ?? document.body).dispatchEvent(event);
        return event;
    }

    /** The active row's text, as the menu names it to assistive technology. */
    function activeRow() {
        const id = menu()?.getAttribute("aria-activedescendant");
        return (id ? document.getElementById(id) : null)?.textContent ?? null;
    }

    function parentPathInput() {
        const input = container.querySelector<HTMLInputElement>(".note-autocomplete");
        if (!input) {
            throw new Error("The parent-path field was missing.");
        }
        return input;
    }
});
