import { diagnosticCount, forceLinting } from "@codemirror/lint";
import { describe, expect, it, vi } from "vitest";

import { createFieldEditor } from "../field_editor.js";
import { diagnoseSearchQuery, type SearchLintMessages, searchDiagnostics, type SearchValidator, triliumSearchLinter } from "./trilium_search_lint.js";

// The wording is the consumer's; the keys identify which rule answered.
const MESSAGES: SearchLintMessages = {
    relationNeedsProperty: "relation",
    textNeedsContains: "text",
    contentNotOrdered: "content",
    compareTheTitle: "fix-title",
    useOperator: (operator) => `fix-${operator}`
};

describe("diagnoseSearchQuery", () => {
    it("marks the operator a relation cannot take, and offers the property path in its place", () => {
        const [ diagnostic, ...rest ] = diagnoseSearchQuery("~author = tolkien", MESSAGES);

        expect(rest).toHaveLength(0);
        expect(diagnostic.message).toBe("relation");
        expect(diagnostic.severity).toBe("error");
        // The operator alone is underlined, not the relation that is spelled correctly.
        expect([ diagnostic.from, diagnostic.to ]).toEqual([ 8, 9 ]);
        expect(diagnostic.actions?.[0].name).toBe("fix-title");

        // Reached through a path as well as through the `~` prefix.
        expect(messagesFor("note.relations.author = x")).toEqual([ "relation" ]);
    });

    it("repairs a query into one the parser accepts, leaving the property name selected", () => {
        // Opening the path alone would leave `tolkien` behind it as an unrecognised property, so
        // the fix names the one the parser's own advice does.
        expect(applyFirstFix("~author = tolkien")).toEqual({
            query: "~author.title = tolkien",
            selected: "title"
        });
        expect(applyFirstFix("note.relations.author = x").query).toBe("note.relations.author.title = x");

        expect(applyFirstFix("note.text = hello")).toEqual({ query: "note.text *=* hello", selected: "" });
        expect(applyFirstFix("note.content >= hello").query).toBe("note.content *=* hello");
    });

    it("marks an operator the compared property does not accept", () => {
        expect(messagesFor("note.text = hello")).toEqual([ "text" ]);
        expect(messagesFor("~author.text > hello")).toEqual([ "text" ]);
        expect(messagesFor("note.content >= hello")).toEqual([ "content" ]);
        expect(messagesFor("note.rawContent < hello")).toEqual([ "content" ]);

        const [ diagnostic ] = diagnoseSearchQuery("note.text = hello", MESSAGES);
        expect(diagnostic.actions?.[0].name).toBe("fix-*=*");
    });

    it("stays quiet on everything the parser accepts", () => {
        for (const query of [
            "~author.title = tolkien",
            "~author",
            "#book = 1",
            "#book",
            "note.text *=* hello",
            "note.content *=* hello",
            "note.content ~= hello",
            "note.title >= 2019",
            // A name of the user's own after `labels.` restricts nothing.
            "note.labels.text = hello",
            "towers #book or #author",
            ""
        ]) {
            expect(messagesFor(query), query).toEqual([]);
        }
    });

    it("leaves an operator alone when a full-text word stands between it and the relation", () => {
        // `tolkien` is the query's full text, so the operator is not comparing `~author` at all
        // and the tokenizer does not emit a token for it.
        expect(messagesFor("~author tolkien = x")).toEqual([]);
    });

    it("leaves an operator alone when nothing it could compare stands in front of it", () => {
        // Nothing at all before the operator, then a value the rules have no opinion about.
        expect(messagesFor("= hello")).toEqual([]);
        expect(messagesFor("#book = 1 = 2")).toEqual([]);
    });

    it("marks each offending comparison in a query that holds several", () => {
        expect(messagesFor("#book = 1 ~author = x note.text = y")).toEqual([ "relation", "text" ]);
    });
});

describe("searchDiagnostics", () => {
    it("asks the engine only about a query its own rules accept", async () => {
        const validate = vi.fn(async () => "Mixed usage of AND/OR");

        // A fault of its own is reported without a round trip, since the engine would name the
        // same one less precisely.
        expect(await ranges("~author = tolkien", validate)).toEqual([ { from: 8, to: 9, message: "relation" } ]);
        expect(validate).not.toHaveBeenCalled();

        expect(await ranges("#a and #b or #c", validate)).toEqual([
            { from: 0, to: 15, message: "Mixed usage of AND/OR" }
        ]);
        expect(validate).toHaveBeenCalledWith("#a and #b or #c");

        // Nothing to say about an empty field, and nothing to ask.
        validate.mockClear();
        expect(await ranges("   ", validate)).toEqual([]);
        expect(validate).not.toHaveBeenCalled();
    });

    it("keeps the editor working when the engine cannot be reached", async () => {
        const failing = vi.fn(async () => { throw new Error("offline"); });

        expect(await ranges("#a and #b or #c", failing)).toEqual([]);
        expect(failing).toHaveBeenCalled();
    });

    it("drops an answer that describes a query already typed over", async () => {
        const diagnostics = await searchDiagnostics(
            "#a and #b or #c",
            MESSAGES,
            async () => "Mixed usage of AND/OR",
            () => "#a and #b"
        );

        expect(diagnostics).toEqual([]);
    });
});

describe("triliumSearchLinter", () => {
    it("marks the query in the editor with what the engine refuses", async () => {
        const parent = document.createElement("div");
        document.body.appendChild(parent);
        const view = createFieldEditor({
            parent,
            doc: "#a and #b or #c",
            extensions: [ triliumSearchLinter(MESSAGES, async () => "Mixed usage of AND/OR") ]
        });

        try {
            forceLinting(view);

            await vi.waitFor(() => expect(diagnosticCount(view.state)).toBe(1));
            expect(parent.querySelector(".cm-lintRange-error")?.textContent).toBe("#a and #b or #c");
        } finally {
            view.destroy();
        }
    });
});

/** Drives the real lint source and keeps only what a squiggle is drawn from. */
async function ranges(query: string, validate: SearchValidator) {
    const diagnostics = await searchDiagnostics(query, MESSAGES, validate);

    return diagnostics.map(({ from, to, message }) => ({ from, to, message }));
}

function messagesFor(query: string) {
    return diagnoseSearchQuery(query, MESSAGES).map((diagnostic) => diagnostic.message);
}

/** Applies the first diagnostic's fix against a view that only records what it was handed. */
function applyFirstFix(query: string) {
    const [ diagnostic ] = diagnoseSearchQuery(query, MESSAGES);
    const action = diagnostic?.actions?.[0];
    if (!action) {
        throw new Error(`Nothing offered a fix for ${JSON.stringify(query)}.`);
    }

    let result = { query, selected: "" };
    const view = {
        dispatch: ({ changes, selection }: {
            changes: { from: number, to?: number, insert: string },
            selection: { anchor: number, head?: number }
        }) => {
            const edited = query.slice(0, changes.from) + changes.insert + query.slice(changes.to ?? changes.from);
            // No `head` is a plain cursor, which selects nothing.
            result = { query: edited, selected: edited.slice(selection.anchor, selection.head ?? selection.anchor) };
        }
    };

    action.apply(view as never, diagnostic.from, diagnostic.to);

    return result;
}
