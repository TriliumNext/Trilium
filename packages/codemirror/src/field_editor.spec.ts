import { EditorSelection } from "@codemirror/state";
import { afterEach, describe, expect, it, vi } from "vitest";

import { createFieldEditor, type FieldEditor, type FieldEditorConfig } from "./field_editor.js";

let editor: FieldEditor | undefined;

afterEach(() => {
    editor?.destroy();
    editor = undefined;
});

describe("createFieldEditor", () => {
    it("mounts with the given document and reports every change", () => {
        const onChange = vi.fn();
        const parent = document.createElement("div");
        document.body.appendChild(parent);
        editor = createFieldEditor({ parent, doc: "#book", onChange });

        expect(parent.contains(editor.dom)).toBe(true);
        expect(editor.state.doc.toString()).toBe("#book");
        // The initial document is not a change.
        expect(onChange).not.toHaveBeenCalled();

        editor.dispatch({ changes: { from: 5, insert: " #year = 1954" } });

        expect(onChange).toHaveBeenCalledWith("#book #year = 1954");
    });

    it("treats Enter as a command rather than a line break", () => {
        const onEnter = vi.fn();
        editor = build({ doc: "#book", onEnter });
        editor.dispatch({ selection: EditorSelection.cursor(5) });

        expect(pressKey(editor, "Enter")).toBe(true);
        expect(onEnter).toHaveBeenCalledOnce();
        expect(editor.state.doc.toString()).toBe("#book");
    });

    it("breaks the line on Shift-Enter, keeping the indentation", () => {
        const onEnter = vi.fn();
        const onChange = vi.fn();
        editor = build({ doc: "#book\n    and #author", onEnter, onChange });
        editor.dispatch({ selection: EditorSelection.cursor(editor.state.doc.length) });

        expect(pressKey(editor, "Enter", { shiftKey: true })).toBe(true);
        expect(onEnter).not.toHaveBeenCalled();
        expect(editor.state.doc.toString()).toBe("#book\n    and #author\n    ");
        expect(onChange).toHaveBeenLastCalledWith("#book\n    and #author\n    ");
    });

    it("answers ArrowDown and Escape, which then reach the caret no further", () => {
        const onArrowDown = vi.fn().mockReturnValue(true);
        const onEscape = vi.fn().mockReturnValue(true);
        editor = build({ doc: "#book\n#year", onArrowDown, onEscape });
        editor.dispatch({ selection: EditorSelection.cursor(0) });

        expect(pressKey(editor, "ArrowDown")).toBe(true);
        expect(onArrowDown).toHaveBeenCalledOnce();
        // Claimed by the field, so the caret stayed on the first line.
        expect(editor.state.selection.main.head).toBe(0);

        expect(pressKey(editor, "Escape")).toBe(true);
        expect(onEscape).toHaveBeenCalledOnce();
    });

    it("leaves a declined ArrowDown to the caret", () => {
        const onArrowDown = vi.fn().mockReturnValue(false);
        editor = build({ doc: "#book\n#year", onArrowDown });
        editor.dispatch({ selection: EditorSelection.cursor(0) });

        pressKey(editor, "ArrowDown");

        expect(onArrowDown).toHaveBeenCalledOnce();
        expect(editor.state.selection.main.head).toBeGreaterThan(0);
    });

    it("holds a single-line field to one line, flattening the breaks in what is inserted", () => {
        const onChange = vi.fn();
        editor = build({ singleLine: true, onChange });

        editor.dispatch({ changes: { from: 0, insert: "#book\n  #year = 1954" } });

        expect(editor.state.doc.lines).toBe(1);
        expect(editor.state.doc.toString()).toBe("#book   #year = 1954");
        expect(onChange).toHaveBeenLastCalledWith("#book   #year = 1954");
        expect(editor.state.selection.main.head).toBe(editor.state.doc.length);

        // Shift-Enter is swallowed, rather than reaching the field as the flattened indentation.
        expect(pressKey(editor, "Enter", { shiftKey: true })).toBe(true);
        expect(editor.state.doc.toString()).toBe("#book   #year = 1954");

        // A change already on one line is left as it was written, as is one that edits no text.
        editor.dispatch({ changes: { from: 0, insert: "@" } });
        editor.dispatch({ selection: EditorSelection.cursor(0) });
        expect(editor.state.doc.toString()).toBe("@#book   #year = 1954");
        expect(editor.state.selection.main.head).toBe(0);
    });

    it("leaves the keys it claims to an IME while it is composing", () => {
        const onEnter = vi.fn();
        const onArrowDown = vi.fn().mockReturnValue(true);
        editor = build({ doc: "#book\n#year", onEnter, onArrowDown });
        editor.dispatch({ selection: EditorSelection.cursor(0) });
        Object.defineProperty(editor, "composing", { get: () => true });

        pressKey(editor, "Enter");
        pressKey(editor, "ArrowDown");

        expect(onEnter).not.toHaveBeenCalled();
        expect(onArrowDown).not.toHaveBeenCalled();
    });

    it("draws the placeholder and names the field for assistive technology", () => {
        editor = build({ placeholder: "Search", ariaLabel: "Search string" });

        expect(editor.dom.querySelector(".cm-placeholder")?.textContent).toBe("Search");
        expect(editor.contentDOM.getAttribute("aria-label")).toBe("Search string");
    });

    it("keeps the line breaks in inserted text", () => {
        const onChange = vi.fn();
        editor = build({ onChange });

        editor.dispatch({ changes: { from: 0, insert: "#book\n  #year = 1954" } });

        expect(editor.state.doc.lines).toBe(2);
        expect(onChange).toHaveBeenLastCalledWith("#book\n  #year = 1954");
    });
});

function build(config: Partial<FieldEditorConfig> = {}): FieldEditor {
    const parent = document.createElement("div");
    document.body.appendChild(parent);
    return createFieldEditor({ parent, ...config });
}

/** Presses a key on the editor and answers whether a binding handled it. */
function pressKey(editor: FieldEditor, key: string, init: KeyboardEventInit = {}) {
    return !editor.contentDOM.dispatchEvent(new KeyboardEvent("keydown", {
        key,
        bubbles: true,
        cancelable: true,
        ...init
    }));
}
