import { HighlightStyle, StreamLanguage, syntaxHighlighting } from "@codemirror/language";
import { sqlite } from "@codemirror/legacy-modes/mode/sql";
import { Compartment, EditorState, type Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { classHighlighter, tags } from "@lezer/highlight";
import { describe, expect, it } from "vitest";

import { MAX_HIGHLIGHTED_LINES, triliumLogHighlighter } from "./trilium_log_highlighter.js";

const sqlLanguage = StreamLanguage.define(sqlite);

interface DecorationSpan {
    from: number;
    to: number;
    class: string;
}

describe("triliumLogHighlighter", () => {
    it("applies decorations the instant it enters the config (no edit/scroll needed)", () => {
        // Mirrors switching a code note's MIME to text/x-trilium-log: the highlighter is added to an
        // already-built editor state via a compartment reconfigure. Because it is a StateField, the
        // decorations must be present in the resulting state synchronously — a view plugin would not
        // paint until the next update.
        const compartment = new Compartment();
        const doc = "18:09:46.317 304 GET /api/notes/x/blob with 9911 bytes took 1ms";
        const before = EditorState.create({ doc, extensions: [ compartment.of([]) ] });
        expect(decorationsOf(before)).toHaveLength(0);

        const effects = compartment.reconfigure(triliumLogHighlighter());
        const after = before.update({ effects }).state;
        expect(decorationsOf(after).length).toBeGreaterThan(0);
    });

    it("highlights an HTTP request line: timestamp, status class, verb and URL", () => {
        const doc = "18:09:46.317 304 GET /api/notes/x/blob with 9911 bytes took 1ms";
        const classes = classesOf(doc);

        expect(classes).toContain("cm-log-http"); // whole-line tint
        expect(classes).toContain("cm-log-timestamp");
        expect(classes).toContain("cm-log-status cm-log-status-3xx");
        expect(classes).toContain("cm-log-verb");
        expect(classes).toContain("cm-log-url");

        // The URL span covers exactly `/api/notes/x/blob`.
        const url = decorationsOf(state(doc)).find((d) => d.class === "cm-log-url");
        expect(url && doc.slice(url.from, url.to)).toBe("/api/notes/x/blob");
    });

    it("colours the status by class family", () => {
        expect(classesOf("18:18:38.904 204 PUT /api/options with 0 bytes took 2ms"))
            .toContain("cm-log-status cm-log-status-2xx");
        expect(classesOf("18:18:38.904 503 GET /api/x with 0 bytes took 2ms"))
            .toContain("cm-log-status cm-log-status-5xx");
    });

    it("leaves a status family it has no colour for unmarked", () => {
        // Only 2xx-5xx have a palette entry; a 1xx still has to render the rest of the line
        // rather than being skipped or throwing.
        const classes = classesOf("18:18:38.904 100 GET /api/x with 0 bytes took 2ms");

        expect(classes.some((c) => c.startsWith("cm-log-status"))).toBe(false);
        expect(classes).toContain("cm-log-verb");
        expect(classes).toContain("cm-log-url");
    });

    it("colours an error line and its timestamp-less continuation lines", () => {
        const doc = [
            "17:34:08.519 JS Error: Uncaught error: boom",
            "    at foo (bar.ts:1:2)",
            "    at baz (qux.ts:3:4)",
            "18:46:03.781 304 GET /api/options with 359 bytes took 4ms"
        ].join("\n");
        const errorLines = decorationsOf(state(doc)).filter((d) => d.class === "cm-log-error");

        // The header line plus its two continuation lines are all decorated; the following HTTP
        // request line is not.
        const lineStarts = errorLines.filter((d) => d.from === d.to).map((d) => d.from);
        expect(lineStarts).toHaveLength(3);
        expect(classesOf(doc)).toContain("cm-log-http");
    });

    it("recognises JS Info lines and leaves plain lines with only a timestamp", () => {
        expect(classesOf("17:34:08.519 JS Info: something happened")).toContain("cm-log-info");

        const plain = classesOf("17:35:56.745 Backend script execution is DISABLED.");
        expect(plain).toEqual([ "cm-log-timestamp" ]);
    });

    it("highlights a slow SQL query: the whole `Slow query` verb and the statement", () => {
        const doc = "00:10:01.540 Slow query took 78ms: SELECT content FROM blobs WHERE blobId = ?";
        const spans = decorationsOf(state(doc));

        expect(classesOf(doc)).toContain("cm-log-query"); // whole-line tint
        expect(sliceOf(doc, spans, "cm-log-query-verb")).toBe("Slow query");
        expect(sliceOf(doc, spans, "cm-log-sql")).toBe("SELECT content FROM blobs WHERE blobId = ?");
        // `Slow` is part of the verb here, not the conditional warning marker used on HTTP lines; and
        // the query verb has its own colour rather than the HTTP method's. The duration is undecorated.
        expect(classesOf(doc)).not.toContain("cm-log-slow");
        expect(classesOf(doc)).not.toContain("cm-log-verb");
    });

    it("handles recursive queries, whose verb spans `recursive` and which carry no statement", () => {
        const doc = "00:10:02.113 Slow recursive query took 45ms.";
        const spans = decorationsOf(state(doc));

        expect(sliceOf(doc, spans, "cm-log-query-verb")).toBe("Slow recursive query");
        expect(classesOf(doc)).not.toContain("cm-log-sql");
    });

    it("highlights a search: the `Search` verb, the query as search syntax and the count", () => {
        // The quote is never closed, so the string must stop at the end of the query.
        const doc = "17:02:11.408 Search: #!archived and note.title *= 'tower  (returned 12 items)";
        const spans = decorationsOf(state(doc));

        expect(sliceOf(doc, spans, "cm-log-search-verb")).toBe("Search");
        expect(slicesOf(doc, spans, "cm-search-label")).toEqual([ "#", "archived" ]);
        expect(sliceOf(doc, spans, "cm-search-negation")).toBe("!");
        expect(sliceOf(doc, spans, "cm-search-keyword")).toBe("and");
        expect(slicesOf(doc, spans, "cm-search-property")).toEqual([ "note", ".title" ]);
        expect(sliceOf(doc, spans, "cm-search-operator")).toBe("*=");
        expect(sliceOf(doc, spans, "cm-search-string")).toBe("'tower");
        expect(sliceOf(doc, spans, "cm-log-search-count")).toBe("(returned 12 items)");
        expect(lineClassesAt(state(doc), 1)).toEqual([]);
    });

    it("frames the whole query of a search in one box around its tokens", () => {
        const doc = "17:02:11.408 Search: #book and towers  (returned 3 items)";
        expect(sliceOf(doc, decorationsOf(state(doc)), "cm-log-search-query")).toBe("#book and towers");

        // The border must wrap the token spans, not be cut into a box per token.
        const view = new EditorView({ state: state(doc), parent: document.body });
        try {
            const frames = view.contentDOM.querySelectorAll(".cm-log-search-query");
            expect(frames).toHaveLength(1);
            expect(frames[0].textContent).toBe("#book and towers");
            expect(frames[0].querySelector(".cm-search-label")?.textContent).toBe("#book");
        } finally {
            view.destroy();
        }

        expect(classesOf("17:02:11.408 Search:   (returned 0 items)"))
            .not.toContain("cm-log-search-query");
    });

    it("does not mistake other entries that start with `Search` for searches", () => {
        for (const doc of [
            "18:00:00.000 Search note's relation author has not been found.",
            "18:00:00.000 Search: #book"
        ]) {
            expect(classesOf(doc)).toEqual([ "cm-log-timestamp" ]);
        }
    });

    it("does not mistake sibling timing lines for queries", () => {
        // Same `Slow … took <n>ms` shape, but not a query — must stay a plain entry.
        for (const doc of [
            "18:00:00.000 Slow autocomplete took 120ms",
            "18:00:00.000 Becca (note cache) load took 250ms",
            "18:00:00.000 Content hash computation took 90ms"
        ]) {
            expect(classesOf(doc)).toEqual([ "cm-log-timestamp" ]);
        }
    });

    it("locates the verb and URL spans for variable-length HTTP methods", () => {
        for (const [ doc, verb, url ] of [
            [ "18:18:38.904 200 GET /a with 1 bytes took 1ms", "GET", "/a" ],
            [ "18:18:38.904 204 DELETE /api/notes/x with 0 bytes took 2ms", "DELETE", "/api/notes/x" ],
            [ "18:18:38.904 200 OPTIONS /api/y?z=1 with 0 bytes took 2ms", "OPTIONS", "/api/y?z=1" ]
        ]) {
            const spans = decorationsOf(state(doc));
            expect(sliceOf(doc, spans, "cm-log-verb")).toBe(verb);
            expect(sliceOf(doc, spans, "cm-log-url")).toBe(url);
        }
    });

    it("handles the `Slow` marker the server prepends to slow requests", () => {
        // The `Slow ` prefix shifts the status/verb/URL offsets, so assert each span exactly.
        const doc = "00:10:01.540 Slow 304 GET /api/notes/kwjrB3G4TbPY/blob with 209 bytes took 147ms";
        const spans = decorationsOf(state(doc));

        expect(sliceOf(doc, spans, "cm-log-slow")).toBe("Slow");
        expect(sliceOf(doc, spans, "cm-log-status cm-log-status-3xx")).toBe("304");
        expect(sliceOf(doc, spans, "cm-log-verb")).toBe("GET");
        expect(sliceOf(doc, spans, "cm-log-url")).toBe("/api/notes/kwjrB3G4TbPY/blob");
        expect(sliceOf(doc, spans, "cm-log-timestamp")).toBe("00:10:01.540");
        expect(classesOf(doc)).toContain("cm-log-http"); // still treated as an HTTP line

        // A non-slow line carries no marker.
        expect(classesOf("18:18:38.904 204 PUT /api/options with 0 bytes took 2ms")).not.toContain("cm-log-slow");
    });

    it("handles ERROR: blocks, closes them at the next entry, and carries JS Info across lines", () => {
        const doc = [
            "17:34:08.519 ERROR: boom",          // 1: error header (ERROR: variant)
            "    at foo (bar.ts:1:2)",           // 2: error continuation
            "18:18:40.077 Slow query took 5ms",  // 3: plain entry — closes the error block
            "17:35:00.000 JS Info: started",     // 4: info header
            "    detail continues"               // 5: info continuation
        ].join("\n");
        const s = state(doc);

        expect(lineClassesAt(s, 1)).toContain("cm-log-error");
        expect(lineClassesAt(s, 2)).toContain("cm-log-error");
        expect(lineClassesAt(s, 3)).not.toContain("cm-log-error"); // block terminated
        expect(lineClassesAt(s, 4)).toContain("cm-log-info");
        expect(lineClassesAt(s, 5)).toContain("cm-log-info");
    });

    it("colours a WARNING: block and its continuation lines, closing it at the next entry", () => {
        const doc = [
            "17:34:08.519 WARNING: shaky",
            "    at foo (bar.ts:1:2)",
            "17:34:08.600 Becca (note cache) load took 120ms"
        ].join("\n");
        const s = state(doc);

        expect(lineClassesAt(s, 1)).toContain("cm-log-warning");
        expect(lineClassesAt(s, 2)).toContain("cm-log-warning");
        expect(lineClassesAt(s, 3)).not.toContain("cm-log-warning");
        expect(lineClassesAt(s, 1)).not.toContain("cm-log-error");
    });

    it("rebuilds decorations when the document changes (editable notes)", () => {
        let s = state("17:35:56.745 Backend script execution is DISABLED.");
        expect(classesOfState(s)).toEqual([ "cm-log-timestamp" ]);

        s = s.update({ changes: { from: s.doc.length, insert: "\n17:34:08.519 JS Error: boom" } }).state;
        expect(classesOfState(s)).toContain("cm-log-error");
    });

    it("adds no decorations to non-timestamped or empty content", () => {
        expect(decorationsOf(state("just some text\nanother line"))).toHaveLength(0);
        expect(decorationsOf(state(""))).toHaveLength(0);
    });

    it("only highlights the last MAX_HIGHLIGHTED_LINES lines of a large log", () => {
        // First line (beyond the cap) is an error header; if the whole doc were scanned it would be
        // coloured. The tail stays highlighted.
        const lines = [ "17:00:00.000 JS Error: old boom" ];
        for (let i = 0; i < MAX_HIGHLIGHTED_LINES + 50; i++) {
            lines.push(`18:00:00.${String(i % 1000).padStart(3, "0")} Slow query ${i}`);
        }
        const s = state(lines.join("\n"));

        // The first line's error header is beyond the cap, so it is never coloured.
        expect(lineClassesAt(s, 1)).toHaveLength(0);
        expect(classesOfState(s)).not.toContain("cm-log-error");

        // The tail is highlighted, and the number of scanned lines is bounded by the cap.
        const timestamps = classesOfState(s).filter((c) => c === "cm-log-timestamp");
        expect(timestamps.length).toBeGreaterThan(0);
        expect(timestamps.length).toBeLessThanOrEqual(MAX_HIGHLIGHTED_LINES);
    });

    describe("with a SQL language", () => {
        it("highlights the tokens of a slow query's statement", () => {
            const doc = "00:10:01.540 Slow query took 78ms: SELECT noteId FROM notes"
                + " WHERE title LIKE '%a%' AND isDeleted = 0 AND parentNoteId = ?";
            const spans = decorationsOf(sqlState(doc));

            expect(slicesOf(doc, spans, "tok-keyword"))
                .toEqual([ "SELECT", "FROM", "WHERE", "LIKE", "AND", "AND" ]);
            expect(slicesOf(doc, spans, "tok-string")).toEqual([ "'%a%'" ]);
            // The `78` of `took 78ms` is outside the statement.
            expect(slicesOf(doc, spans, "tok-number")).toEqual([ "0" ]);
            expect(sliceOf(doc, spans, "cm-log-query-verb")).toBe("Slow query");

            // Identifiers and placeholders keep the main text color.
            expect(classesOfState(sqlState(doc))).toContain("cm-log-query");
            expect(classesOfState(sqlState(doc))).not.toContain("cm-log-sql");
            const placeholder = doc.indexOf("?");
            expect(spans.filter((d) => d.from <= placeholder && d.to > placeholder)).toEqual([]);
        });

        it("tokenizes nothing on recursive queries, which have no statement", () => {
            const doc = [
                "00:10:01.540 Slow query took 30ms: SELECT 1",
                "00:10:02.113 Slow recursive query took 45ms."
            ].join("\n");
            const tokens = decorationsOf(sqlState(doc)).filter((d) => d.class.startsWith("tok-"));

            expect(tokens.map((d) => doc.slice(d.from, d.to))).toEqual([ "SELECT", "1" ]);
        });

        it("reclassifies the tokens when the theme changes, without rescanning the log", () => {
            const doc = "00:10:01.540 Slow query took 78ms: SELECT 1";
            const theme = new Compartment();
            let s = sqlState(doc, theme.of(syntaxHighlighting(classHighlighter)));
            const logDecorations = logDecorationsOf(s);
            expect(sliceOf(doc, decorationsOf(s), "tok-keyword")).toBe("SELECT");

            const style = HighlightStyle.define([ { tag: tags.keyword, class: "keyword" } ]);
            s = s.update({ effects: theme.reconfigure(syntaxHighlighting(style)) }).state;

            expect(sliceOf(doc, decorationsOf(s), "keyword")).toBe("SELECT");
            expect(classesOfState(s)).not.toContain("tok-keyword");
            expect(logDecorationsOf(s)).toBe(logDecorations);
        });

        it("keeps the SQL marks through a reconfigure that leaves the code theme alone", () => {
            // `performFind()` reconfigures the editor on every search.
            const doc = "00:10:01.540 Slow query took 78ms: SELECT 1";
            const search = new Compartment();
            const s = sqlState(doc, [ syntaxHighlighting(classHighlighter), search.of([]) ]);
            const sets = s.facet(EditorView.decorations);
            const next = s.update({ effects: search.reconfigure(EditorView.lineWrapping) }).state;

            expect(sliceOf(doc, decorationsOf(next), "tok-keyword")).toBe("SELECT");
            const nextSets = next.facet(EditorView.decorations);
            expect(nextSets).toHaveLength(sets.length);
            expect(nextSets.every((set, index) => set === sets[index])).toBe(true);
        });

        it("keeps every decoration set unless the document or the configuration changes", () => {
            const doc = "00:10:01.540 Slow query took 78ms: SELECT 1";
            for (const s of [ state(doc), sqlState(doc) ]) {
                const sets = s.facet(EditorView.decorations);
                const next = s.update({ selection: { anchor: 1 } }).state
                    .facet(EditorView.decorations);
                expect(next).toHaveLength(sets.length);
                expect(next.every((set, index) => set === sets[index])).toBe(true);
            }

            // Without a language there are no SQL marks to reclassify.
            const compartment = new Compartment();
            const plain = EditorState.create({
                doc, extensions: [ triliumLogHighlighter(), compartment.of([]) ]
            });
            const reconfigured = plain.update({
                effects: compartment.reconfigure(syntaxHighlighting(classHighlighter))
            }).state;
            expect(logDecorationsOf(reconfigured)).toBe(logDecorationsOf(plain));
            expect(classesOfState(reconfigured)).toContain("cm-log-sql");
        });

        it("only tokenizes statements within the last MAX_HIGHLIGHTED_LINES lines", () => {
            const lines = [ "17:00:00.000 Slow query took 30ms: SELECT 1" ];
            for (let i = 0; i < MAX_HIGHLIGHTED_LINES; i++) {
                lines.push("18:00:00.000 Backend script execution is DISABLED.");
            }
            lines.push("19:00:00.000 Slow query took 30ms: SELECT 2");
            const doc = lines.join("\n");
            const spans = decorationsOf(sqlState(doc));

            expect(slicesOf(doc, spans, "tok-keyword")).toEqual([ "SELECT" ]);
            expect(slicesOf(doc, spans, "tok-number")).toEqual([ "2" ]);
        });
    });
});

function state(doc: string): EditorState {
    return EditorState.create({ doc, extensions: [ triliumLogHighlighter() ] });
}

function sqlState(doc: string, highlighting: Extension = syntaxHighlighting(classHighlighter)) {
    return EditorState.create({
        doc, extensions: [ triliumLogHighlighter(sqlLanguage), highlighting ]
    });
}

/** The first decoration set, which holds the log's own decorations. */
function logDecorationsOf(editorState: EditorState) {
    return editorState.facet(EditorView.decorations).find((set) => typeof set !== "function");
}

/** All decoration ranges contributed to the view's decoration facet, in document order. */
function decorationsOf(editorState: EditorState): DecorationSpan[] {
    const spans: DecorationSpan[] = [];
    for (const set of editorState.facet(EditorView.decorations)) {
        if (typeof set === "function") continue; // plugin-provided sources (none here)
        const iter = set.iter();
        while (iter.value) {
            spans.push({ from: iter.from, to: iter.to, class: iter.value.spec.class });
            iter.next();
        }
    }
    return spans;
}

function classesOf(doc: string): string[] {
    return decorationsOf(state(doc)).map((d) => d.class);
}

function classesOfState(editorState: EditorState): string[] {
    return decorationsOf(editorState).map((d) => d.class);
}

/** The document text covered by the (first) span carrying `cls`. */
function sliceOf(doc: string, spans: DecorationSpan[], cls: string): string | undefined {
    const span = spans.find((d) => d.class === cls);
    return span && doc.slice(span.from, span.to);
}

/** The document text covered by each span carrying `cls`, in document order. */
function slicesOf(doc: string, spans: DecorationSpan[], cls: string): string[] {
    return spans.filter((d) => d.class === cls).map((d) => doc.slice(d.from, d.to));
}

/** Classes of the line decorations (zero-length, at the line start) on line `lineNo` (1-based). */
function lineClassesAt(editorState: EditorState, lineNo: number): string[] {
    const from = editorState.doc.line(lineNo).from;
    return decorationsOf(editorState)
        .filter((d) => d.from === from && d.to === from)
        .map((d) => d.class);
}
