import { closeCompletion, completionStatus, startCompletion } from "@codemirror/autocomplete";
import { undo } from "@codemirror/commands";
import { indentUnit } from "@codemirror/language";
import { EditorSelection, EditorState, StateEffect } from "@codemirror/state";
import { EditorView, showTooltip, type ViewUpdate } from "@codemirror/view";
import { CodeMirror as VimEditor, getCM } from "@replit/codemirror-vim";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("./type_completion/index.js", async (importOriginal) => {
    const original = await importOriginal<typeof import("./type_completion/index.js")>();
    return { ...original, buildTypeCompletion: vi.fn(original.buildTypeCompletion) };
});

import { hostedCompletion } from "./extensions/hosted_completion.js";
import CodeMirror, {
    type EditorConfig, getThemeById, type HostHistory, SCRIPT_MIME_BACKEND, SharedHistory
} from "./index.js";
import { buildTypeCompletion } from "./type_completion/index.js";

let editor: CodeMirror | undefined;

afterEach(() => {
    editor?.destroy();
    editor = undefined;
    // Back to the real build, which `vi.fn()` was given.
    vi.mocked(buildTypeCompletion).mockReset();
});

describe("CodeMirror", () => {
    describe("construction", () => {
        it("mounts into the given parent with the document and default indent", () => {
            const parent = document.createElement("div");
            document.body.appendChild(parent);
            editor = new CodeMirror({ parent });
            editor.setText("hello");

            expect(parent.contains(editor.dom)).toBe(true);
            expect(editor.getText()).toBe("hello");
            // Four spaces is the documented default for code notes.
            expect(editor.state.facet(indentUnit)).toBe("    ");
            expect(editor.state.tabSize).toBe(4);
        });

        it("honours the indent configuration, including tabs", () => {
            editor = build({ indentSize: 2 });
            expect(editor.state.facet(indentUnit)).toBe("  ");
            expect(editor.state.tabSize).toBe(2);

            editor.destroy();
            editor = build({ indentSize: 8, useTabs: true });
            expect(editor.state.facet(indentUnit)).toBe("\t");
            expect(editor.state.tabSize).toBe(8);
        });

        it("makes a read-only editor reject edits", () => {
            editor = build({ readOnly: true });
            expect(editor.state.readOnly).toBe(true);
        });

        it("accepts the optional feature flags", () => {
            // These only add extensions, so the observable contract is that each combination builds
            // a working editor rather than throwing on a duplicate/conflicting config.
            for (const config of [
                { lineWrapping: true },
                { vimKeybindings: true },
                { preferPerformance: true },
                { placeholder: "Type here" },
                { readOnly: true, placeholder: "ignored when read-only" },
                { tabIndex: 5 }
            ] satisfies Partial<EditorConfig>[]) {
                const instance = build(config);
                try {
                    expect(instance.getText()).toBe("");
                } finally {
                    instance.destroy();
                }
            }
        });

        it("applies a requested tabIndex to the editor element", () => {
            editor = build({ tabIndex: 7 });
            expect(editor.dom.tabIndex).toBe(7);
        });

        it("keeps on-screen keyboard suggestions off unless the editor holds prose", () => {
            // Android reads `autocomplete`, not the `spellcheck`/`autocorrect` pair CodeMirror sets
            // on its own, so its absence is what lets Gboard complete and correct words in code.
            editor = build();
            expect(editor.contentDOM.getAttribute("autocomplete")).toBe("off");

            editor.destroy();
            editor = build({ allowKeyboardSuggestions: true });
            expect(editor.contentDOM.hasAttribute("autocomplete")).toBe(false);
        });

        it("follows a switch between prose and code after construction", () => {
            // The language dropdown can move a note between `text/plain` and a real language, so
            // the attributes have to track it rather than being fixed when the editor is built.
            editor = build();
            editor.setAllowKeyboardSuggestions(true);
            expect(editor.contentDOM.hasAttribute("autocomplete")).toBe(false);

            editor.setAllowKeyboardSuggestions(false);
            expect(editor.contentDOM.getAttribute("autocomplete")).toBe("off");
        });

        it("gives a prose editor back the keyboard help CodeMirror turns off for code", () => {
            // CodeMirror hard-codes both to off for every editor, so leaving its defaults alone
            // would cost a Markdown note its sentence capitalization and its typo correction.
            editor = build();
            expect(editor.contentDOM.getAttribute("autocorrect")).toBe("off");
            expect(editor.contentDOM.getAttribute("autocapitalize")).toBe("off");

            editor.setAllowKeyboardSuggestions(true);
            expect(editor.contentDOM.getAttribute("autocorrect")).toBe("on");
            expect(editor.contentDOM.getAttribute("autocapitalize")).toBe("sentences");

            editor.destroy();
            editor = build({ allowKeyboardSuggestions: true });
            expect(editor.contentDOM.getAttribute("autocorrect")).toBe("on");
            expect(editor.contentDOM.getAttribute("autocapitalize")).toBe("sentences");
        });

        it("hosts tooltips in one body-level element, outside the editor that would clip them", () => {
            editor = build();
            const host = document.body.querySelector(".cm-tooltip-host");
            expect(host).not.toBeNull();
            expect(editor.dom.contains(host)).toBe(false);

            // A second editor shares the host rather than adding one of its own.
            const second = build();
            try {
                expect(document.body.querySelectorAll(".cm-tooltip-host")).toHaveLength(1);
            } finally {
                second.destroy();
            }
        });

        it("renders a tooltip into the host, under the editor's theme classes", () => {
            editor = build();
            const dom = document.createElement("div");
            dom.className = "cm-tooltip-lint";
            editor.dispatch({
                effects: StateEffect.appendConfig.of(showTooltip.of({ pos: 0, create: () => ({ dom }) }))
            });

            const host = document.body.querySelector(".cm-tooltip-host");
            expect(host?.contains(dom)).toBe(true);
            expect(editor.dom.contains(dom)).toBe(false);
            // The editor's scoped base themes, such as the lint tooltip's width cap, match through
            // these classes on the container.
            const container = dom.closest(".cm-tooltip-host > *");
            expect(container).not.toBeNull();
            const themeClasses = editor.themeClasses.split(" ").filter(Boolean);
            expect(themeClasses.length).toBeGreaterThan(0);
            for (const cls of themeClasses) {
                expect(container?.classList.contains(cls)).toBe(true);
            }
        });
    });

    describe("text access", () => {
        it("reads and replaces the whole document", () => {
            editor = build();
            editor.setText("first");
            expect(editor.getText()).toBe("first");

            editor.setText("second");
            expect(editor.getText()).toBe("second");
        });

        it("treats an empty replacement as clearing the document", () => {
            editor = build();
            editor.setText("something");
            editor.setText("");
            expect(editor.getText()).toBe("");
        });

        it("concatenates every selected range", () => {
            editor = build();
            editor.setText("abcdef");
            editor.dispatch({ selection: EditorSelection.single(1, 3) });
            expect(editor.getSelectedText()).toBe("bc");

            // With no selection there is nothing to return.
            editor.dispatch({ selection: EditorSelection.cursor(0) });
            expect(editor.getSelectedText()).toBe("");
        });
    });

    describe("setText while hidden", () => {
        const bigDoc = Array.from({ length: 10_000 }, (_, i) => `line ${i}`).join("\n");

        /** happy-dom has no layout, so offsetParent cannot tell hidden from visible on its own. */
        function pinOffsetParent(el: HTMLElement, value: Element | null) {
            Object.defineProperty(el, "offsetParent", { value, configurable: true });
        }

        it("keeps the viewport small instead of rendering every line of the new document", () => {
            editor = build();
            pinOffsetParent(editor.dom, null);
            editor.setText(bigDoc);

            expect(editor.getText()).toBe(bigDoc);
            // The regression rendered all 10,000 lines into the hidden DOM.
            expect(editor.dom.querySelectorAll(".cm-line").length).toBeLessThan(1_000);

            // The rebuilt view keeps accepting transactions once visible again.
            pinOffsetParent(editor.dom, document.body);
            editor.setText("visible again");
            expect(editor.getText()).toBe("visible again");
            editor.dispatch({ changes: { from: 0, insert: "still " } });
            expect(editor.getText()).toBe("still visible again");
        });

        it("skips the change notification for hidden loads", () => {
            const onContentChanged = vi.fn();
            editor = build({ onContentChanged });

            pinOffsetParent(editor.dom, null);
            editor.setText(bigDoc);
            // The hidden path swaps the state in without an update, so no change notification
            // fires — hidden loads are programmatic, and the caller resets history right after.
            expect(onContentChanged).not.toHaveBeenCalled();

            pinOffsetParent(editor.dom, document.body);
            editor.setText("typed");
            expect(onContentChanged).toHaveBeenCalledTimes(1);
        });
    });

    describe("update notifications", () => {
        it("calls onContentChanged only for document changes", () => {
            const onContentChanged = vi.fn();
            editor = build({ onContentChanged });

            editor.setText("typed");
            expect(onContentChanged).toHaveBeenCalledTimes(1);

            // A pure selection move is not a content change.
            editor.dispatch({ selection: EditorSelection.cursor(1) });
            expect(onContentChanged).toHaveBeenCalledTimes(1);
        });

        it("notifies registered listeners until they unsubscribe", () => {
            editor = build();
            const seen: ViewUpdate[] = [];
            const unsubscribe = editor.addUpdateListener((v) => seen.push(v));

            editor.setText("one");
            expect(seen.length).toBeGreaterThan(0);

            const countAfterFirst = seen.length;
            unsubscribe();
            editor.setText("two");
            expect(seen.length).toBe(countAfterFirst);

            // Unsubscribing twice must not remove somebody else's listener.
            expect(() => unsubscribe()).not.toThrow();
        });
    });

    describe("configuration changes", () => {
        it("swaps the theme", async () => {
            editor = build();
            const theme = getThemeById("abyss");
            expect(theme).not.toBeNull();
            if (!theme) return;

            await editor.setTheme(theme);
            expect(editor.getText()).toBe("");
        });

        it("applies a theme it has loaded before without waiting", async () => {
            const theme = getThemeById("github-light");
            expect(theme).not.toBeNull();
            if (!theme) return;
            editor = build();
            await editor.setTheme(theme);
            editor.destroy();

            editor = build();
            void editor.setTheme(theme);
            expect(getGutterRules(editor).join("\n")).toContain("background-color: #f6f8fa;");
        });

        it("switches between read-only and editable in place, with a new history", () => {
            editor = build({ readOnly: true, placeholder: "Type here" });
            const hasPlaceholder = () => !!editor?.dom.querySelector(".cm-placeholder");
            expect(hasPlaceholder()).toBe(false);
            expect(getHiddenCaretRules(editor)).toHaveLength(2);

            editor.setReadOnly(false);
            expect([ editor.state.readOnly, hasPlaceholder() ]).toEqual([ false, true ]);
            expect(getHiddenCaretRules(editor)).toEqual([]);
            editor.dispatch({ changes: { from: 0, insert: "a" } });
            expect(undo(editor)).toBe(true);
            expect(editor.getText()).toBe("");
            editor.dispatch({ changes: { from: 0, insert: "b" } });

            editor.setReadOnly(true);
            editor.setReadOnly(true);
            expect(editor.state.readOnly).toBe(true);
            expect(getHiddenCaretRules(editor)).toHaveLength(2);
            editor.insertBlankLineAtTop();
            expect(editor.getText()).toBe("b");

            editor.setReadOnly(false);
            expect(undo(editor)).toBe(false);
            expect(editor.getText()).toBe("b");
        });

        it("hides the caret of a read-only editor over that of the color theme", async () => {
            const theme = getThemeById("github-dark");
            expect(theme).not.toBeNull();
            if (!theme) return;
            editor = build({ readOnly: true });
            await editor.setTheme(theme);

            const caretRules = editor.state.facet(EditorView.styleModule)
                .flatMap((module) => module.getRules().split("\n"))
                .filter((rule) => / \.cm-content \{[^}]*caret-color/.test(rule));
            expect(caretRules.length).toBeGreaterThan(1);
            expect(caretRules[0]).toContain("caret-color: transparent;");
        });

        it("toggles line wrapping both ways", () => {
            editor = build();
            editor.setLineWrapping(true);
            editor.setLineWrapping(false);
            expect(editor.getText()).toBe("");
        });

        it("shows line numbers unless configured off, and toggles them both ways", () => {
            const hasLineNumbers = (view: CodeMirror) =>
                !!view.dom.querySelector(".cm-lineNumbers");
            editor = build();
            expect(hasLineNumbers(editor)).toBe(true);
            const gutter = editor.dom.querySelector(".cm-lineNumbers");
            editor.setLineNumbers(true);
            expect(editor.dom.querySelector(".cm-lineNumbers")).toBe(gutter);
            editor.setLineNumbers(false);
            expect(hasLineNumbers(editor)).toBe(false);
            editor.setLineNumbers(true);
            expect(hasLineNumbers(editor)).toBe(true);
            editor.destroy();

            editor = build({ lineNumbers: false });
            expect(hasLineNumbers(editor)).toBe(false);
        });

        it("blends an inset gutter into the code while the line numbers are off", async () => {
            const theme = getThemeById("github-light");
            expect(theme).not.toBeNull();
            if (!theme) return;
            editor = build({ lineNumbers: false });
            await editor.setTheme(theme);

            const [ hidden ] = getGutterRules(editor);
            expect(hidden).toContain("background-color: transparent;");
            expect(hidden).toContain("border: none;");
            expect(hidden).not.toContain("border-right");
            expect(hidden).toContain("padding-inline-start: 8px;");

            editor.setLineNumbers(true);
            const [ shown ] = getGutterRules(editor);
            expect(shown).toContain("background-color: #f6f8fa;");
            expect(shown).toContain("border-right: 1px solid");
            expect(getGutterRules(editor).join("\n")).not.toContain("padding-inline-start");
        });

        it("clamps the indent size to a sane range", () => {
            editor = build();

            editor.setIndent(2, false);
            expect(editor.state.facet(indentUnit)).toBe("  ");

            // Below 1, non-finite, and above 16 all fall back to a usable width.
            editor.setIndent(0, false);
            expect(editor.state.facet(indentUnit)).toBe("    ");
            editor.setIndent(Number.NaN, false);
            expect(editor.state.facet(indentUnit)).toBe("    ");
            editor.setIndent(100, false);
            expect(editor.state.facet(indentUnit)).toBe(" ".repeat(16));
        });

        it("keeps the other indent setting when only one is changed", () => {
            editor = build({ indentSize: 2 });

            editor.setUseTabs(true);
            expect(editor.state.facet(indentUnit)).toBe("\t");

            // Switching back to spaces must remember the size set earlier.
            editor.setUseTabs(false);
            expect(editor.state.facet(indentUnit)).toBe("  ");

            editor.setIndentSize(6);
            expect(editor.state.facet(indentUnit)).toBe("      ");
            expect(editor.state.tabSize).toBe(6);
        });

        it("falls back to the default width when toggling tabs on an unconfigured editor", () => {
            // No indentSize was ever supplied, so switching back to spaces has to land on the
            // documented default rather than an undefined width.
            editor = build();
            editor.setUseTabs(true);
            editor.setUseTabs(false);
            expect(editor.state.facet(indentUnit)).toBe("    ");
        });

        it("adds a named extension once and reconfigures it afterwards", () => {
            editor = build();

            editor.setNamedExtension("wrap", EditorView.lineWrapping);
            // Re-registering the same name must reconfigure rather than append a second copy,
            // which CodeMirror would reject as a duplicate config.
            expect(() => editor?.setNamedExtension("wrap", [])).not.toThrow();
            expect(() => editor?.setNamedExtension("other", EditorState.readOnly.of(false))).not.toThrow();
        });
    });

    describe("history", () => {
        it("drops the undo stack", () => {
            editor = build();
            editor.setText("a");
            expect(() => editor?.clearHistory()).not.toThrow();
            expect(editor.getText()).toBe("a");
        });

        it("does nothing for a read-only editor", () => {
            // A read-only editor keeps no history.
            editor = build({ readOnly: true });
            expect(() => editor?.clearHistory()).not.toThrow();
        });

        it("loads content outside the undo history", () => {
            editor = build();
            editor.loadText("loaded");
            expect(editor.getText()).toBe("loaded");
            expect(undo(editor)).toBe(false);
        });
    });

    describe("shared history", () => {
        it("records into the shared history and leaves its own, until it is detached", () => {
            editor = build();
            const { host, history } = createSharedHistory();
            editor.setText("own");

            editor.setSharedHistory(history);
            editor.setSharedHistory(history);
            editor.setText("shared");
            expect(host.push).toHaveBeenCalledOnce();
            expect(undo(editor)).toBe(false);
            editor.clearHistory();
            expect(pressKey(editor, "z", { ctrlKey: true })).toBe(true);
            expect(host.undo).toHaveBeenCalledOnce();

            // A read-only editor still runs the shared history.
            editor.setReadOnly(true);
            expect(pressKey(editor, "z", { ctrlKey: true })).toBe(true);
            expect(host.undo).toHaveBeenCalledTimes(2);
            editor.setReadOnly(false);

            const detach = vi.spyOn(history, "detach");
            editor.setSharedHistory(null);
            expect(detach).toHaveBeenCalledWith(editor);
            expect(editor.runSharedHistory("undo")).toBe(false);
            editor.setText("own again");
            expect(undo(editor)).toBe(true);
            expect(host.push).toHaveBeenCalledOnce();
        });

        it("runs the shared history from the undo and redo keys and input events", () => {
            editor = build();
            const { host, history } = createSharedHistory();
            editor.setSharedHistory(history);
            const outside = vi.fn();
            editor.dom.parentElement?.addEventListener("keydown", outside);

            expect(pressKey(editor, "z", { ctrlKey: true })).toBe(true);
            expect(pressKey(editor, "y", { ctrlKey: true })).toBe(true);
            const redoKey = { ctrlKey: true, shiftKey: true, keyCode: 90 };
            expect(pressKey(editor, "Z", redoKey)).toBe(true);
            expect(host.undo).toHaveBeenCalledOnce();
            expect(host.redo).toHaveBeenCalledTimes(2);
            expect(outside).not.toHaveBeenCalled();

            for (const inputType of [ "historyUndo", "historyRedo", "insertText" ]) {
                editor.contentDOM.dispatchEvent(
                    new InputEvent("beforeinput", { inputType, bubbles: true, cancelable: true }));
            }
            expect(host.undo).toHaveBeenCalledTimes(2);
            expect(host.redo).toHaveBeenCalledTimes(3);
        });

        it("runs the shared history from Vim, and the editor's own without one", () => {
            editor = build({ vimKeybindings: true });
            const cm = getCM(editor);
            expect(cm).not.toBeNull();
            if (!cm) return;
            editor.setText("typed");

            VimEditor.commands.undo(cm);
            expect(editor.getText()).toBe("");
            VimEditor.commands.redo(cm);
            expect(editor.getText()).toBe("typed");

            const { host, history } = createSharedHistory();
            editor.setSharedHistory(history);
            VimEditor.commands.undo(cm);
            VimEditor.commands.redo(cm);
            expect(host.undo).toHaveBeenCalledOnce();
            expect(host.redo).toHaveBeenCalledOnce();
            expect(editor.getText()).toBe("typed");
        });

        it("leaves the shared history as it is destroyed, with the document it shows", () => {
            editor = build();
            const { host, history, write } = createSharedHistory();
            editor.setSharedHistory(history);
            editor.setText("a");
            const dispatch = vi.spyOn(editor, "dispatch");
            editor.destroy();
            editor = undefined;

            host.undo();
            expect(dispatch).not.toHaveBeenCalled();
            expect(write).toHaveBeenCalledWith("");
        });
    });

    describe("cursor placement", () => {
        it("moves the cursor to the end of the document", () => {
            editor = build();
            editor.setText("line one\nline two");
            editor.dispatch({ selection: EditorSelection.cursor(0) });

            editor.scrollToEnd();
            expect(editor.state.selection.main.head).toBe(editor.state.doc.length);
        });

        it("inserts a blank first line and puts the cursor on it", () => {
            editor = build();
            editor.setText("existing");

            editor.insertBlankLineAtTop();
            expect(editor.getText()).toBe("\nexisting");
            expect(editor.state.selection.main.head).toBe(0);
        });

        it("only moves the cursor when the first line is already blank", () => {
            // Otherwise a brand-new note would accumulate a second empty line.
            editor = build();
            editor.setText("\nexisting");
            editor.dispatch({ selection: EditorSelection.cursor(5) });

            editor.insertBlankLineAtTop();
            expect(editor.getText()).toBe("\nexisting");
            expect(editor.state.selection.main.head).toBe(0);
        });

        it("does nothing for a read-only editor", () => {
            // CodeMirror's readOnly facet does not block programmatic transactions, so the guard
            // is what stops a read-only note from being modified.
            editor = build({ readOnly: true });
            editor.insertBlankLineAtTop();
            expect(editor.getText()).toBe("");
        });

        it("focuses the editor at either end of the document", () => {
            editor = build();
            editor.setText("line one\nline two");

            editor.focusAt("end");
            expect(editor.state.selection.main.head).toBe(editor.state.doc.length);
            expect(document.activeElement).toBe(editor.contentDOM);
            editor.focusAt("start");
            expect(editor.state.selection.main.head).toBe(0);
        });

        it("tells the end of the document that an arrow key moves the cursor past", () => {
            const instance = build();
            editor = instance;
            instance.setText("ab\ncd");
            const getEdge = (head: number, key: string, init: KeyboardEventInit = {}) => {
                instance.dispatch({ selection: EditorSelection.cursor(head) });
                return instance.getEdgeLeftBy(createKeydown(key, instance.contentDOM, init));
            };

            expect(getEdge(0, "ArrowLeft")).toBe("start");
            expect(getEdge(1, "ArrowLeft")).toBe(null);
            expect(getEdge(5, "ArrowRight")).toBe("end");
            expect(getEdge(4, "ArrowRight")).toBe(null);
            expect(getEdge(1, "ArrowUp")).toBe("start");
            expect(getEdge(4, "ArrowUp")).toBe(null);
            expect(getEdge(4, "ArrowDown")).toBe("end");
            expect(getEdge(1, "ArrowDown")).toBe(null);
            expect(getEdge(0, "Enter")).toBe(null);
            for (const modifier of [ "shiftKey", "ctrlKey", "altKey", "metaKey", "isComposing" ]) {
                expect(getEdge(0, "ArrowLeft", { [modifier]: true })).toBe(null);
            }
            expect(instance.getEdgeLeftBy(createKeydown("ArrowLeft", document.body))).toBe(null);

            const arrowLeft = createKeydown("ArrowLeft", instance.contentDOM);
            instance.dispatch({ selection: EditorSelection.range(0, 1) });
            expect(instance.getEdgeLeftBy(arrowLeft)).toBe(null);
            instance.setNamedExtension("multi", EditorState.allowMultipleSelections.of(true));
            const cursors = [ EditorSelection.cursor(0), EditorSelection.cursor(5) ];
            instance.dispatch({ selection: EditorSelection.create(cursors) });
            expect(instance.getEdgeLeftBy(arrowLeft)).toBe(null);
        });

        it("drops the line-wrap side of the cursor before the caret leaves", () => {
            const instance = build();
            editor = instance;
            instance.setText("ab\ncd");
            // A transaction keeps the `assoc` of an `EditorSelection`, not of a bare range.
            const cursor = EditorSelection.cursor(4, -1);
            instance.dispatch({ selection: EditorSelection.create([ cursor ]) });
            expect(instance.state.selection.main).toMatchObject({ head: 4, assoc: -1 });

            instance.prepareToLeave();
            expect(instance.state.selection.main).toMatchObject({ head: 4, assoc: 0 });
            for (const selection of [ EditorSelection.cursor(4), EditorSelection.range(0, 1) ]) {
                instance.dispatch({ selection });
                const { state } = instance;
                instance.prepareToLeave();
                expect(instance.state).toBe(state);
            }
        });

        it("leaves the arrow keys to an open completion list", async () => {
            const instance = build();
            editor = instance;
            instance.setText("ab");
            instance.setCompletionSource("test", (context) => ({
                from: context.pos, options: [ { label: "alpha" }, { label: "beta" } ]
            }));
            instance.dispatch({ selection: EditorSelection.cursor(2) });
            startCompletion(instance);
            await vi.waitFor(() => expect(completionStatus(instance.state)).toBe("active"));

            const arrowDown = createKeydown("ArrowDown", instance.contentDOM);
            expect(instance.getEdgeLeftBy(arrowDown)).toBe(null);
            closeCompletion(instance);
            expect(instance.getEdgeLeftBy(arrowDown)).toBe("end");
        });

        it("leaves the arrow keys to a hosted list while it shows entries", async () => {
            const instance = build();
            editor = instance;
            let element: HTMLElement | null = null;
            instance.setNamedExtension("test", hostedCompletion({
                match: () => ({ from: 0 }),
                list: () => ({
                    show() { element = document.createElement("div"); },
                    hide() { element = null; },
                    handleKeyDown: () => false,
                    get element() { return element; }
                })
            }));
            instance.focus();
            instance.setText("ab");
            instance.dispatch({ selection: EditorSelection.cursor(2) });
            await vi.waitFor(() => expect(element).not.toBe(null));

            const arrowDown = createKeydown("ArrowDown", instance.contentDOM);
            expect(instance.getEdgeLeftBy(arrowDown)).toBe(null);
            element = null;
            expect(instance.getEdgeLeftBy(arrowDown)).toBe("end");
        });
    });

    describe("cursor position", () => {
        it("counts the line and the displayed column from 1, at the moving end", () => {
            const instance = build();
            editor = instance;
            instance.setText("one\n\ttwo");
            const getPosition = (selection: EditorSelection) => {
                instance.dispatch({ selection });
                const { line, column } = instance.getCursorPosition();
                return { line, column };
            };

            expect(getPosition(EditorSelection.single(0))).toEqual({ line: 1, column: 1 });
            expect(getPosition(EditorSelection.single(2))).toEqual({ line: 1, column: 3 });
            // The tab before "two" is four columns wide.
            expect(getPosition(EditorSelection.single(8))).toEqual({ line: 2, column: 8 });
            expect(getPosition(EditorSelection.single(8, 1))).toEqual({ line: 1, column: 2 });

            instance.setIndentSize(2);
            expect(getPosition(EditorSelection.single(8))).toEqual({ line: 2, column: 6 });
        });

        it("counts the selected characters of every range, with a line break as one", () => {
            const instance = build();
            editor = instance;
            instance.setNamedExtension("multi", EditorState.allowMultipleSelections.of(true));
            instance.setText("one\ntwo");
            const getLength = (selection: EditorSelection) => {
                instance.dispatch({ selection });
                return instance.getCursorPosition().selectionLength;
            };

            expect(getLength(EditorSelection.single(2))).toBe(0);
            expect(getLength(EditorSelection.single(5, 2))).toBe(3);
            expect(getLength(EditorSelection.create([
                EditorSelection.range(0, 2), EditorSelection.range(4, 7)
            ]))).toBe(5);
        });

        it("reports the position at once and then each change of it", () => {
            const instance = build();
            editor = instance;
            instance.setText("one\n\ttwo");
            instance.dispatch({ selection: EditorSelection.cursor(0) });
            const listener = vi.fn();

            const unsubscribe = instance.addCursorPositionListener(listener);
            expect(listener.mock.calls).toEqual([ [ { line: 1, column: 1, selectionLength: 0 } ] ]);

            instance.dispatch({ selection: EditorSelection.cursor(5) });
            expect(listener).toHaveBeenLastCalledWith({ line: 2, column: 5, selectionLength: 0 });
            instance.setIndentSize(8);
            expect(listener).toHaveBeenLastCalledWith({ line: 2, column: 9, selectionLength: 0 });
            // The cursor stays where it is, and the selection grows behind it.
            instance.dispatch({ selection: EditorSelection.single(4, 5) });
            expect(listener).toHaveBeenLastCalledWith({ line: 2, column: 9, selectionLength: 1 });

            // Hiding the line numbers keeps the document and the selection, so nothing is counted.
            const getCursorPosition = vi.spyOn(instance, "getCursorPosition");
            listener.mockClear();
            instance.setLineNumbers(false);
            expect(getCursorPosition).not.toHaveBeenCalled();
            // An edit on another line keeps the cursor position and the selection length.
            instance.dispatch({ changes: { from: 0, insert: "x" } });
            expect(getCursorPosition).toHaveBeenCalled();
            expect(listener).not.toHaveBeenCalled();

            unsubscribe();
            instance.dispatch({ selection: EditorSelection.cursor(0) });
            expect(listener).not.toHaveBeenCalled();
        });
    });

    describe("find and replace", () => {
        it("reports the matches it found", async () => {
            editor = build();
            editor.setText("foo bar foo");

            const result = await editor.performFind("foo", false, false);
            expect(result.totalFound).toBe(2);
        });

        it("wraps around to the first match when every match is before the cursor", async () => {
            editor = build();
            editor.setText("foo bar foo");
            editor.dispatch({ selection: EditorSelection.cursor(11) });

            const result = await editor.performFind("foo", false, false);
            expect(result).toEqual({ totalFound: 2, currentFound: 1 });
            expect(editor.contentDOM.querySelectorAll(".cm-searchMatch")).toHaveLength(2);
            expect(editor.contentDOM.querySelectorAll(".cm-activeMatch")).toHaveLength(1);

            await editor.replace("baz");
            expect(editor.getText()).toBe("baz bar foo");
        });

        it("replaces the active match and then all of them", async () => {
            editor = build();
            editor.setText("foo bar foo");

            await editor.performFind("foo", false, false);
            await editor.findNext(1, 0, 0);
            await editor.replace("baz");
            expect(editor.getText()).toBe("baz bar foo");

            await editor.performFind("foo", false, false);
            await editor.replaceAll("qux");
            expect(editor.getText()).toBe("baz bar qux");
        });

        it("clears the highlighting after a search, and tolerates clearing twice", async () => {
            editor = build();
            editor.setText("foo bar foo");
            await editor.performFind("foo", false, false);

            editor.cleanSearch();
            // The second call has nothing left to tear down and must not reconfigure again.
            expect(() => editor?.cleanSearch()).not.toThrow();

            // A later replace no longer has a plugin to act on.
            await editor.replaceAll("x");
            expect(editor.getText()).toBe("foo bar foo");
        });

        it("finds without activating a match, and clears the active match on request", async () => {
            editor = build();
            editor.setText("foo bar foo");

            const result = await editor.performFind("foo", false, false, false);
            expect(result).toEqual({ totalFound: 2, currentFound: 0 });
            expect(editor.contentDOM.querySelectorAll(".cm-searchMatch")).toHaveLength(2);
            expect(editor.contentDOM.querySelectorAll(".cm-activeMatch")).toHaveLength(0);
            expect(editor.getSearchMatches()).toEqual([ { from: 0, to: 3 }, { from: 8, to: 11 } ]);

            await editor.findNext(1, 0, 1);
            expect(editor.contentDOM.querySelectorAll(".cm-activeMatch")).toHaveLength(1);

            editor.clearActiveMatch();
            expect(editor.contentDOM.querySelectorAll(".cm-activeMatch")).toHaveLength(0);
            expect(editor.contentDOM.querySelectorAll(".cm-searchMatch")).toHaveLength(2);
        });

        it("does nothing when cleaning a search that never ran", () => {
            editor = build();
            expect(() => editor?.cleanSearch()).not.toThrow();
            expect(() => editor?.clearActiveMatch()).not.toThrow();
            expect(editor.getSearchMatches()).toEqual([]);
        });

        it("does nothing when replace is called before a search", async () => {
            editor = build();
            editor.setText("foo");

            await editor.findNext(1, 0, 0);
            await editor.replace("x");
            await editor.replaceAll("x");
            expect(editor.getText()).toBe("foo");
        });
    });

    describe("MIME types", () => {
        it("applies a legacy stream-parser language", async () => {
            editor = build();
            await editor.setMimeType("text/x-yaml");
            expect(editor.getText()).toBe("");
        });

        it("applies a LanguageSupport language", async () => {
            editor = build();
            await editor.setMimeType("text/css");
            expect(editor.getText()).toBe("");
        });

        it("applies a language that resolves to a list of extensions", async () => {
            editor = build();
            await editor.setMimeType("application/json");
            expect(editor.getText()).toBe("");
        });

        it("resolves an aliased MIME type through its target language", async () => {
            editor = build();
            await editor.setMimeType("image/svg+xml");
            expect(editor.getText()).toBe("");
        });

        it("clears the language for plain text and for an unknown MIME type", async () => {
            editor = build();
            await editor.setMimeType("text/plain");
            await editor.setMimeType("application/something-nobody-supports");
            expect(editor.getText()).toBe("");
        });
    });

    describe("completion sources", () => {
        it("registers and removes named sources", () => {
            editor = build();
            const source = () => null;

            editor.setCompletionSource("snippets", source);
            editor.setCompletionSource("other", source);
            // Removing the last one must drop autocompletion entirely rather than configure it
            // with an empty override list.
            editor.setCompletionSource("snippets", null);
            editor.setCompletionSource("other", null);
            expect(editor.getText()).toBe("");
        });
    });

    describe("type completions", () => {
        it("looks up the language service's completions at the caret of a script", async () => {
            editor = build();
            await editor.setMimeType("text/plain");
            expect(editor.hasTypeCompletions()).toBe(false);
            expect(await editor.getTypeCompletions()).toBe(null);

            editor.setText("api.");
            await editor.setMimeType(SCRIPT_MIME_BACKEND);
            editor.dispatch({ selection: EditorSelection.cursor(4) });
            expect(editor.hasTypeCompletions()).toBe(true);
            const completions = await editor.getTypeCompletions() ?? [];
            expect(completions).toContainEqual({ label: "getNote", type: "method" });
            expect(completions.map(({ label }) => label)).not.toContain("Array");
        }, 30_000);
    });

    describe("script api context", () => {
        it("is safe to set before any MIME type is known", async () => {
            editor = build();
            await editor.setScriptApiContext({});
            expect(editor.getText()).toBe("");
        });

        it("rebuilds the completion once a MIME type has been set", async () => {
            editor = build();
            await editor.setMimeType("text/plain");
            await editor.setScriptApiContext({ customRequestHandler: true });
            expect(editor.getText()).toBe("");
        });

        it("builds the completion once while the MIME type and context stay the same", async () => {
            const buildMock = vi.mocked(buildTypeCompletion);
            buildMock.mockResolvedValue({ extensions: [], complete: null });
            editor = build();

            // What a code note's effects request on mount.
            await Promise.all([
                editor.setMimeType("text/jsx"),
                editor.setMimeType("text/jsx"),
                editor.setScriptApiContext({ customRequestHandler: false, bulkActionNote: false }),
                editor.setMimeType("text/jsx")
            ]);
            expect(buildMock).toHaveBeenCalledOnce();

            await editor.setScriptApiContext({ customRequestHandler: true, bulkActionNote: false });
            await editor.setMimeType("text/css");
            expect(buildMock).toHaveBeenCalledTimes(3);
        });

        it("keeps a newer build when an older one fails after it", async () => {
            const buildMock = vi.mocked(buildTypeCompletion);
            let failOlder: (error: Error) => void = () => {};
            buildMock.mockReturnValueOnce(new Promise((_resolve, reject) => { failOlder = reject; }));
            buildMock.mockResolvedValue({ extensions: [], complete: null });
            editor = build();

            const older = editor.setMimeType("text/jsx");
            await editor.setMimeType("text/css");
            failOlder(new Error("no language service"));
            await expect(older).rejects.toThrow("no language service");

            await editor.setMimeType("text/css");
            expect(buildMock).toHaveBeenCalledTimes(2);
        });

        it("builds the completion again after a build failed", async () => {
            const buildMock = vi.mocked(buildTypeCompletion);
            buildMock.mockRejectedValueOnce(new Error("no language service"));
            buildMock.mockResolvedValue({ extensions: [], complete: null });
            editor = build();

            await expect(editor.setMimeType("text/jsx")).rejects.toThrow("no language service");
            await editor.setMimeType("text/jsx");
            expect(buildMock).toHaveBeenCalledTimes(2);
        });
    });

    describe("concurrent MIME changes", () => {
        it("keeps the language of the last request when an earlier one resolves late", async () => {
            // Each setMimeType bumps a token; a slow grammar load for a superseded MIME must not
            // overwrite the newer one's type completion when it finally settles.
            editor = build();
            const slow = editor.setMimeType("text/x-yaml");
            const fast = editor.setMimeType("text/css");
            await Promise.all([ slow, fast ]);

            expect(editor.getText()).toBe("");
        });
    });

    describe("key handling", () => {
        it("swallows Ctrl-Enter so it cannot insert a newline", () => {
            // Ctrl-Enter is the "run script"/submit chord owned by the surrounding UI; letting
            // CodeMirror handle it would drop a line break into the note.
            editor = build();
            editor.setText("line");
            editor.dispatch({ selection: EditorSelection.cursor(4) });

            const handled = !editor.contentDOM.dispatchEvent(new KeyboardEvent("keydown", {
                key: "Enter",
                ctrlKey: true,
                bubbles: true,
                cancelable: true
            }));

            expect(handled).toBe(true);
            expect(editor.getText()).toBe("line");
        });
    });
});

function build(config: Partial<EditorConfig> = {}): CodeMirror {
    const parent = document.createElement("div");
    document.body.appendChild(parent);
    return new CodeMirror({ parent, ...config });
}

/** A shared history over a host that undoes the last step it was given. */
function createSharedHistory() {
    const steps: Parameters<HostHistory["push"]>[0][] = [];
    const host = {
        push: vi.fn((step: Parameters<HostHistory["push"]>[0]) => {
            steps.push(step);
            return { isLatest: () => false };
        }),
        undo: vi.fn(() => steps.pop()?.undo()),
        redo: vi.fn()
    };
    const write = vi.fn();
    return { host, history: new SharedHistory(host, write), write };
}

/** Presses `key` in `view`. Returns whether the editor handled it. */
function pressKey(view: CodeMirror, key: string, init: KeyboardEventInit = {}) {
    return !view.contentDOM.dispatchEvent(
        new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init }));
}

/** The `.cm-gutters` rules of `view`, the one that takes effect first. */
function getGutterRules(view: CodeMirror) {
    return view.state.facet(EditorView.styleModule)
        .flatMap((module) => module.getRules().split("\n"))
        .filter((rule) => / \.cm-gutters \{/.test(rule));
}

/** The rules of `view` that hide the caret and the block cursor of Vim. */
function getHiddenCaretRules(view: CodeMirror) {
    return view.state.facet(EditorView.styleModule)
        .flatMap((module) => module.getRules().split("\n"))
        .filter((rule) => / \.cm-content \{caret-color: transparent;\}/.test(rule)
            || / \.cm-vimCursorLayer \{display: none;\}/.test(rule));
}

/** A keydown of `key` from `target`, which the editor does not handle, as it is not dispatched. */
function createKeydown(key: string, target: EventTarget, init: KeyboardEventInit = {}) {
    const event = new KeyboardEvent("keydown", { key, ...init });
    Object.defineProperty(event, "target", { value: target });
    return event;
}
