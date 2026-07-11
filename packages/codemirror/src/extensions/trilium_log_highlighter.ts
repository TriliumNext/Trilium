import { type EditorState, type Extension, RangeSetBuilder, StateField } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView } from "@codemirror/view";

/**
 * Lightweight regex highlighter for the Trilium backend log. Each log entry is a single line
 * beginning with a `HH:MM:SS.mmm` timestamp. The decorations live in a {@link StateField} (rather
 * than a view plugin) so they are applied deterministically the instant the extension enters the
 * configuration — e.g. when a code note is switched to the `text/x-trilium-log` MIME type — instead
 * of only after the next edit or scroll (a dynamically added view plugin doesn't paint until the
 * following update). Only the last {@link MAX_HIGHLIGHTED_LINES} lines are scanned (top-to-bottom
 * within that window) so a large backend log — potentially a whole day of per-request lines — can't
 * block the main thread; logs append newest-last and the view scrolls to the end, so the tail is
 * the relevant part. That single pass also lets the error/info block state carry across continuation
 * lines without a separate backwards scan.
 *
 * Recognised entries:
 *  - the leading timestamp (muted, on every entry)
 *  - HTTP request lines `<ts> <status> <VERB> …` — the whole line is tinted, the verb bolded and
 *    the status colour-coded by class (2xx/3xx/4xx/5xx)
 *  - `<ts> JS Error: …` and `<ts> ERROR: …` lines — coloured red, together with their following
 *    continuation lines (e.g. wrapped stack traces), which carry no timestamp of their own
 *  - `<ts> JS Info: …` lines (and their continuation lines) — placeholder class, no colour yet
 */

// Length of the leading `HH:MM:SS.mmm` timestamp.
const TIMESTAMP_LENGTH = 12;
const TIMESTAMP = /^\d{2}:\d{2}:\d{2}\.\d{3}/;
// After `<ts> `: a 3-digit status, a space, a known HTTP verb, a space, then the request URL (a
// single whitespace-free token). The fixed-width prefix lets us derive the offsets without a rescan.
const HTTP_REQUEST = /^\d{2}:\d{2}:\d{2}\.\d{3} (\d{3}) (GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS) (\S+)/;
const ERROR_LINE = /^\d{2}:\d{2}:\d{2}\.\d{3} (?:JS Error|ERROR):/;
const INFO_LINE = /^\d{2}:\d{2}:\d{2}\.\d{3} JS Info:/;

/** Upper bound on how many (trailing) lines are highlighted, to cap the per-rebuild work. */
export const MAX_HIGHLIGHTED_LINES = 10_000;

const timestampMark = Decoration.mark({ class: "cm-log-timestamp" });
const verbMark = Decoration.mark({ class: "cm-log-verb" });
const urlMark = Decoration.mark({ class: "cm-log-url" });
const httpLine = Decoration.line({ class: "cm-log-http" });
const errorLine = Decoration.line({ class: "cm-log-error" });
const infoLine = Decoration.line({ class: "cm-log-info" });
const statusMarks: Record<string, Decoration> = {
    "2": Decoration.mark({ class: "cm-log-status cm-log-status-2xx" }),
    "3": Decoration.mark({ class: "cm-log-status cm-log-status-3xx" }),
    "4": Decoration.mark({ class: "cm-log-status cm-log-status-4xx" }),
    "5": Decoration.mark({ class: "cm-log-status cm-log-status-5xx" })
};

const logHighlightTheme = EditorView.baseTheme({
    ".cm-log-timestamp": { color: "var(--muted-text-color)" },
    ".cm-log-http": { backgroundColor: "var(--log-http-line-background-color, color-mix(in srgb, var(--main-text-color) 3%, transparent))" },
    ".cm-log-verb": { fontWeight: "bold", color: "var(--log-http-verb-color, #539bf5)" },
    ".cm-log-url": { color: "var(--log-http-url-color, #268a8a)" },
    ".cm-log-status": { fontWeight: "bold" },
    ".cm-log-status-2xx": { color: "var(--log-status-success-color, #2ea043)" },
    ".cm-log-status-3xx": { color: "var(--log-status-redirect-color, var(--muted-text-color))" },
    ".cm-log-status-4xx": { color: "var(--log-status-client-error-color, #d29922)" },
    ".cm-log-status-5xx": { color: "var(--log-status-server-error-color, #e5534b)" },
    ".cm-log-error": { color: "var(--log-error-color, #e5534b)" },
    // Placeholder: no colour yet — set `--log-info-color` to activate.
    ".cm-log-info": { color: "var(--log-info-color, inherit)" }
});

const logHighlightField = StateField.define<DecorationSet>({
    create(state) {
        return buildLogDecorations(state);
    },
    update(decorations, tr) {
        return tr.docChanged ? buildLogDecorations(tr.state) : decorations;
    },
    provide: (field) => EditorView.decorations.from(field)
});

/** The extension to register on the backend-log editor (e.g. via a `text/x-trilium-log` MIME type). */
export const triliumLogHighlighter: Extension = [ logHighlightField, logHighlightTheme ];

function buildLogDecorations(state: EditorState): DecorationSet {
    const builder = new RangeSetBuilder<Decoration>();
    const doc = state.doc;

    // Scan at most the last MAX_HIGHLIGHTED_LINES lines. A single top-to-bottom pass over that window
    // keeps the error/info block state (used to colour continuation lines) flowing across lines; a
    // stack trace straddling the window's top edge may miss its colour, which is acceptable for a log
    // that large.
    const firstLine = Math.max(1, doc.lines - MAX_HIGHLIGHTED_LINES + 1);
    let blockLine: Decoration | null = null;
    for (let n = firstLine; n <= doc.lines; n++) {
        blockLine = decorateLine(builder, doc.line(n), blockLine);
    }

    return builder.finish();
}

/**
 * Returns the line decoration a multi-line block entry applies to itself and its continuation lines
 * (e.g. `errorLine` for `JS Error:`/`ERROR:`, `infoLine` for `JS Info:`), or null for entries that
 * don't span lines. `null` for continuation lines, which carry no timestamp.
 */
function blockLineFor(text: string): Decoration | null {
    if (ERROR_LINE.test(text)) return errorLine;
    if (INFO_LINE.test(text)) return infoLine;
    return null;
}

/**
 * Decorates a single line and returns the block decoration in effect for the following
 * (continuation) lines. A timestamped line opens a block (or closes any open one); a line without a
 * timestamp inherits the incoming `blockLine`.
 */
function decorateLine(builder: RangeSetBuilder<Decoration>, line: { from: number; text: string }, blockLine: Decoration | null): Decoration | null {
    const { from: lineStart, text } = line;

    if (!TIMESTAMP.test(text)) {
        // Continuation line (e.g. a wrapped stack trace): inherit the current block's colour.
        if (blockLine) {
            builder.add(lineStart, lineStart, blockLine);
        }
        return blockLine;
    }

    const httpMatch = HTTP_REQUEST.exec(text);
    const newBlockLine = httpMatch ? null : blockLineFor(text);
    // Line decorations must be added at the line start before any mark that begins there.
    if (httpMatch) {
        builder.add(lineStart, lineStart, httpLine);
    } else if (newBlockLine) {
        builder.add(lineStart, lineStart, newBlockLine);
    }

    builder.add(lineStart, lineStart + TIMESTAMP_LENGTH, timestampMark);

    if (httpMatch) {
        // Fixed layout: `<12-char ts><space><3-char status><space><verb>`.
        const statusStart = lineStart + TIMESTAMP_LENGTH + 1;
        const verbStart = statusStart + 4;
        const statusMark = statusMarks[httpMatch[1][0]];
        if (statusMark) {
            builder.add(statusStart, statusStart + 3, statusMark);
        }
        builder.add(verbStart, verbStart + httpMatch[2].length, verbMark);
        const urlStart = verbStart + httpMatch[2].length + 1;
        builder.add(urlStart, urlStart + httpMatch[3].length, urlMark);
    }

    return newBlockLine;
}
