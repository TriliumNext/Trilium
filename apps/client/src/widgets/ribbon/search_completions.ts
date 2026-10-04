import { ALLOWED_NOTE_TYPES, allowedSearchOperators, MIME_TYPES_DICT, NOTE_TYPE_ICONS, SEARCH_NOTE_PATH } from "@triliumnext/commons";

import { t } from "../../services/i18n";
import server from "../../services/server";
import type { CommandEntry } from "../react/NoteAutocomplete";

/**
 * What can be completed at the cursor of a search string: what a pick replaces, from `from` up to
 * the cursor, and which list offers it.
 *
 * - `notes`: the notes an `@` picks, listed as the note autocomplete lists them.
 * - `attributes`: the label or relation names in the database, listed as the attribute panel lists them.
 * - `entries`: everything else the syntax offers, listed as the command palette lists its commands.
 */
export type SearchCompletion = { from: number; query: string } & (
    | { kind: "notes" }
    | { kind: "attributes"; type: "label" | "relation" }
    | {
        kind: "entries";
        /** Identifies the entries among the others offered at the same place. */
        key: string;
        entries(): SearchEntry[] | Promise<SearchEntry[]>;
        /** Opens the list with the best match highlighted, so that Enter takes it. */
        preselect: boolean;
    }
);

/** An entry of the syntax, and the text a pick inserts for it. */
export interface SearchEntry extends CommandEntry {
    insert: string;
}

/**
 * Offers Trilium's search syntax at the end of `before`, the text of the line up to the cursor: the
 * notes picked with `@`, the `note` object, the keywords, the property path that hangs off `note`
 * or off a relation, the comparison operators — whose spellings (`*=*`, `=*`, `~=`) are the part of
 * the syntax hardest to recall — the label and relation names in the database, and the values a
 * label or a property is compared against. `explicit` is set where the user asked with Ctrl-Space.
 */
export function searchCompletionAt(before: string, explicit: boolean): SearchCompletion | null {
    const context = { before, pos: before.length, explicit };

    // Read before the rest: `@` is a name character to the lexer, so the branches below would answer
    // for one typed inside an attribute name, and the value branches for the query after it.
    const mention = matchBefore(context, NOTE_MENTION);
    if (mention) {
        const at = mention.from + mention.text.indexOf("@");

        return { kind: "notes", from: at, query: before.slice(at + 1) };
    }

    const path = matchBefore(context, PROPERTY_PATH);
    if (path) {
        return pathCompletion(path.text, context.pos);
    }

    // `~=` and `~*` reach the operators below instead: an attribute name cannot be spelled with
    // either character, so the pattern finds nothing ending at the cursor.
    const attribute = matchBefore(context, ATTRIBUTE_PREFIX);
    if (attribute) {
        const from = attribute.from + (attribute.text[1] === "!" ? 2 : 1);

        return { kind: "attributes", type: attribute.text[0] === "#" ? "label" : "relation", from, query: before.slice(from) };
    }

    const value = labelValueBeingTyped(context);
    if (value) {
        const { name, quote } = value;

        return entries(context, `values:${name}`, context.pos - value.typed.length, () => labelValues(name, quote));
    }

    const property = propertyValueBeingTyped(context);
    if (property) {
        return entries(context, `property:${property.property}`, context.pos - property.typed.length, () => property.entries);
    }

    // An ordering names a key and sorts on it, comparing nothing.
    const ordering = orderingPosition(context);
    const operators = () => (ordering === "none" ? operatorEntries(context) : []);

    const operator = matchBefore(context, OPERATOR_PREFIX);
    if (operator) {
        return operators().length ? entries(context, "operators", operator.from, operators) : null;
    }

    // A plain word is most often a search term, so the keywords wait for Ctrl-Space.
    const word = matchBefore(context, WORD_PREFIX);
    if (word) {
        return explicit ? entries(context, `words:${ordering}`, word.from, () => wordEntries(ordering)) : null;
    }

    // Ctrl-Space on empty space asks for everything on offer.
    if (explicit) {
        return entries(context, `all:${ordering}`, context.pos, () => [ ...wordEntries(ordering), ...operators() ]);
    }

    return null;
}

/**
 * A note picked with `@`, which opens only where a value can stand — at the start, or after
 * whitespace, an opening bracket or an operator. `@` is a name character to the lexer, so one
 * typed inside an attribute name is left alone.
 */
const NOTE_MENTION = /(?:^|[\s(=!*<>%~])@[^\s#~()'"`@]*/;
/** The characters an operator is spelled with, so typing any of them starts offering them. */
const OPERATOR_PREFIX = /[=!*<>%~]+/;
const WORD_PREFIX = /[a-zA-Z]+/;
/** A name runs until whitespace or a structural character, as it does in the lexer. */
const SEGMENT = "[^\\s#~().,=<>*!%+\\-'\"`]";
/** The `note` object or a relation, followed by the dotted path walked from it. */
const PROPERTY_PATH = new RegExp(`(?:^|[\\s(])(?:note|~${SEGMENT}+)(?:\\.${SEGMENT}*)+`);
/** Matches once an `orderBy` has been opened anywhere before the cursor. */
const ORDER_BY_BEFORE = /orderby[^]*/i;
/** A `#label` or `~relation`, either optionally negated with `!`. */
const ATTRIBUTE_PREFIX = new RegExp(`[#~]!?${SEGMENT}*`);
/**
 * The attribute or property path an operator is being typed against. The operator characters are
 * matched along with it so the pattern ends at the cursor, and only the operand is captured.
 */
const COMPARISON_OPERAND = new RegExp(`((?:[#~]!?)?${SEGMENT}+(?:\\.${SEGMENT}+)*)\\s*[=!*<>%~]*`);
/**
 * A label compared with an operator, and whatever stands between that operator and the cursor. The
 * tail stops at the characters that open another clause, so in a query holding several comparisons
 * the one being typed is the one that matches.
 */
const LABEL_COMPARISON = new RegExp(`(?:#|\\.labels\\.)(${SEGMENT}+)\\s*[=!*<>%~]+([^#~()]*)`);
/**
 * The same for a note property, which is the last segment of the path walked to it. Its tail runs
 * to the whitespace after the value rather than to the next clause: `note.` opens a comparison but
 * does not close the one before it, so a tail that ran on would let the first comparison in a query
 * swallow the one being typed. Every property completed below holds values spelled without spaces.
 */
const PROPERTY_COMPARISON = new RegExp(
    `(?:note|~${SEGMENT}+)(?:\\.${SEGMENT}+)*\\.(${SEGMENT}+)\\s*[=!*<>%~]+(\\s*[^\\s#~()]*)`
);
const QUOTES = [ "\"", "'", "`" ];
/** What the lexer reads as structure, so a value holding one of these only survives in quotes. */
const VALUE_NEEDS_QUOTES = /[\s"'`\\#~().=*<>!%+,-]/;
/**
 * Operands the parser reads as something other than the text they spell: `now`, `today`, `month`
 * and `year` resolve to a date, and `note` is rejected as a keyword. The lexer lowercases the
 * query, so the spelling does not matter.
 */
const RESERVED_VALUES = new Set([ "note", "now", "today", "month", "year" ]);

/** The text before the cursor, and whether the user asked with Ctrl-Space. */
interface Context {
    before: string;
    pos: number;
    explicit: boolean;
}

/** Where `expr` matches ending at the cursor, and what it matches there. */
function matchBefore({ before }: Context, expr: RegExp) {
    const match = new RegExp(`(?:${expr.source})$`, expr.flags).exec(before);

    return match ? { from: match.index, text: match[0] } : null;
}

function entries(context: Context, key: string, from: number, list: () => SearchEntry[] | Promise<SearchEntry[]>): SearchCompletion {
    return { kind: "entries", key, from, query: context.before.slice(from), entries: list, preselect: context.explicit };
}

/**
 * Reads the label name and the part of its value typed so far out of the text before the cursor,
 * and answers nothing where the cursor does not stand in a value.
 */
function labelValueBeingTyped(context: Context) {
    const comparison = matchBefore(context, LABEL_COMPARISON);
    const match = comparison && LABEL_COMPARISON.exec(comparison.text);
    if (!match) {
        return null;
    }

    const [ , name, tail ] = match;
    const value = valueBeingTyped(tail);

    return value ? { name, ...value } : null;
}

/**
 * The values a note property is compared against, for the properties holding a closed set of them.
 * The rest — a title, a date, a count — are the user's to type.
 */
function propertyValueBeingTyped(context: Context) {
    const comparison = matchBefore(context, PROPERTY_COMPARISON);
    const match = comparison && PROPERTY_COMPARISON.exec(comparison.text);
    if (!match) {
        return null;
    }

    const [ , property, tail ] = match;
    const values = PROPERTY_VALUES.get(property.toLowerCase());
    const value = values && valueBeingTyped(tail);
    if (!value) {
        return null;
    }

    // A quote the user opened is a value they are spelling out, so the ones that mean anything
    // only bare are dropped. For a date property that leaves nothing to offer.
    const offered = values()
        .filter(({ verbatim }) => !(verbatim && value.quote))
        .map(({ label, detail, icon, verbatim }) => ({
            id: label,
            title: label,
            description: detail,
            icon,
            insert: verbatim ? label : applyValue(label, value.quote)
        }));

    return offered.length ? { ...value, property: property.toLowerCase(), entries: offered } : null;
}

/**
 * Reads the part of a value typed so far out of what stands between the operator and the cursor,
 * and answers nothing where the cursor no longer stands in that value.
 */
function valueBeingTyped(tail: string) {
    // An operator with nothing after it is still being typed, and the operators are the better offer.
    if (tail === "") {
        return null;
    }

    const rest = tail.trimStart();
    const quote = QUOTES.includes(rest.charAt(0)) ? rest.charAt(0) : "";
    const typed = rest.slice(quote.length);
    // A value ends at its closing quote, or at the whitespace after a bare one; past either the
    // cursor stands in whatever follows the comparison.
    const isFinished = quote ? typed.includes(quote) : /\s/.test(typed);

    return isFinished ? null : { typed, quote };
}

/**
 * The values each enumerable property holds, keyed lower-case as `PROP_MAPPING` is because the
 * lexer lowercases the query. The lists are the ones the note row and the code-note MIME dropdown
 * already use, so a type or a MIME added there is offered here without further work.
 */
const PROPERTY_VALUES = new Map<string, () => PropertyValue[]>([
    [ "type", () => ALLOWED_NOTE_TYPES.map((noteType) => ({ label: noteType, icon: noteTypeIcon(noteType) })) ],
    [ "mime", () => MIME_TYPES_DICT.map(({ mime, title }) => ({ label: mime, detail: title, icon: "bx bx-code-alt" })) ],
    [ "isprotected", booleanValues ],
    [ "isarchived", booleanValues ],
    [ "datecreated", dateValues ],
    [ "datemodified", dateValues ],
    [ "utcdatecreated", dateValues ],
    [ "utcdatemodified", dateValues ]
]);

interface PropertyValue {
    label: string;
    detail?: string;
    icon: string;
    /** Inserted as it stands, the parser reading it as something other than the text it spells. */
    verbatim?: boolean;
}

function noteTypeIcon(noteType: string) {
    return (NOTE_TYPE_ICONS as Record<string, string>)[noteType] ?? "bx bx-note";
}

function booleanValues(): PropertyValue[] {
    return [ { label: "true", icon: "bx bx-toggle-right" }, { label: "false", icon: "bx bx-toggle-left" } ];
}

/**
 * The dates `resolveConstantOperand` resolves. Nothing else in the app names them, so this is the
 * only place to find them. Each is offered with an offset as well, counted in the unit that date
 * steps in, so the form arrives as text to edit rather than as something to read and retype.
 */
function dateValues(): PropertyValue[] {
    return [
        { label: "now", detail: t("search_completion.date_now") },
        { label: "now-60", detail: t("search_completion.date_now_offset") },
        { label: "today", detail: t("search_completion.date_today") },
        { label: "today-30", detail: t("search_completion.date_today_offset") },
        { label: "month", detail: t("search_completion.date_month") },
        { label: "month-1", detail: t("search_completion.date_month_offset") },
        { label: "year", detail: t("search_completion.date_year") },
        { label: "year-1", detail: t("search_completion.date_year_offset") }
    ].map((value) => ({ ...value, icon: "bx bx-calendar", verbatim: true }));
}

/**
 * The values `name` already holds across the database. Only labels reach here: a relation's value
 * is a note ID, and the endpoint behind this collects label values alone.
 */
async function labelValues(name: string, quote: string): Promise<SearchEntry[]> {
    let values: string[];
    try {
        values = await server.get<string[]>(`attribute-values/${encodeURIComponent(name)}`);
    } catch {
        // A failed lookup offers no values, and the query is typed as usual.
        return [];
    }

    return values.map((value) => ({ id: value, title: value, icon: "bx bx-purchase-tag-alt", insert: applyValue(value, quote) }));
}

/**
 * The text a value is inserted as: closing the quote the user opened, or adding a pair of them
 * around a value the parser would otherwise read as something else — one the lexer splits into
 * several tokens, or one spelled like a reserved operand.
 */
function applyValue(value: string, quote: string) {
    if (quote) {
        return escapeInQuotes(value, quote) + quote;
    }

    const needsQuotes = VALUE_NEEDS_QUOTES.test(value) || RESERVED_VALUES.has(value.toLowerCase());

    return needsQuotes ? `"${escapeInQuotes(value, "\"")}"` : value;
}

/** The lexer reads the character after a backslash literally, the quote and the backslash included. */
function escapeInQuotes(value: string, quote: string) {
    return value.replace(new RegExp(`[\\\\${quote}]`, "g"), "\\$&");
}

/**
 * Completes the segment being typed at the end of `path`. After `note.labels.` or
 * `note.relations.` that is an attribute name; after `note.title.` it is nothing at all, a
 * terminal property having nothing to walk onto.
 */
function pathCompletion(path: string, pos: number): SearchCompletion | null {
    const segments = path.split(".");
    const typed = segments[segments.length - 1];
    const previous = segments[segments.length - 2];
    const beforeThat = segments[segments.length - 3];
    const from = pos - typed.length;

    if (previous === "labels" || previous === "relations") {
        return { kind: "attributes", type: previous === "labels" ? "label" : "relation", from, query: typed };
    }

    // A segment follows the root, a traversal, or the relation name reached through `relations`.
    const isAllowed = segments.length === 2
        || (SEARCH_NOTE_PATH.traversals as readonly string[]).includes(previous)
        || beforeThat === "relations";

    if (!isAllowed) {
        return null;
    }

    return { kind: "entries", key: "segments", from, query: typed, entries: segmentEntries, preselect: false };
}

/**
 * Everything spelled as a word: the `note` object and the keywords that join, order and cut down a
 * query. Built per request rather than once, so the entries read the catalogue after i18n has
 * loaded and follow a language switched while the app is running.
 */
function wordEntries(ordering: OrderingPosition): SearchEntry[] {
    // Both complete with what has to follow them: a bare `note`, or a `not` without its
    // parenthesised sub-expression, is never a clause on its own. The list then opens on that.
    const noteObject = entry("note", t("search_completion.note"), "bx bx-note", "note.");
    const limit = entry("limit", t("search_completion.keyword_limit"), "bx bx-list-ol");
    // The characters the whole syntax turns on, and the only part of it a reader cannot arrive at
    // by typing a word, so they lead. `ValueExtractor` rewrites either into a path, so a sort key
    // takes them too.
    const attributeMarkers = [
        entry("#", t("search_completion.label_marker"), "bx bx-hash"),
        entry("#!", t("search_completion.label_marker_negated"), "bx bx-hash"),
        entry("~", t("search_completion.relation_marker"), "bx bx-transfer"),
        entry("~!", t("search_completion.relation_marker_negated"), "bx bx-transfer")
    ];
    // A sort key names the value to order by, which a negated marker has none of: `ValueExtractor`
    // reads `#!foo` as a label named `!foo` and would quietly order by one no note carries.
    const sortKeyMarkers = attributeMarkers.filter(({ title }) => !title.endsWith("!"));

    if (ordering === "key") {
        return [ ...sortKeyMarkers, noteObject ];
    }

    if (ordering === "sorted") {
        return [
            entry("asc", t("order_by.asc"), "bx bx-sort-up"),
            entry("desc", t("order_by.desc"), "bx bx-sort-down"),
            limit
        ];
    }

    return [
        ...attributeMarkers,
        noteObject,
        entry("and", t("search_completion.keyword_and"), "bx bx-git-merge"),
        entry("or", t("search_completion.keyword_or"), "bx bx-git-merge"),
        entry("not", t("search_completion.keyword_not"), "bx bx-block", "not("),
        entry("orderBy", t("search_completion.keyword_order_by"), "bx bx-sort-alt-2"),
        limit
    ];
}

function entry(title: string, description: string | undefined, icon: string, insert = title): SearchEntry {
    return { id: title, title, description, icon, insert };
}

/**
 * Where the cursor stands in an `orderBy`, which decides what can follow it.
 * `parseOrderByAndLimit()` reads a property path, then an optional `asc` or `desc`, then either a
 * comma and another key or the `limit` that ends the query.
 */
type OrderingPosition = "none" | "key" | "sorted";

function orderingPosition(context: Context): OrderingPosition {
    const ordering = matchBefore(context, ORDER_BY_BEFORE);
    if (!ordering) {
        return "none";
    }

    // Each key is ordered on its own, so only what follows the last comma counts.
    const key = ordering.text.slice(ordering.text.lastIndexOf(",") + 1).replace(/^\s*orderby/i, "");
    // What is being typed is not a key yet, and says nothing about what can follow one.
    const written = key.replace(new RegExp(`${WORD_PREFIX.source}$`), "").trim();

    if (/(^|\s)limit(\s|$)/i.test(written)) {
        return "none";
    }

    return written ? "sorted" : "key";
}

function segmentEntries(): SearchEntry[] {
    return Object.values(SEARCH_NOTE_PATH).flat().map((segment) => {
        const { icon, detail } = SEGMENTS[segment];
        return entry(segment, detail ? t(detail) : undefined, `bx ${icon}`);
    });
}

type NotePathSegment = (typeof SEARCH_NOTE_PATH)[keyof typeof SEARCH_NOTE_PATH][number];

/**
 * The icon of each segment, and a gloss for the segments whose name does not already say what they
 * hold. Several glosses are the labels the order-by dropdown offers for the same properties, which
 * read the same way here. The label and relation segments carry the icons of `#` and `~`.
 */
const SEGMENTS: Record<NotePathSegment, { icon: string; detail?: string }> = {
    noteId: { icon: "bx-fingerprint" },
    title: { icon: "bx-heading" },
    type: { icon: "bx-category" },
    mime: { icon: "bx-code-alt" },
    isProtected: { icon: "bx-lock-alt" },
    isArchived: { icon: "bx-archive" },
    dateCreated: { icon: "bx-calendar" },
    dateModified: { icon: "bx-calendar" },
    utcDateCreated: { icon: "bx-calendar" },
    utcDateModified: { icon: "bx-calendar" },
    parentCount: { icon: "bx-sitemap", detail: "order_by.parent_count" },
    childrenCount: { icon: "bx-sitemap", detail: "order_by.children_count" },
    attributeCount: { icon: "bx-purchase-tag-alt", detail: "search_completion.property_attribute_count" },
    labelCount: { icon: "bx-hash", detail: "search_completion.property_label_count" },
    ownedLabelCount: { icon: "bx-hash", detail: "order_by.owned_label_count" },
    relationCount: { icon: "bx-transfer", detail: "search_completion.property_relation_count" },
    ownedRelationCount: { icon: "bx-transfer", detail: "order_by.owned_relation_count" },
    relationCountIncludingLinks: {
        icon: "bx-transfer",
        detail: "search_completion.property_relation_count_including_links"
    },
    ownedRelationCountIncludingLinks: {
        icon: "bx-transfer",
        detail: "search_completion.property_owned_relation_count_including_links"
    },
    targetRelationCount: { icon: "bx-transfer", detail: "order_by.target_relation_count" },
    targetRelationCountIncludingLinks: {
        icon: "bx-transfer",
        detail: "search_completion.property_target_relation_count_including_links"
    },
    contentSize: { icon: "bx-data", detail: "order_by.content_size" },
    contentAndAttachmentsSize: { icon: "bx-data", detail: "order_by.content_and_attachments_size" },
    contentAndAttachmentsAndRevisionsSize: {
        icon: "bx-data",
        detail: "order_by.content_and_attachments_and_revisions_size"
    },
    revisionCount: { icon: "bx-history", detail: "order_by.revision_count" },
    content: { icon: "bx-file", detail: "search_completion.property_content" },
    rawContent: { icon: "bx-code", detail: "search_completion.property_raw_content" },
    text: { icon: "bx-text", detail: "search_completion.property_text" },
    parents: { icon: "bx-up-arrow-alt", detail: "search_completion.property_parents" },
    children: { icon: "bx-sitemap", detail: "search_completion.property_children" },
    ancestors: { icon: "bx-git-branch", detail: "search_completion.property_ancestors" },
    labels: { icon: "bx-hash", detail: "search_completion.property_labels" },
    relations: { icon: "bx-transfer", detail: "search_completion.property_relations" }
};

/** The operators the operand standing before the cursor can be compared with. */
function operatorEntries(context: Context): SearchEntry[] {
    const allowed = allowedOperators(context);

    return [
        entry("=", t("search_completion.operator_equal"), "bx bx-math"),
        entry("!=", t("search_completion.operator_not_equal"), "bx bx-math"),
        entry("*=*", t("search_completion.operator_contains"), "bx bx-math"),
        entry("=*", t("search_completion.operator_starts_with"), "bx bx-math"),
        entry("*=", t("search_completion.operator_ends_with"), "bx bx-math"),
        entry(">", t("search_completion.operator_greater_than"), "bx bx-math"),
        entry(">=", t("search_completion.operator_greater_or_equal"), "bx bx-math"),
        entry("<", t("search_completion.operator_less_than"), "bx bx-math"),
        entry("<=", t("search_completion.operator_less_or_equal"), "bx bx-math"),
        entry("%=", t("search_completion.operator_regex"), "bx bx-math"),
        entry("~=", t("search_completion.operator_fuzzy_equal"), "bx bx-math"),
        entry("~*", t("search_completion.operator_fuzzy_contains"), "bx bx-math")
    ].filter(({ title }) => !allowed || allowed.has(title));
}

/**
 * What the operand restricts the comparison to, `undefined` standing for no restriction. Offering
 * more would build a query the parser rejects.
 */
function allowedOperators(context: Context): ReadonlySet<string> | undefined {
    const comparison = matchBefore(context, COMPARISON_OPERAND);
    const operand = comparison && COMPARISON_OPERAND.exec(comparison.text)?.[1];
    if (!operand) {
        return undefined;
    }

    return allowedSearchOperators(operand);
}
