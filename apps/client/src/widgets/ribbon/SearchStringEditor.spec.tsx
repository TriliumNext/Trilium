import { render } from "preact";
import { act } from "preact/test-utils";
import { describe, expect, it, vi } from "vitest";

import Component from "../../components/component";
import { collectShortcutHints } from "../../services/shortcut_hints";
import { renderInto } from "../../test/render";
import { ParentComponent } from "../react/react_utils";
import SearchStringEditor from "./SearchStringEditor";

// The completions fetch attribute names and values through the server; nothing here opens the popup.
vi.mock("./search_completions", () => ({
    searchCompletionSource: () => null,
    searchCompletionIcon: () => undefined,
    searchCompletionReactivates: () => false
}));

describe("SearchStringEditor", () => {
    it("replaces the document when the ribbon switches notes, focused or not", async () => {
        const onChange = vi.fn();
        const { container, editor } = await mount({ noteId: "search1", currentValue: "#book", onChange });

        editor.focus();
        expect(editor.hasFocus).toBe(true);

        // The save echoing the typed text back leaves a focused editor alone, caret and all.
        editor.dispatch({ changes: { from: 5, insert: " #year" } });
        onChange.mockClear();
        rerender(container, { noteId: "search1", currentValue: "#book", onChange });
        expect(editor.state.doc.toString()).toBe("#book #year");

        // Adopting the new note's query is not an edit; reporting it would save that query
        // straight back over itself.
        rerender(container, { noteId: "search2", currentValue: "#author = tolkien", onChange });
        expect(editor.state.doc.toString()).toBe("#author = tolkien");
        expect(onChange).not.toHaveBeenCalled();
    });

    it("follows a value that changed outside an unfocused editor, and reports what is typed", async () => {
        const onChange = vi.fn();
        const { container, editor } = await mount({ noteId: "search1", currentValue: "#book", onChange });

        rerender(container, { noteId: "search1", currentValue: "#book #year", onChange });
        expect(editor.state.doc.toString()).toBe("#book #year");
        expect(onChange).not.toHaveBeenCalled();

        editor.dispatch({ changes: { from: 11, insert: " = 1954" } });
        expect(onChange).toHaveBeenCalledWith("#book #year = 1954");
    });
    it("registers the keys the field answers on the host component", () => {
        const host = new Component();
        act(() => {
            renderInto(
                <ParentComponent.Provider value={host}>
                    <SearchStringEditor noteId="search1" currentValue="#book" onChange={() => {}} onEnter={() => {}} />
                </ParentComponent.Provider>
            );
        });

        expect(collectShortcutHints(host)).toEqual([
            {
                titleKey: "search_string.hints.title",
                hints: [
                    { keys: ["Ctrl+Space"], labelKey: "search_string.hints.completions" },
                    { keys: ["Shift+Enter"], labelKey: "search_string.hints.new_line" },
                    { keys: ["Enter"], labelKey: "search_string.hints.run_search" }
                ]
            }
        ]);
    });
});

interface Props {
    noteId: string;
    currentValue: string;
    onChange: (value: string) => void;
}

/** Renders the editor and waits for the CodeMirror modules it imports on demand. */
async function mount(props: Props) {
    const container = renderInto(<SearchStringEditor {...props} onEnter={() => {}} />);

    const { EditorView } = await import("@codemirror/view");
    let editor: InstanceType<typeof EditorView> | null = null;
    for (let attempt = 0; attempt < 50 && !editor; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, 1));
        const dom = container.querySelector(".cm-editor");
        editor = dom instanceof HTMLElement ? EditorView.findFromDOM(dom) : null;
    }

    if (!editor) {
        throw new Error(`The editor did not mount: ${container.innerHTML}`);
    }

    return { container, editor };
}

function rerender(container: HTMLDivElement, props: Props) {
    act(() => {
        render(<SearchStringEditor {...props} onEnter={() => {}} />, container);
    });
}
