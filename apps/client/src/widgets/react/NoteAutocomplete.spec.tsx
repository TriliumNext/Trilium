import { createRef } from "preact";
import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { renderInto } from "../../test/render";

// --- Module mocks (hoisted above the component import) --------------------------------------------

vi.mock("../../services/i18n", () => ({
    t: (key: string) => key
}));

vi.mock("../../services/note_autocomplete", () => ({
    default: {
        initNoteAutocomplete: vi.fn(),
        setText: vi.fn()
    }
}));

import note_autocomplete from "../../services/note_autocomplete";
import NoteAutocomplete from "./NoteAutocomplete";

// --- jQuery $.fn stubs ----------------------------------------------------------------------------
// The component calls a number of jQuery plugin methods (.setNote/.getSelectedNoteId/...) that are
// normally registered by note_autocomplete.init(). We install lightweight stubs and restore them.

interface SavedFns {
    setNote?: unknown;
    getSelectedNoteId?: unknown;
    setSelectedNotePath?: unknown;
    autocomplete?: unknown;
}

const saved: SavedFns = {};
let setNoteCalls: Array<string> = [];
let setSelectedNotePathCalls: Array<string | null | undefined> = [];
let autocompleteCalls: Array<unknown[]> = [];
let selectedNoteIdToReturn: string | null = null;

function installFnStubs() {
    saved.setNote = $.fn.setNote;
    saved.getSelectedNoteId = $.fn.getSelectedNoteId;
    saved.setSelectedNotePath = $.fn.setSelectedNotePath;
    saved.autocomplete = $.fn.autocomplete;

    $.fn.setNote = function (noteId: string) {
        setNoteCalls.push(noteId);
        return this;
    };
    $.fn.getSelectedNoteId = function () {
        return selectedNoteIdToReturn;
    };
    $.fn.setSelectedNotePath = function (notePath?: string | null) {
        setSelectedNotePathCalls.push(notePath);
        return this;
    };
    $.fn.autocomplete = function (...args: unknown[]) {
        autocompleteCalls.push(args);
        return this;
    };
}

function restoreFnStubs() {
    $.fn.setNote = saved.setNote as typeof $.fn.setNote;
    $.fn.getSelectedNoteId = saved.getSelectedNoteId as typeof $.fn.getSelectedNoteId;
    $.fn.setSelectedNotePath = saved.setSelectedNotePath as typeof $.fn.setSelectedNotePath;
    $.fn.autocomplete = saved.autocomplete as typeof $.fn.autocomplete;
}

// --- render helper --------------------------------------------------------------------------------

function rerender(root: HTMLElement, vnode: ReturnType<typeof NoteAutocomplete>) {
    act(() => {
        render(vnode, root);
    });
}

function getInput(root: HTMLElement) {
    const input = root.querySelector("input.note-autocomplete");
    if (!(input instanceof HTMLInputElement)) throw new Error("input not found");
    return input;
}

beforeEach(() => {
    setNoteCalls = [];
    setSelectedNotePathCalls = [];
    autocompleteCalls = [];
    selectedNoteIdToReturn = null;
    vi.clearAllMocks();
    installFnStubs();
});

afterEach(() => {
    restoreFnStubs();
});

describe("NoteAutocomplete", () => {
    it("renders the input-group wrapper, the autocomplete input and the fallback placeholder", () => {
        const root = renderInto(<NoteAutocomplete id="my-input" />);

        const group = root.querySelector("div.input-group");
        expect(group).toBeTruthy();

        const input = getInput(root);
        expect(input.id).toBe("my-input");
        expect(input.className).toContain("note-autocomplete");
        expect(input.className).toContain("form-control");
        // i18n is mocked to echo the key.
        expect(input.getAttribute("placeholder")).toBe("add_link.search_note");

        // initNoteAutocomplete must have been wired up against the input.
        expect(note_autocomplete.initNoteAutocomplete).toHaveBeenCalledTimes(1);
    });

    it("uses an explicit placeholder and applies the container style", () => {
        const root = renderInto(
            <NoteAutocomplete placeholder="Pick one" containerStyle={{ width: "200px" }} />
        );
        const input = getInput(root);
        expect(input.getAttribute("placeholder")).toBe("Pick one");

        const group = root.querySelector("div.input-group");
        expect(group instanceof HTMLElement && group.style.width).toBe("200px");
    });

    it("passes opts and the container element into initNoteAutocomplete", () => {
        const containerEl = document.createElement("div");
        const containerRef = { current: containerEl };
        renderInto(
            <NoteAutocomplete opts={{ allowCreatingNotes: true }} container={containerRef} />
        );

        const mock = vi.mocked(note_autocomplete.initNoteAutocomplete);
        expect(mock).toHaveBeenCalledTimes(1);
        const passedOpts = mock.mock.calls[0]?.[1];
        expect(passedOpts).toMatchObject({ allowCreatingNotes: true, container: containerEl });
    });

    it("syncs the provided external input ref to the underlying input element", () => {
        const externalRef = createRef<HTMLInputElement>();
        const root = renderInto(<NoteAutocomplete inputRef={externalRef} />);
        expect(externalRef.current).toBe(getInput(root));
    });

    it("fires onTextChange when the input receives an input event", () => {
        const onTextChange = vi.fn();
        const root = renderInto(<NoteAutocomplete onTextChange={onTextChange} />);
        const input = getInput(root);

        input.value = "hello";
        $(input).trigger("input");

        expect(onTextChange).toHaveBeenCalledWith("hello");
    });

    it("forwards the native keydown event to onKeyDown", () => {
        const onKeyDown = vi.fn();
        const root = renderInto(<NoteAutocomplete onKeyDown={onKeyDown} />);
        const input = getInput(root);

        const nativeEvent = new KeyboardEvent("keydown", { key: "Enter", bubbles: true });
        input.dispatchEvent(nativeEvent);

        expect(onKeyDown).toHaveBeenCalledTimes(1);
        const received = onKeyDown.mock.calls[0]?.[0];
        expect(received instanceof KeyboardEvent && received.key).toBe("Enter");
    });

    it("calls onBlur with the selected note id from getSelectedNoteId", () => {
        selectedNoteIdToReturn = "note123";
        const onBlur = vi.fn();
        const root = renderInto(<NoteAutocomplete onBlur={onBlur} />);
        const input = getInput(root);

        $(input).trigger("blur");
        expect(onBlur).toHaveBeenCalledWith("note123");
    });

    it("calls onBlur with empty string when no note is selected", () => {
        selectedNoteIdToReturn = null;
        const onBlur = vi.fn();
        const root = renderInto(<NoteAutocomplete onBlur={onBlur} />);
        const input = getInput(root);

        $(input).trigger("blur");
        expect(onBlur).toHaveBeenCalledWith("");
    });

    it("invokes onChange and noteIdChanged from a noteselected event using the note path tail", () => {
        const onChange = vi.fn();
        const noteIdChanged = vi.fn();
        const root = renderInto(
            <NoteAutocomplete onChange={onChange} noteIdChanged={noteIdChanged} />
        );
        const input = getInput(root);

        const suggestion = { notePath: "root/parent/childNoteId", noteTitle: "Child" };
        $(input).trigger("autocomplete:noteselected", [suggestion]);

        expect(onChange).toHaveBeenCalledWith(suggestion);
        expect(noteIdChanged).toHaveBeenCalledWith("childNoteId");
    });

    it("handles externallinkselected and commandselected events through the same listener", () => {
        const onChange = vi.fn();
        const root = renderInto(<NoteAutocomplete onChange={onChange} />);
        const input = getInput(root);

        const linkSuggestion = { externalLink: "https://example.com" };
        $(input).trigger("autocomplete:externallinkselected", [linkSuggestion]);
        expect(onChange).toHaveBeenCalledWith(linkSuggestion);

        const commandSuggestion = { action: "command", commandId: "abc" };
        $(input).trigger("autocomplete:commandselected", [commandSuggestion]);
        expect(onChange).toHaveBeenCalledWith(commandSuggestion);
    });

    it("only calls noteIdChanged (not requiring onChange) and clears on an empty change event", () => {
        const noteIdChanged = vi.fn();
        const root = renderInto(<NoteAutocomplete noteIdChanged={noteIdChanged} />);
        const input = getInput(root);

        // Empty value -> the change listener forwards a null suggestion.
        input.value = "";
        $(input).trigger("change");

        // noteId derived from a null suggestion is undefined.
        expect(noteIdChanged).toHaveBeenCalledWith(undefined);
    });

    it("does not forward a change event when the input still has a value", () => {
        const onChange = vi.fn();
        const root = renderInto(<NoteAutocomplete onChange={onChange} />);
        const input = getInput(root);

        input.value = "still typing";
        $(input).trigger("change");

        expect(onChange).not.toHaveBeenCalled();
    });

    it("sets the note via setNote when a noteId prop is supplied", () => {
        renderInto(<NoteAutocomplete noteId="abc123" />);
        expect(setNoteCalls).toContain("abc123");
        // text branch should not have been taken.
        expect(note_autocomplete.setText).not.toHaveBeenCalled();
    });

    it("sets text via the service when only text is supplied", () => {
        renderInto(<NoteAutocomplete text="some text" />);
        expect(note_autocomplete.setText).toHaveBeenCalledTimes(1);
        const args = vi.mocked(note_autocomplete.setText).mock.calls[0];
        expect(args?.[1]).toBe("some text");
        expect(setNoteCalls).toHaveLength(0);
    });

    it("clears the field when neither noteId nor text are supplied", () => {
        const root = renderInto(<NoteAutocomplete />);
        const input = getInput(root);

        // The clear branch resets the value, the selected path and calls autocomplete("val", "").
        expect(input.value).toBe("");
        expect(setSelectedNotePathCalls).toContain("");
        expect(autocompleteCalls.some((args) => args[0] === "val" && args[1] === "")).toBe(true);
    });

    it("re-runs the noteId/text effect and switches branches when props change", () => {
        const root = renderInto(<NoteAutocomplete noteId="first" />);
        expect(setNoteCalls).toContain("first");

        rerender(root, <NoteAutocomplete text="now text" />);
        expect(note_autocomplete.setText).toHaveBeenCalled();

        rerender(root, <NoteAutocomplete />);
        const input = getInput(root);
        expect(input.value).toBe("");
    });

    it("removes the change listeners when the component unmounts", () => {
        const onChange = vi.fn();
        const root = renderInto(<NoteAutocomplete onChange={onChange} />);
        const input = getInput(root);

        act(() => { render(null, root); });

        // After unmount the listeners are detached; firing should not call onChange.
        $(input).trigger("autocomplete:noteselected", [{ notePath: "root/x" }]);
        expect(onChange).not.toHaveBeenCalled();
    });
});
