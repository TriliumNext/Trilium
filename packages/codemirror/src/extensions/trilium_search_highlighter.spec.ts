import { EditorSelection } from "@codemirror/state";
import { describe, expect, it } from "vitest";

import { createFieldEditor } from "../field_editor.js";
import { tokenizeSearchQuery, triliumSearchHighlighter } from "./trilium_search_highlighter.js";

describe("tokenizeSearchQuery", () => {
    it("colours labels, keywords and a property path in an orderBy query", () => {
        expect(tokenize("#author=Tolkien orderBy #publicationDate desc, note.title limit 10")).toEqual([
            "label:#author",
            "operator:=",
            "keyword:orderBy",
            "label:#publicationDate",
            "keyword:desc",
            "property:note",
            "property:.title",
            "keyword:limit",
            "literal:10"
        ]);
    });

    it("follows a property path through a relation", () => {
        expect(tokenize("~author.relations.son.title = 'Christopher Tolkien'")).toEqual([
            "relation:~author",
            "property:.relations",
            "property:.son",
            "property:.title",
            "operator:=",
            "string:'Christopher Tolkien'"
        ]);
    });

    it("handles grouping, negation and the logical keywords", () => {
        expect(tokenize("#book AND not(#!fiction or ~author.title *=* tolkien)")).toEqual([
            "label:#book",
            "keyword:AND",
            "keyword:not",
            "bracket:(",
            "label:#!fiction",
            "keyword:or",
            "relation:~author",
            "property:.title",
            "operator:*=*",
            "bracket:)"
        ]);
    });

    it("reads ~= and ~* as fuzzy operators rather than a relation", () => {
        expect(tokenize("note.title ~= boks")).toEqual([
            "property:note",
            "property:.title",
            "operator:~=",
            // `boks` is the compared value, which carries no colour of its own.
        ]);
        expect(tokenize("note.content ~* progr")).toEqual([
            "property:note",
            "property:.content",
            "operator:~*"
        ]);
    });

    it("splits a smart date value from its offset", () => {
        expect(tokenize("note.dateCreated >= today-30")).toEqual([
            "property:note",
            "property:.dateCreated",
            "operator:>=",
            "literal:today",
            "operator:-",
            "literal:30"
        ]);
    });

    it("leaves full text alone, including an escaped # and a half-typed path", () => {
        expect(tokenize("towers rings")).toEqual([]);
        // The backslash escape is how a literal "#" is searched for as text.
        expect(tokenize("\\#tolkien")).toEqual([]);
        expect(tokenize("note.")).toEqual([ "property:note", "property:." ]);
    });

    it("runs an unclosed quote to the end of the query", () => {
        expect(tokenize("#title = \"unfinished")).toEqual([
            "label:#title",
            "operator:=",
            "string:\"unfinished"
        ]);
    });
});

describe("negation in the token stream", () => {
    it("keeps a negated attribute one token, which the linter reads as the operand", () => {
        expect(tokenize("#!fiction ~!author = x")).toEqual([
            "label:#!fiction",
            "relation:~!author",
            "operator:="
        ]);
    });
});

describe("triliumSearchHighlighter", () => {
    it("marks the tokens in the rendered editor", () => {
        const parent = document.createElement("div");
        document.body.appendChild(parent);
        const editor = createFieldEditor({
            parent,
            doc: "#book or ~author.title = 'Tolkien'",
            extensions: [ triliumSearchHighlighter ]
        });

        try {
            expect(textOf(parent, ".cm-search-label")).toEqual([ "#book" ]);
            expect(textOf(parent, ".cm-search-keyword")).toEqual([ "or" ]);
            expect(textOf(parent, ".cm-search-relation")).toEqual([ "~author" ]);
            expect(textOf(parent, ".cm-search-property")).toEqual([ ".title" ]);
            expect(textOf(parent, ".cm-search-string")).toEqual([ "'Tolkien'" ]);

            // An edit recolours the query, while a transaction that changes no text keeps what is drawn.
            editor.dispatch({ changes: { from: 0, to: 5, insert: "#novel" } });
            expect(textOf(parent, ".cm-search-label")).toEqual([ "#novel" ]);

            editor.dispatch({ selection: EditorSelection.cursor(0) });
            expect(textOf(parent, ".cm-search-label")).toEqual([ "#novel" ]);
        } finally {
            editor.destroy();
        }
    });
    it("draws the negation apart from the attribute it negates", () => {
        const parent = document.createElement("div");
        document.body.appendChild(parent);
        const editor = createFieldEditor({
            parent,
            doc: "#!fiction ~!author.title = x",
            extensions: [ triliumSearchHighlighter ]
        });

        try {
            // The marker and the name keep the attribute's own colour, split around the `!`.
            expect(textOf(parent, ".cm-search-negation")).toEqual([ "!", "!" ]);
            expect(textOf(parent, ".cm-search-label")).toEqual([ "#", "fiction" ]);
            expect(textOf(parent, ".cm-search-relation")).toEqual([ "~", "author" ]);
        } finally {
            editor.destroy();
        }
    });
});

/** Renders the tokens as `kind:text` pairs, which reads far better in an expectation than offsets. */
function tokenize(query: string): string[] {
    return tokenizeSearchQuery(query).map(({ kind, from, to }) => `${kind}:${query.slice(from, to)}`);
}

function textOf(parent: HTMLElement, selector: string): string[] {
    return Array.from(parent.querySelectorAll(selector)).map((element) => element.textContent ?? "");
}
