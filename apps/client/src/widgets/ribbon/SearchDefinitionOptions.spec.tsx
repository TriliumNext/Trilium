import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import FNote from "../../entities/fnote";
import attributes from "../../services/attributes";
import { renderInto } from "../../test/render";
import { SEARCH_OPTIONS } from "./SearchDefinitionOptions";

// Stands in for the CodeMirror editor, which loads on demand and is covered by its own spec.
let editorProps: { noteId: string, currentValue: string, onChange(value: string): void } | undefined;
vi.mock("./SearchStringEditor", () => ({
    default: (props: { noteId: string, currentValue: string, onChange(value: string): void }) => {
        editorProps = props;
        return <input />;
    }
}));

beforeEach(() => {
    vi.useFakeTimers();
    editorProps = undefined;
    vi.spyOn(attributes, "setLabel").mockResolvedValue(undefined);
});

afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
});

describe("the search string option", () => {
    it("saves a change still pending at a note switch against the note it was typed into", () => {
        const container = renderOption(noteWith("search1", "#book"));

        act(() => editorProps?.onChange("#book #year"));
        // The switch lands inside the debounce interval, so the change has not been written yet.
        expect(attributes.setLabel).not.toHaveBeenCalled();

        renderOption(noteWith("search2", "#author"), container);
        act(() => void vi.advanceTimersByTime(5000));

        expect(attributes.setLabel).toHaveBeenCalledTimes(1);
        expect(attributes.setLabel).toHaveBeenCalledWith("search1", "searchString", "#book #year");
        // The editor is handed the note now displayed, so what it shows is that note's query.
        expect(editorProps?.noteId).toBe("search2");
        expect(editorProps?.currentValue).toBe("#author");
    });

    it("writes a change made after the switch to the note now displayed", () => {
        const container = renderOption(noteWith("search1", "#book"));

        renderOption(noteWith("search2", "#author"), container);
        act(() => editorProps?.onChange("#author = tolkien"));
        act(() => void vi.advanceTimersByTime(5000));

        expect(attributes.setLabel).toHaveBeenCalledTimes(1);
        expect(attributes.setLabel).toHaveBeenCalledWith("search2", "searchString", "#author = tolkien");
    });
});

function noteWith(noteId: string, searchString: string) {
    return {
        noteId,
        title: noteId,
        getLabelValue: (name: string) => (name === "searchString" ? searchString : null),
        getAttribute: () => undefined,
        getAttributes: () => []
    } as unknown as FNote;
}

function renderOption(note: FNote, container?: HTMLDivElement) {
    const option = SEARCH_OPTIONS.find(({ attributeName }) => attributeName === "searchString");
    if (!option) {
        throw new Error("The search string option is missing from SEARCH_OPTIONS.");
    }

    const Component = option.component;
    const vnode = (
        <table><tbody>
            <Component
                note={note}
                refreshResults={() => {}}
                attributeName="searchString"
                attributeType="label"
            />
        </tbody></table>
    );

    if (container) {
        act(() => render(vnode, container));
        return container;
    }

    let rendered: HTMLDivElement | undefined;
    act(() => {
        rendered = renderInto(vnode);
    });

    if (!rendered) {
        throw new Error("The option did not render.");
    }

    return rendered;
}
