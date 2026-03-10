import $ from "jquery";
import type { ComponentChildren } from "preact";
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
    triliumEventHandlers,
    latestModalPropsRef,
    latestNoteAutocompletePropsRef,
    addLinkSpy,
    logErrorSpy,
    showRecentNotesSpy,
    setTextSpy
} = vi.hoisted(() => ({
    triliumEventHandlers: new Map<string, (payload: any) => void>(),
    latestModalPropsRef: { current: null as any },
    latestNoteAutocompletePropsRef: { current: null as any },
    addLinkSpy: vi.fn(() => Promise.resolve()),
    logErrorSpy: vi.fn(),
    showRecentNotesSpy: vi.fn(),
    setTextSpy: vi.fn()
}));

vi.mock("../../services/i18n", () => ({
    t: (key: string) => key
}));

vi.mock("../../services/tree", () => ({
    default: {
        getNoteIdFromUrl: (notePath: string) => notePath.split("/").at(-1),
        getNoteTitle: vi.fn(async () => "Target note")
    }
}));

vi.mock("../../services/ws", () => ({
    logError: logErrorSpy
}));

vi.mock("../../services/note_autocomplete", () => ({
    __esModule: true,
    default: {
        showRecentNotes: showRecentNotesSpy,
        setText: setTextSpy
    }
}));

vi.mock("../react/react_utils", () => ({
    refToJQuerySelector: (ref: { current: HTMLInputElement | null }) => $(ref.current)
}));

vi.mock("../react/hooks", () => ({
    useTriliumEvent: (name: string, handler: (payload: any) => void) => {
        triliumEventHandlers.set(name, handler);
    }
}));

vi.mock("../react/Modal", () => ({
    default: (props: any) => {
        latestModalPropsRef.current = props;

        if (!props.show) {
            return null;
        }

        return (
            <form onSubmit={(e) => {
                e.preventDefault();
                props.onSubmit?.();
            }}>
                {props.children}
                {props.footer}
            </form>
        );
    }
}));

vi.mock("../react/FormGroup", () => ({
    default: ({ children }: { children: ComponentChildren }) => <div>{children}</div>
}));

vi.mock("../react/Button", () => ({
    default: ({ text }: { text: string }) => <button type="submit">{text}</button>
}));

vi.mock("../react/FormRadioGroup", () => ({
    default: () => null
}));

vi.mock("../react/NoteAutocomplete", () => ({
    default: (props: any) => {
        latestNoteAutocompletePropsRef.current = props;
        return <input ref={props.inputRef} />;
    }
}));

import AddLinkDialog from "./add_link";

describe("AddLinkDialog", () => {
    let container: HTMLDivElement;

    beforeEach(() => {
        vi.clearAllMocks();
        latestModalPropsRef.current = null;
        latestNoteAutocompletePropsRef.current = null;
        triliumEventHandlers.clear();
        container = document.createElement("div");
        document.body.appendChild(container);
    });

    afterEach(() => {
        act(() => {
            render(null, container);
        });
        container.remove();
    });

    it("submits the selected note when Enter picks an autocomplete suggestion", async () => {
        act(() => {
            render(<AddLinkDialog />, container);
        });

        const showDialog = triliumEventHandlers.get("showAddLinkDialog");
        expect(showDialog).toBeTypeOf("function");

        await act(async () => {
            showDialog?.({
                text: "",
                hasSelection: false,
                addLink: addLinkSpy
            });
        });

        const suggestion = {
            notePath: "root/target-note",
            noteTitle: "Target note"
        };

        act(() => {
            latestNoteAutocompletePropsRef.current.onKeyDownCapture({
                key: "Enter",
                ctrlKey: false,
                metaKey: false,
                shiftKey: false,
                altKey: false,
                isComposing: false
            });
            latestNoteAutocompletePropsRef.current.onChange(suggestion);
        });

        expect(latestModalPropsRef.current.show).toBe(false);
        expect(logErrorSpy).not.toHaveBeenCalled();

        await act(async () => {
            latestModalPropsRef.current.onHidden();
        });

        expect(addLinkSpy).toHaveBeenCalledWith("root/target-note", null);
    });
});
