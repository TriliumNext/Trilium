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

const noteTypeItems = vi.hoisted(() => {
    const items = [
        { title: "Text", type: "text", uiIcon: "bx bx-note" },
        { title: "Code", type: "code", uiIcon: "bx bx-code" }
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
        getNoteTypeItems: () => noteTypeItems.get()
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

    it("focuses Text on open so Enter creates a text note", async () => {
        const callback = vi.fn();

        await openChooser(callback);
        await resolveNoteTypes();

        const item = textItem();
        expect(item).not.toBeNull();
        expect(document.activeElement).toBe(item);

        item?.dispatchEvent(new KeyboardEvent("keydown", {
            key: "Enter",
            bubbles: true,
            cancelable: true
        }));

        expect(callback).toHaveBeenCalledExactlyOnceWith({
            success: true,
            noteType: "text",
            templateNoteId: "",
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

        expect(textItem()).not.toBeNull();
        expect(document.activeElement).toBe(input);
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

    function textItem() {
        return container.querySelector<HTMLElement>('.dropdown-item[data-value="text,"]');
    }

    function parentPathInput() {
        const input = container.querySelector<HTMLInputElement>(".note-autocomplete");
        if (!input) {
            throw new Error("The parent-path field was missing.");
        }
        return input;
    }
});
