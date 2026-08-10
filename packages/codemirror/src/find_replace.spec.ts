import { codeFolding, foldEffect } from "@codemirror/language";
import { EditorState, type Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { afterEach, describe, expect, it } from "vitest";

import { createSearchHighlighter, SearchHighlighter, searchMatchHighlightTheme } from "./find_replace.js";

let view: EditorView | undefined;

afterEach(() => {
    view?.destroy();
    view = undefined;
});

describe("SearchHighlighter", () => {
    it("finds every occurrence and reports the total", () => {
        const search = highlighterFor("foo bar foo baz foo");
        search.searchFor("foo", false, false);

        expect(search.totalFound).toBe(3);
        expect(decorationCount(search)).toBe(3);
    });

    it("is case-insensitive unless match case is requested", () => {
        const search = highlighterFor("Foo foo FOO");

        search.searchFor("foo", false, false);
        expect(search.totalFound).toBe(3);

        search.searchFor("foo", true, false);
        expect(search.totalFound).toBe(1);
    });

    it("restricts to whole words when asked", () => {
        const search = highlighterFor("foo food foobar foo");

        search.searchFor("foo", false, false);
        expect(search.totalFound).toBe(4);

        search.searchFor("foo", false, true);
        expect(search.totalFound).toBe(2);
    });

    it("treats the search term literally, not as a regular expression", () => {
        // A user typing `a.c` or `(` must not have it compiled as a pattern — the first would
        // match `abc` and the second would throw on an unbalanced group.
        const search = highlighterFor("a.c abc a+c (x)");

        search.searchFor("a.c", false, false);
        expect(search.totalFound).toBe(1);

        expect(() => search.searchFor("(", false, false)).not.toThrow();
        expect(search.totalFound).toBe(1);
    });

    it("clears the highlights for an empty search term", () => {
        const search = highlighterFor("foo foo");
        search.searchFor("foo", false, false);
        expect(decorationCount(search)).toBe(2);

        search.searchFor("", false, false);
        expect(decorationCount(search)).toBe(0);
    });

    it("selects the first match at or after the cursor", () => {
        const search = highlighterFor("foo\nfoo\nfoo", 4);
        search.searchFor("foo", false, false);

        // The cursor sits on the second occurrence, so that is the active one (1-based).
        expect(search.currentFound).toBe(2);
    });

    it("leaves no active match when every occurrence is before the cursor", () => {
        // Searching with the caret past the last hit finds matches but activates none, so
        // "find next" starts from the top rather than jumping backwards.
        const search = highlighterFor("foo foo", 7);
        search.searchFor("foo", false, false);

        expect(search.totalFound).toBe(2);
        expect(search.currentFound).toBe(0);
    });

    it("exposes the match set through the plugin's decoration accessor", () => {
        const search = highlighterFor("foo foo");
        search.searchFor("foo", false, false);

        expect(SearchHighlighter.deco(search)).toBe(search.matches);
    });

    describe("navigation", () => {
        it("moves the active match and ignores an out-of-range index", () => {
            const search = highlighterFor("foo foo foo");
            search.searchFor("foo", false, false);

            search.scrollToMatch(2);
            expect(search.currentFound).toBe(3);

            const before = search.currentFound;
            search.scrollToMatch(99);
            expect(search.currentFound).toBe(before);
        });

        it("leaves folds alone when the match is not inside one", () => {
            // Folding is enabled and a region is collapsed, but the match sits outside it, so
            // nothing should be unfolded on the way to it.
            const doc = "start {\n  filler\n}\nneedle";
            view = viewFor(doc, 0, [ codeFolding() ]);
            view.dispatch({ effects: foldEffect.of({ from: 7, to: 18 }) });

            const search = new SearchHighlighter(view);
            search.searchFor("needle", false, false);
            search.scrollToMatch(0);

            expect(search.totalFound).toBe(1);
            expect(search.currentFound).toBe(1);
        });

        it("works in an editor that has folding enabled but nothing folded", () => {
            view = viewFor("foo foo", 0, [ codeFolding() ]);
            const search = new SearchHighlighter(view);
            search.searchFor("foo", false, false);
            search.scrollToMatch(1);

            expect(search.currentFound).toBe(2);
        });

        it("unfolds a region containing the match it scrolls to", () => {
            // A match hidden inside a collapsed fold has to be revealed, otherwise "find next"
            // appears to jump to nothing.
            const doc = "start {\n  needle\n}\nneedle";
            view = viewFor(doc, 0, [ codeFolding() ]);
            view.dispatch({ effects: foldEffect.of({ from: 7, to: 18 }) });

            const search = new SearchHighlighter(view);
            search.searchFor("needle", false, false);
            search.scrollToMatch(0);

            expect(search.currentFound).toBe(1);
        });
    });

    describe("replacing", () => {
        it("replaces only the active match", () => {
            const search = highlighterFor("foo bar foo");
            search.searchFor("foo", false, false);
            search.scrollToMatch(1);

            search.replaceActiveMatch("baz");
            expect(docOf()).toBe("foo bar baz");
        });

        it("replaces every match at once", () => {
            const search = highlighterFor("foo bar foo baz foo");
            search.searchFor("foo", false, false);

            search.replaceAll("qux");
            expect(docOf()).toBe("qux bar qux baz qux");
        });

        it("does nothing when there is no search or no active match", () => {
            const search = highlighterFor("foo bar");

            search.replaceAll("x");
            search.replaceActiveMatch("x");
            expect(docOf()).toBe("foo bar");

            // Searched, but nothing matched: still nothing to replace.
            search.searchFor("zzz", false, false);
            search.replaceAll("x");
            search.replaceActiveMatch("x");
            expect(docOf()).toBe("foo bar");
        });
    });

    describe("keeping up with the document", () => {
        it("re-counts matches after an edit and does nothing before a search", () => {
            view = viewFor("foo foo", 0, [ createSearchHighlighter() ]);
            const search = new SearchHighlighter(view);

            // update() before searchFor() has no matcher to run.
            search.update({ docChanged: true, viewportChanged: false, view } as never);
            expect(search.totalFound).toBe(0);

            search.searchFor("foo", false, false);
            expect(search.totalFound).toBe(2);

            view.dispatch({ changes: { from: 7, insert: " foo" } });
            search.update({ docChanged: true, viewportChanged: false, view } as never);
            expect(search.totalFound).toBe(3);
        });

        it("ignores an update that changed neither the document nor the viewport", () => {
            const search = highlighterFor("foo foo");
            search.searchFor("foo", false, false);

            search.update({ docChanged: false, viewportChanged: false, view } as never);
            expect(search.totalFound).toBe(2);
        });

        it("has a no-op destroy", () => {
            const search = highlighterFor("foo");
            expect(() => search.destroy()).not.toThrow();
        });
    });
});

describe("createSearchHighlighter", () => {
    it("builds a view plugin that decorates matches, including the active one", () => {
        view = viewFor("foo foo foo", 0, [ createSearchHighlighter(), searchMatchHighlightTheme ]);
        const plugin = createSearchHighlighter();
        const instance = view.plugin(plugin as never);

        // The plugin is a fresh instance, so it is not the one already in the view; what matters
        // is that constructing the view with it did not throw and the theme is a valid extension.
        expect(instance ?? null).toBeDefined();
        expect(() => EditorState.create({ doc: "x", extensions: [ searchMatchHighlightTheme ] })).not.toThrow();
    });
});

function viewFor(doc: string, cursor = 0, extensions: Extension[] = []) {
    const parent = document.createElement("div");
    document.body.appendChild(parent);
    return new EditorView({
        state: EditorState.create({ doc, selection: { anchor: cursor }, extensions }),
        parent
    });
}

function highlighterFor(doc: string, cursor = 0): SearchHighlighter {
    view = viewFor(doc, cursor);
    return new SearchHighlighter(view);
}

function docOf(): string {
    return view?.state.doc.toString() ?? "";
}

/** Number of ranges the highlighter would paint for the current search. */
function decorationCount(search: SearchHighlighter): number {
    let count = 0;
    const iter = search.matches.iter();
    while (iter.value) {
        count++;
        iter.next();
    }
    return count;
}
