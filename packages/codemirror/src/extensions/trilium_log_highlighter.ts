import { highlightingFor, type Language } from "@codemirror/language";
import { type EditorState, type Extension, RangeSetBuilder, StateField } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView } from "@codemirror/view";
import { type Highlighter, highlightTree, type Tag } from "@lezer/highlight";

import { decorateSearchQuery, searchHighlightTheme } from "./trilium_search_highlighter.js";

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
 *  - HTTP request lines `<ts> [Slow ]<status> <VERB> <url> …` — the whole line is tinted, the verb
 *    bolded, the URL coloured and the status colour-coded by class (2xx/3xx/4xx/5xx). The optional
 *    `Slow` marker (prepended by the server for requests taking >= 10ms) is flagged as a warning.
 *  - slow SQL query lines `<ts> Slow [recursive ]query took <n>ms[: <sql>]` — the whole line is
 *    tinted, the entire `Slow [recursive ]query` phrase bolded as the entry's verb (its own colour,
 *    not the HTTP method's), and the statement (absent for recursive queries) highlighted with the
 *    SQL language in the active code theme, or in one colour without a language. Unlike HTTP,
 *    `Slow` is not flagged as a warning here: queries are only logged when slow, so it is uninformative.
 *  - search lines `<ts> Search: <query>  (returned <n> items)`, which follow a `GET /api/search`
 *    request: the verb bolded, the query highlighted as search syntax and the count muted
 *  - `<ts> JS Error: …` and `<ts> ERROR: …` lines — coloured red, together with their following
 *    continuation lines (e.g. wrapped stack traces), which carry no timestamp of their own
 *  - `<ts> WARNING: …` lines — coloured amber, with their continuation lines like errors
 *  - `<ts> JS Info: …` lines (and their continuation lines) — placeholder class, no colour yet
 */

// Length of the leading `HH:MM:SS.mmm` timestamp.
const TIMESTAMP_LENGTH = 12;
const TIMESTAMP = /^\d{2}:\d{2}:\d{2}\.\d{3}/;
// After `<ts> `: an optional `Slow ` marker (the server prepends it when the request took >= 10ms),
// a 3-digit status, a space, a known HTTP verb, a space, then the request URL (a single
// whitespace-free token). Everything up to the URL is fixed-width once the optional marker's length
// is known, so the offsets can be derived without a rescan.
const HTTP_REQUEST = /^\d{2}:\d{2}:\d{2}\.\d{3} (Slow )?(\d{3}) (GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS) (\S+)/;
/** Length of the `Slow` word itself (the capture group includes its trailing space). */
const SLOW_LENGTH = 4;
const ERROR_LINE = /^\d{2}:\d{2}:\d{2}\.\d{3} (?:JS Error|ERROR):/;
const WARNING_LINE = /^\d{2}:\d{2}:\d{2}\.\d{3} WARNING:/;
const INFO_LINE = /^\d{2}:\d{2}:\d{2}\.\d{3} JS Info:/;
// Slow SQL queries (logged when a query takes >= 20ms). Two shapes:
//   `Slow query took 78ms: SELECT …`      — the statement follows, whitespace-normalised to one line
//   `Slow recursive query took 45ms.`     — the statement is omitted entirely
// `Slow` is part of the phrase here, not a conditional marker as on HTTP lines: a query is only
// logged *at all* when it is slow, so the whole `Slow [recursive ]query` is captured as one verb.
// The fixed words are captured (rather than matched literally) so their lengths give the offsets of
// the parts that follow. Anchored on `query` so sibling timings — `Slow autocomplete took …ms`,
// `Becca (note cache) load took …ms`, `Content hash computation took …ms` — are not caught.
const SLOW_QUERY = /^\d{2}:\d{2}:\d{2}\.\d{3} (Slow (?:recursive )?query)( took )(\d+ms)(?:: (.+))?/;
// The query of a `GET /api/search` request, decoded, and the number of notes it found.
const SEARCH = /^\d{2}:\d{2}:\d{2}\.\d{3} (Search): (.*) {2}(\(returned \d+ items\))$/;

/**
 * Upper bound on how many (trailing) lines are highlighted, to cap the per-rebuild work. Sized well
 * above a typical single-day backend log (which can be ~10k lines); only pathologically large logs
 * lose highlighting on their oldest lines.
 */
export const MAX_HIGHLIGHTED_LINES = 30_000;

const timestampMark = Decoration.mark({ class: "cm-log-timestamp" });
const slowMark = Decoration.mark({ class: "cm-log-slow" });
const verbMark = Decoration.mark({ class: "cm-log-verb" });
const urlMark = Decoration.mark({ class: "cm-log-url" });
const queryVerbMark = Decoration.mark({ class: "cm-log-query-verb" });
const sqlMark = Decoration.mark({ class: "cm-log-sql" });
const searchVerbMark = Decoration.mark({ class: "cm-log-search-verb" });
const searchQueryMark = Decoration.mark({ class: "cm-log-search-query" });
const searchCountMark = Decoration.mark({ class: "cm-log-search-count" });
const httpLine = Decoration.line({ class: "cm-log-http" });
const queryLine = Decoration.line({ class: "cm-log-query" });
const errorLine = Decoration.line({ class: "cm-log-error" });
const warningLine = Decoration.line({ class: "cm-log-warning" });
const infoLine = Decoration.line({ class: "cm-log-info" });
const statusMarks: Record<string, Decoration> = {
    "2": Decoration.mark({ class: "cm-log-status cm-log-status-2xx" }),
    "3": Decoration.mark({ class: "cm-log-status cm-log-status-3xx" }),
    "4": Decoration.mark({ class: "cm-log-status cm-log-status-4xx" }),
    "5": Decoration.mark({ class: "cm-log-status cm-log-status-5xx" })
};
/** Marks of the SQL tokens, one per class string of the code theme. */
const sqlTokenMarks = new Map<string, Decoration>();

/**
 * The Next themes own the palette (`--log-*` in theme-next-light.css / theme-next-dark.css). The
 * fallbacks below are what the legacy themes — which don't define those variables — render with.
 */
const logHighlightTheme = EditorView.baseTheme({
    ".cm-log-timestamp": { color: "var(--log-timestamp-color, var(--muted-text-color))" },
    ".cm-log-http": { backgroundColor: "var(--log-http-line-background-color, color-mix(in srgb, var(--main-text-color) 3%, transparent))" },
    ".cm-log-slow": { fontWeight: "bold", color: "var(--log-slow-color, #d29922)" },
    ".cm-log-verb": { fontWeight: "bold", color: "var(--log-http-verb-color, #539bf5)" },
    ".cm-log-url": { color: "var(--log-http-url-color, #268a8a)" },
    ".cm-log-query": { backgroundColor: "var(--log-query-line-background-color, color-mix(in srgb, var(--main-text-color) 3%, transparent))" },
    ".cm-log-query-verb": { fontWeight: "bold", color: "var(--log-query-verb-color, #bf3989)" },
    ".cm-log-sql": { color: "var(--log-sql-color, #8957e5)" },
    ".cm-log-search-verb": { fontWeight: "bold", color: "var(--log-search-verb-color, #3f9189)" },
    ".cm-log-search-query": {
        border: "1px solid var(--log-search-query-border-color, var(--main-border-color))",
        borderRadius: "3px",
        padding: "0 2px"
    },
    ".cm-log-search-count": { color: "var(--log-search-count-color, var(--muted-text-color))" },
    ".cm-log-status": { fontWeight: "bold" },
    ".cm-log-status-2xx": { color: "var(--log-status-success-color, #2ea043)" },
    ".cm-log-status-3xx": { color: "var(--log-status-redirect-color, var(--muted-text-color))" },
    ".cm-log-status-4xx": { color: "var(--log-status-client-error-color, #d29922)" },
    ".cm-log-status-5xx": { color: "var(--log-status-server-error-color, #e5534b)" },
    ".cm-log-error": {
        color: "var(--log-error-color, #e5534b)",
        // Transparent by default — set `--log-error-line-background-color` to tint the whole line
        // the way `.cm-log-http` is.
        backgroundColor: "var(--log-error-line-background-color, transparent)"
    },
    ".cm-log-warning": {
        color: "var(--log-warning-color, #d29922)",
        backgroundColor: "var(--log-warning-line-background-color, transparent)"
    },
    // Placeholder: no colour yet — set `--log-info-color` to activate.
    ".cm-log-info": { color: "var(--log-info-color, inherit)" }
});

/** The statement of a slow query and its start offset in the document. */
interface SqlStatement {
    from: number;
    text: string;
}

interface SqlHighlights {
    /** The tokens of the statements, with the classes of the active code theme. */
    sql: DecorationSet;
    /** The class of each tag set in `sql`, in the code theme that `sql` was built with. */
    styles: Map<readonly Tag[], string | null>;
}

interface LogHighlights extends SqlHighlights {
    log: DecorationSet;
    /** The statements in the highlighted lines; empty without a SQL language. */
    statements: SqlStatement[];
}

/**
 * The extension to register on the backend-log editor (e.g. via a `text/x-trilium-log` MIME type).
 * `sqlLanguage` highlights the statements of slow queries; without it, a statement gets one color.
 */
export function triliumLogHighlighter(sqlLanguage: Language | null = null): Extension {
    const field = StateField.define<LogHighlights>({
        create: (state) => buildHighlights(state, sqlLanguage),
        update(highlights, tr) {
            if (tr.docChanged) return buildHighlights(tr.state, sqlLanguage);
            // `performFind()` reconfigures on every search, so a reconfigure rebuilds the SQL marks
            // only when the code theme gives one of their tag sets another class.
            if (tr.reconfigured && sqlLanguage && isRestyled(tr.state, highlights.styles)) {
                const sql = buildSqlHighlights(tr.state, highlights.statements, sqlLanguage);
                return { ...highlights, ...sql };
            }
            return highlights;
        },
        provide: (f) => [
            EditorView.decorations.from(f, (highlights) => highlights.log),
            EditorView.decorations.from(f, (highlights) => highlights.sql)
        ]
    });
    return [ field, logHighlightTheme, searchHighlightTheme ];
}

function buildHighlights(state: EditorState, sqlLanguage: Language | null): LogHighlights {
    const builder = new RangeSetBuilder<Decoration>();
    const statements: SqlStatement[] = [];
    const collectedStatements = sqlLanguage ? statements : null;
    const doc = state.doc;

    // Scan at most the last MAX_HIGHLIGHTED_LINES lines. A single top-to-bottom pass over that window
    // keeps the error/info block state (used to colour continuation lines) flowing across lines; a
    // stack trace straddling the window's top edge may miss its colour, which is acceptable for a log
    // that large.
    const firstLine = Math.max(1, doc.lines - MAX_HIGHLIGHTED_LINES + 1);
    let blockLine: Decoration | null = null;
    for (let n = firstLine; n <= doc.lines; n++) {
        blockLine = decorateLine(builder, doc.line(n), blockLine, collectedStatements);
    }

    const sql = sqlLanguage
        ? buildSqlHighlights(state, statements, sqlLanguage)
        : { sql: Decoration.none, styles: new Map() };
    return { log: builder.finish(), statements, ...sql };
}

/** Marks the tokens of each statement with the classes that the active code theme gives them. */
function buildSqlHighlights(
    state: EditorState, statements: SqlStatement[], language: Language
): SqlHighlights {
    const builder = new RangeSetBuilder<Decoration>();
    const styles: SqlHighlights["styles"] = new Map();
    const highlighter: Highlighter = {
        style(tags) {
            if (!styles.has(tags)) styles.set(tags, highlightingFor(state, tags));
            return styles.get(tags) ?? null;
        }
    };
    for (const { from, text } of statements) {
        highlightTree(language.parser.parse(text), highlighter, (start, end, classes) => {
            builder.add(from + start, from + end, sqlTokenMark(classes));
        });
    }
    return { sql: builder.finish(), styles };
}

/** Whether the code theme of `state` gives a tag set in `styles` another class. */
function isRestyled(state: EditorState, styles: SqlHighlights["styles"]) {
    for (const [ tags, classes ] of styles) {
        if (highlightingFor(state, tags) !== classes) return true;
    }
    return false;
}

function sqlTokenMark(classes: string) {
    let mark = sqlTokenMarks.get(classes);
    if (!mark) {
        mark = Decoration.mark({ class: classes });
        sqlTokenMarks.set(classes, mark);
    }
    return mark;
}

/**
 * Returns the line decoration a multi-line block entry applies to itself and its continuation lines
 * (e.g. `errorLine` for `JS Error:`/`ERROR:`, `warningLine` for `WARNING:`, `infoLine` for `JS Info:`), or null for entries that
 * don't span lines. `null` for continuation lines, which carry no timestamp.
 */
function blockLineFor(text: string): Decoration | null {
    if (ERROR_LINE.test(text)) return errorLine;
    if (WARNING_LINE.test(text)) return warningLine;
    if (INFO_LINE.test(text)) return infoLine;
    return null;
}

/**
 * Decorates a single line and returns the block decoration in effect for the following
 * (continuation) lines. A timestamped line opens a block (or closes any open one); a line without a
 * timestamp inherits the incoming `blockLine`. The statement of a slow query goes into `statements`
 * for SQL highlighting, or gets `sqlMark` if `statements` is null.
 */
function decorateLine(
    builder: RangeSetBuilder<Decoration>,
    line: { from: number; text: string },
    blockLine: Decoration | null,
    statements: SqlStatement[] | null
): Decoration | null {
    const { from: lineStart, text } = line;

    if (!TIMESTAMP.test(text)) {
        // Continuation line (e.g. a wrapped stack trace): inherit the current block's colour.
        if (blockLine) {
            builder.add(lineStart, lineStart, blockLine);
        }
        return blockLine;
    }

    const httpMatch = HTTP_REQUEST.exec(text);
    const queryMatch = httpMatch ? null : SLOW_QUERY.exec(text);
    const searchMatch = httpMatch || queryMatch ? null : SEARCH.exec(text);
    const newBlockLine = httpMatch ? null : blockLineFor(text);
    // Line decorations must be added at the line start before any mark that begins there.
    if (httpMatch) {
        builder.add(lineStart, lineStart, httpLine);
    } else if (queryMatch) {
        builder.add(lineStart, lineStart, queryLine);
    } else if (newBlockLine) {
        builder.add(lineStart, lineStart, newBlockLine);
    }

    builder.add(lineStart, lineStart + TIMESTAMP_LENGTH, timestampMark);

    if (httpMatch) {
        // Layout: `<12-char ts><space>[Slow ]<3-char status><space><verb><space><url>`. The optional
        // `Slow ` capture includes its trailing space, so its length shifts everything after it.
        const [ , slowPrefix = "", status, verb, url ] = httpMatch;
        const slowStart = lineStart + TIMESTAMP_LENGTH + 1;
        const statusStart = slowStart + slowPrefix.length;
        const verbStart = statusStart + 4; // 3-digit status + space
        const urlStart = verbStart + verb.length + 1;

        if (slowPrefix) {
            builder.add(slowStart, slowStart + SLOW_LENGTH, slowMark);
        }
        const statusMark = statusMarks[status[0]];
        if (statusMark) {
            builder.add(statusStart, statusStart + 3, statusMark);
        }
        builder.add(verbStart, verbStart + verb.length, verbMark);
        builder.add(urlStart, urlStart + url.length, urlMark);
    } else if (queryMatch) {
        // Layout: `<12-char ts><space><verb> took <n>ms[: <sql>]`, where the verb is the whole
        // `Slow [recursive ]query` phrase — the counterpart of an HTTP method, with its own colour.
        // The duration is left undecorated; it is captured only because its length locates the
        // statement after it.
        const [ , queryVerb, tookWord, duration, sql ] = queryMatch;
        const verbStart = lineStart + TIMESTAMP_LENGTH + 1;
        const verbEnd = verbStart + queryVerb.length;

        builder.add(verbStart, verbEnd, queryVerbMark);
        if (sql) {
            const sqlStart = verbEnd + tookWord.length + duration.length + 2; // ": "
            if (statements) {
                statements.push({ from: sqlStart, text: sql });
            } else {
                builder.add(sqlStart, sqlStart + sql.length, sqlMark);
            }
        }
    } else if (searchMatch) {
        // Layout: `<12-char ts><space>Search: <query>  (returned <n> items)`.
        const [ , searchVerb, query, count ] = searchMatch;
        const verbStart = lineStart + TIMESTAMP_LENGTH + 1;
        const lineEnd = lineStart + text.length;

        const queryStart = verbStart + searchVerb.length + 2; // ": "

        builder.add(verbStart, verbStart + searchVerb.length, searchVerbMark);
        // Added before the token marks that start at the same position, so it wraps them.
        if (query) {
            builder.add(queryStart, queryStart + query.length, searchQueryMark);
        }
        decorateSearchQuery(builder, query, queryStart);
        builder.add(lineEnd - count.length, lineEnd, searchCountMark);
    }

    return newBlockLine;
}
