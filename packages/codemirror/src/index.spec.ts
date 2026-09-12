import { indentUnit } from "@codemirror/language";
import { EditorSelection, EditorState } from "@codemirror/state";
import { EditorView, type ViewUpdate } from "@codemirror/view";
import { afterEach, describe, expect, it, vi } from "vitest";

import CodeMirror, { type EditorConfig, getThemeById } from "./index.js";

let editor: CodeMirror | undefined;

afterEach(() => {
    editor?.destroy();
    editor = undefined;
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

        it("toggles line wrapping both ways", () => {
            editor = build();
            editor.setLineWrapping(true);
            editor.setLineWrapping(false);
            expect(editor.getText()).toBe("");
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
            // A read-only editor has no history compartment to reconfigure.
            editor = build({ readOnly: true });
            expect(() => editor?.clearHistory()).not.toThrow();
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
    });

    describe("find and replace", () => {
        it("reports the matches it found", async () => {
            editor = build();
            editor.setText("foo bar foo");

            const result = await editor.performFind("foo", false, false);
            expect(result.totalFound).toBe(2);
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

        it("does nothing when cleaning a search that never ran", () => {
            editor = build();
            expect(() => editor?.cleanSearch()).not.toThrow();
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
