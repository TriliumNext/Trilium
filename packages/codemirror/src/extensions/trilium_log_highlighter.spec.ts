import { Compartment, EditorState } from "@codemirror/state";
import { EditorView } from "@codemirror/view";
import { describe, expect, it } from "vitest";

import { MAX_HIGHLIGHTED_LINES, triliumLogHighlighter } from "./trilium_log_highlighter.js";

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

        const after = before.update({ effects: compartment.reconfigure(triliumLogHighlighter) }).state;
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

        const plain = classesOf("18:18:40.077 Slow query took 78ms: SELECT 1");
        expect(plain).toEqual([ "cm-log-timestamp" ]);
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

    it("rebuilds decorations when the document changes (editable notes)", () => {
        let s = state("18:18:40.077 Slow query took 78ms");
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
});

function state(doc: string): EditorState {
    return EditorState.create({ doc, extensions: [ triliumLogHighlighter ] });
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

/** Classes of the line decorations (zero-length, at the line start) on line `lineNo` (1-based). */
function lineClassesAt(editorState: EditorState, lineNo: number): string[] {
    const from = editorState.doc.line(lineNo).from;
    return decorationsOf(editorState)
        .filter((d) => d.from === from && d.to === from)
        .map((d) => d.class);
}
