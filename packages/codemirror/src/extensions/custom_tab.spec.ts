import { indentUnit } from "@codemirror/language";
import { EditorSelection, EditorState, type Extension, type Transaction } from "@codemirror/state";
import type { KeyBinding } from "@codemirror/view";
import { describe, expect, it } from "vitest";

import smartIndentWithTab from "./custom_tab.js";

const [tabBinding] = smartIndentWithTab as [KeyBinding];

describe("smartIndentWithTab", () => {
    it("indents the line when the cursor has only whitespace before it", () => {
        // Pressing Tab at the very start of a line means "indent this line", not "insert a tab" —
        // the same as at any point inside the leading whitespace.
        expect(pressTab("const x = 1;", { anchor: 0 })).toEqual({
            handled: true,
            doc: "  const x = 1;"
        });
        expect(pressTab("    const x = 1;", { anchor: 2 })).toEqual({
            handled: true,
            doc: "      const x = 1;"
        });
    });

    it("inserts the indent unit at the cursor when there is text before it", () => {
        expect(pressTab("const x =", { anchor: 9 })).toEqual({
            handled: true,
            doc: "const x =  "
        });
    });

    it("replaces a selection inside one line with the indent unit", () => {
        expect(pressTab("const foo = 1;", { anchor: 6, head: 9 })).toEqual({
            handled: true,
            doc: "const    = 1;"
        });
    });

    it("indents every line covered by a multi-line selection", () => {
        // A selection spanning lines means "indent the block" rather than replacing the text.
        expect(pressTab("one\ntwo\nthree", { anchor: 0, head: 7 })).toEqual({
            handled: true,
            doc: "  one\n  two\nthree"
        });
    });

    it("leaves the trailing line alone when the selection stops at its very start", () => {
        // The selection touches line 2 (so this takes the multi-line branch rather than replacing
        // the text), but nothing on line 2 is actually selected, so only line 1 is indented — the
        // same as selecting whole lines by dragging into the next one in any editor.
        expect(pressTab("one\ntwo", { anchor: 0, head: 4 })).toEqual({
            handled: true,
            doc: "  one\ntwo"
        });
    });

    it("honours a configured indent unit, including tabs", () => {
        expect(pressTab("x", { anchor: 1 }, [ indentUnit.of("\t") ])).toEqual({
            handled: true,
            doc: "x\t"
        });
        expect(pressTab("x", { anchor: 0 }, [ indentUnit.of("  ") ])).toEqual({
            handled: true,
            doc: "  x"
        });
    });

    it("handles several cursors at once", () => {
        // allowMultipleSelections is required for the state to keep more than the main range,
        // which is what makes the per-range loop do more than one thing.
        const state = EditorState.create({
            doc: "ab\ncd",
            selection: EditorSelection.create([
                EditorSelection.cursor(2),
                EditorSelection.cursor(5)
            ]),
            extensions: [ EditorState.allowMultipleSelections.of(true) ]
        });
        expect(run(state)).toEqual({ handled: true, doc: "ab  \ncd  " });
    });

    it("does nothing in a read-only editor", () => {
        // Without this guard Tab would silently produce a transaction the state rejects.
        const state = EditorState.create({
            doc: "x",
            extensions: [ EditorState.readOnly.of(true) ]
        });
        expect(run(state)).toEqual({ handled: false, doc: "x" });
    });

    it("binds Shift+Tab to unindent", () => {
        expect(tabBinding.key).toBe("Tab");
        expect(tabBinding.shift).toBeTruthy();

        const state = EditorState.create({ doc: "        deep", selection: { anchor: 12 } });
        let doc = state.doc.toString();
        const handled = tabBinding.shift?.({
            state,
            dispatch: (tr: Transaction) => { doc = tr.state.doc.toString(); }
        } as never);

        expect(handled).toBe(true);
        expect(doc).toBe("      deep");
    });
});

/** Presses Tab on a freshly built state and reports whether it was handled plus the resulting doc. */
function pressTab(
    doc: string,
    selection: { anchor: number; head?: number },
    extensions: Extension[] = []
): { handled: boolean; doc: string } {
    return run(EditorState.create({ doc, selection, extensions }));
}

function run(state: EditorState): { handled: boolean; doc: string } {
    let result = state.doc.toString();
    const handled = tabBinding.run?.({
        state,
        dispatch: (tr: Transaction) => { result = tr.state.doc.toString(); }
    } as never);
    return { handled: handled ?? false, doc: result };
}
