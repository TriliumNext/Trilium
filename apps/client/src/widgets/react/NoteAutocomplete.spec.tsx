import $ from "jquery";
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const {
    initNoteAutocompleteSpy,
    setTextSpy,
    clearTextSpy,
    destroyAutocompleteSpy
} = vi.hoisted(() => ({
    initNoteAutocompleteSpy: vi.fn(($el) => $el),
    setTextSpy: vi.fn(),
    clearTextSpy: vi.fn(),
    destroyAutocompleteSpy: vi.fn()
}));

vi.mock("../../services/i18n", () => ({
    t: (key: string) => key
}));

vi.mock("../../services/note_autocomplete", () => ({
    __esModule: true,
    default: {
        initNoteAutocomplete: initNoteAutocompleteSpy,
        setText: setTextSpy,
        clearText: clearTextSpy,
        destroyAutocomplete: destroyAutocompleteSpy
    }
}));

import NoteAutocomplete from "./NoteAutocomplete";

describe("NoteAutocomplete", () => {
    let container: HTMLDivElement;
    let setNoteSpy: ReturnType<typeof vi.fn>;
    let getSelectedNoteIdSpy: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        vi.clearAllMocks();
        container = document.createElement("div");
        document.body.appendChild(container);

        setNoteSpy = vi.fn(() => Promise.resolve());
        getSelectedNoteIdSpy = vi.fn(() => "selected-note-id");

        ($.fn as any).setNote = setNoteSpy;
        ($.fn as any).getSelectedNoteId = getSelectedNoteIdSpy;
    });

    afterEach(() => {
        act(() => {
            render(null, container);
        });
        container.remove();
    });

    it("syncs text props through the headless helper functions", () => {
        act(() => {
            render(<NoteAutocomplete text="hello" />, container);
        });

        const input = container.querySelector("input") as HTMLInputElement;

        expect(initNoteAutocompleteSpy).toHaveBeenCalledTimes(1);
        expect(initNoteAutocompleteSpy.mock.calls[0][0][0]).toBe(input);
        expect(setTextSpy).toHaveBeenCalledTimes(1);
        expect(setTextSpy.mock.calls[0][0][0]).toBe(input);
        expect(setTextSpy).toHaveBeenCalledWith(expect.anything(), "hello");

        act(() => {
            render(<NoteAutocomplete text="" />, container);
        });

        expect(clearTextSpy).toHaveBeenCalled();
    });

    it("syncs noteId props through the jQuery setNote extension", () => {
        act(() => {
            render(<NoteAutocomplete noteId="note-123" />, container);
        });

        expect(setNoteSpy).toHaveBeenCalledWith("note-123");
        expect(clearTextSpy).not.toHaveBeenCalled();
    });

    it("forwards autocomplete selection and clear events to consumers", () => {
        const onChange = vi.fn();
        const noteIdChanged = vi.fn();

        act(() => {
            render(<NoteAutocomplete onChange={onChange} noteIdChanged={noteIdChanged} />, container);
        });

        const input = container.querySelector("input") as HTMLInputElement;
        const $input = $(input);
        const suggestion = { notePath: "root/child-note", noteTitle: "Child note" };

        $input.trigger("autocomplete:noteselected", [suggestion]);

        expect(onChange).toHaveBeenCalledWith(suggestion);
        expect(noteIdChanged).toHaveBeenCalledWith("child-note");

        input.value = "";
        $input.trigger("change");

        expect(onChange).toHaveBeenCalledWith(null);
    });

    it("forwards onTextChange, onKeyDown and onBlur events", () => {
        const onTextChange = vi.fn();
        const onKeyDown = vi.fn();
        const onBlur = vi.fn();

        act(() => {
            render(
                <NoteAutocomplete
                    onTextChange={onTextChange}
                    onKeyDown={onKeyDown}
                    onBlur={onBlur}
                />,
                container
            );
        });

        const input = container.querySelector("input") as HTMLInputElement;
        const $input = $(input);

        input.value = "typed text";
        $input.trigger("input");
        $input.trigger($.Event("keydown", { originalEvent: new KeyboardEvent("keydown", { key: "Enter" }) }));
        $input.trigger("blur");

        expect(onTextChange).toHaveBeenCalledWith("typed text");
        expect(onKeyDown).toHaveBeenCalledWith(expect.any(KeyboardEvent));
        expect(onBlur).toHaveBeenCalledWith("selected-note-id");
    });

    it("destroys the autocomplete instance on unmount", () => {
        act(() => {
            render(<NoteAutocomplete />, container);
        });

        const input = container.querySelector("input") as HTMLInputElement;

        act(() => {
            render(null, container);
        });

        expect(destroyAutocompleteSpy).toHaveBeenCalledWith(input);
    });
});
