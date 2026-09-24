import type { Completion, CompletionContext, CompletionResult } from "@triliumnext/codemirror/src/field_editor";
import { ALLOWED_NOTE_TYPES, allowedSearchOperators, MIME_TYPES_DICT, SEARCH_NOTE_PATH, SEARCH_NOTE_PATH_SEGMENTS } from "@triliumnext/commons";

import { isBuiltinAttribute } from "../../services/attributes";
import type { Suggestion } from "../../services/note_autocomplete";
import { t } from "../../services/i18n";
import server from "../../services/server";
import { fetchAttributeNames } from "../attribute_widgets/attribute_detail";

/** A branch answers at once, or after what it offers has been fetched. */
type CompletionOutcome = CompletionResult | Promise<CompletionResult | null> | null;

/**
 * Offers Trilium's search syntax: the `note` object, the keywords, the property path that hangs off
 * `note` or off a relation, the comparison operators — whose spellings (`*=*`, `=*`, `~=`) are the
 * part of the syntax hardest to recall — the label and relation names in the database, and the
 * values a label is compared against.
 */
export function searchCompletionSource(context: CompletionContext): CompletionOutcome {
    // Read before the rest: `@` is a name character to the lexer, so the branches below would
    // answer for one typed inside an attribute name.
    const mention = context.matchBefore(NOTE_MENTION);
    if (mention) {
        const typedAt = mention.text.indexOf("@");

        return noteCompletions(mention.text.slice(typedAt + 1), mention.from + typedAt);
    }

    const path = context.matchBefore(PROPERTY_PATH);
    if (path) {
        return pathCompletions(path.text, context.pos);
    }

    // `~=` and `~*` reach the operators below instead: an attribute name cannot be spelled with
    // either character, so the pattern finds nothing ending at the cursor.
    const attribute = context.matchBefore(ATTRIBUTE_PREFIX);
    if (attribute) {
        const isNegated = attribute.text[1] === "!";

        return attributeCompletions(
            attribute.text[0] === "#" ? "label" : "relation",
            attribute.from + (isNegated ? 2 : 1)
        );
    }

    const value = labelValueBeingTyped(context);
    if (value) {
        return valueCompletions(value.name, context.pos - value.typed.length, value.quote);
    }

    const property = propertyValueBeingTyped(context);
    if (property) {
        return {
            from: context.pos - property.typed.length,
            options: property.options,
            validFor: validForValue(property.quote)
        };
    }

    // An ordering names a key and sorts on it, comparing nothing.
    const ordering = orderingPosition(context);
    const operators = () => (ordering === "none" ? operatorOptions(context) : []);

    const operator = context.matchBefore(OPERATOR_PREFIX);
    if (operator) {
        const options = operators();

        return options.length ? { from: operator.from, options, validFor: OPERATOR_PREFIX } : null;
    }

    const word = context.matchBefore(WORD_PREFIX);
    if (word) {
        return { from: word.from, options: wordOptions(ordering), validFor: WORD_PREFIX };
    }

    // Ctrl-Space on empty space asks for everything on offer.
    if (context.explicit) {
        return { from: context.pos, options: [ ...wordOptions(ordering), ...operators() ] };
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
const SEGMENT_TYPED = new RegExp(`${SEGMENT}*`);
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
/** A bare value runs until whitespace or a character that would start another clause. */
const VALUE_TYPED = /[^\s#~()'"`]*/;
/** What the lexer reads as structure, so a value holding one of these only survives in quotes. */
const VALUE_NEEDS_QUOTES = /[\s"'`\\#~().=*<>!%+,-]/;
/**
 * Operands the parser reads as something other than the text they spell: `now`, `today`, `month`
 * and `year` resolve to a date, and `note` is rejected as a keyword. The lexer lowercases the
 * query, so the spelling does not matter.
 */
const RESERVED_VALUES = new Set([ "note", "now", "today", "month", "year" ]);

/** A completion drawn with an icon of its own, which {@link COMPLETION_ICONS} cannot supply. */
interface NoteCompletion extends Completion {
    noteIcon?: string;
}

/**
 * Offers the notes matching what follows an `@`, through the call the jump-to dialog reads, and
 * inserts the id of the one picked. The id is what the query keeps, so it goes on matching the
 * note after a rename; with nothing typed yet the call answers with the recently visited notes.
 */
async function noteCompletions(term: string, atPos: number): Promise<CompletionResult | null> {
    let suggestions: Suggestion[];
    try {
        suggestions = await server.get<Suggestion[]>(
            `autocomplete?query=${encodeURIComponent(term)}&activeNoteId=none&fastSearch=true`
        );
    } catch {
        return null;
    }

    const options: NoteCompletion[] = [];

    for (const [ index, suggestion ] of suggestions.entries()) {
        const noteId = suggestion.notePath?.split("/").filter(Boolean).pop();
        if (!noteId || !suggestion.noteTitle) {
            continue;
        }

        options.push({
            label: suggestion.noteTitle,
            detail: suggestion.notePathTitle,
            noteIcon: suggestion.icon,
            // The call ranks the notes; this keeps that order among the ones matching as well as
            // each other, while leaving a distinctly better match free to rise past them.
            boost: -index,
            // Rewrites the `@` along with what was typed after it. CodeMirror would replace only
            // what it matched against, which starts past the `@`.
            apply: (view, _completion, _from, to) => view.dispatch({
                changes: { from: atPos, to, insert: noteId },
                selection: { anchor: atPos + noteId.length }
            })
        });
    }

    // Offered from past the `@`, so what was typed is matched against the titles rather than
    // against a marker no title carries.
    return options.length ? { from: atPos + 1, options } : null;
}

/**
 * Fetches the label or relation names the database holds, through the same call the sidebar's
 * attribute picker makes, and marks the built-in ones as that picker does. The whole set is asked
 * for once and narrowed by `validFor` as more of the name is typed, rather than per keystroke.
 */
async function attributeCompletions(type: "label" | "relation", from: number): Promise<CompletionResult | null> {
    let names: string[];
    try {
        names = await fetchAttributeNames(type, "");
    } catch {
        return null;
    }

    return {
        from,
        options: names.map((name) => {
            const isBuiltin = isBuiltinAttribute(type, name);

            return {
                label: name,
                type: isBuiltin ? SYSTEM_ATTRIBUTE : type,
                boost: isBuiltin ? BUILTIN_BOOST : undefined
            };
        }),
        validFor: SEGMENT_TYPED
    };
}

/** Stands in for a completion's own type, a name Trilium attaches a meaning to being marked first. */
const SYSTEM_ATTRIBUTE = "system-attribute";

/**
 * The furthest CodeMirror lets an option be moved down, which it adds to the match score. Penalties
 * there run to the hundreds, so a built-in sinks below a name of the user's own that matches as
 * well, while a distinctly better match keeps its place.
 */
const BUILTIN_BOOST = -99;

/**
 * The furthest an option can be moved up, the other end of {@link BUILTIN_BOOST}. CodeMirror never
 * reads the order options are offered in — it sorts by match score, and a pattern of a character or
 * two scores everything alike, leaving the tie to be broken by label. That puts `~` last of all, so
 * the markers carry the boost instead.
 */
const MARKER_BOOST = 99;

const COMPLETION_ICONS: Record<string, string> = {
    [SYSTEM_ATTRIBUTE]: "bx bx-cog",
    label: "bx bx-hash",
    relation: "bx bx-transfer"
};

/** The icon an option is drawn with. Only the attribute names carry one. */
export function searchCompletionIcon(completion: Completion): string | undefined {
    if ("noteIcon" in completion && typeof completion.noteIcon === "string") {
        return completion.noteIcon;
    }

    return completion.type ? COMPLETION_ICONS[completion.type] : undefined;
}

/**
 * Reads the label name and the part of its value typed so far out of the text before the cursor,
 * and answers nothing where the cursor does not stand in a value.
 */
function labelValueBeingTyped(context: CompletionContext) {
    const comparison = context.matchBefore(LABEL_COMPARISON);
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
function propertyValueBeingTyped(context: CompletionContext) {
    const comparison = context.matchBefore(PROPERTY_COMPARISON);
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
    const options = values()
        .filter(({ verbatim }) => !(verbatim && value.quote))
        .map(({ label, detail, verbatim }) => {
            const applied = verbatim ? label : applyValue(label, value.quote);

            return { label, detail, apply: applied === label ? undefined : applied };
        });

    return options.length ? { ...value, options } : null;
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
    [ "type", () => ALLOWED_NOTE_TYPES.map((noteType) => ({ label: noteType })) ],
    [ "mime", () => MIME_TYPES_DICT.map(({ mime, title }) => ({ label: mime, detail: title })) ],
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
    /** Inserted as it stands, the parser reading it as something other than the text it spells. */
    verbatim?: boolean;
}

function booleanValues(): PropertyValue[] {
    return [ { label: "true" }, { label: "false" } ];
}

/**
 * The dates `resolveConstantOperand` resolves. Nothing else in the app names them, so this is the
 * only place to find them. Each is offered with an offset as well, counted in the unit that date
 * steps in, so the form arrives as text to edit rather than as something to read and retype.
 */
function dateValues(): PropertyValue[] {
    return [
        { label: "now", detail: t("search_completion.date_now"), verbatim: true },
        { label: "now-60", detail: t("search_completion.date_now_offset"), verbatim: true },
        { label: "today", detail: t("search_completion.date_today"), verbatim: true },
        { label: "today-30", detail: t("search_completion.date_today_offset"), verbatim: true },
        { label: "month", detail: t("search_completion.date_month"), verbatim: true },
        { label: "month-1", detail: t("search_completion.date_month_offset"), verbatim: true },
        { label: "year", detail: t("search_completion.date_year"), verbatim: true },
        { label: "year-1", detail: t("search_completion.date_year_offset"), verbatim: true }
    ];
}

/**
 * Offers the values `name` already holds across the database. Only labels reach here: a relation's
 * value is a note ID, and the endpoint behind this collects label values alone.
 */
async function valueCompletions(name: string, from: number, quote: string): Promise<CompletionResult | null> {
    let values: string[];
    try {
        values = await server.get<string[]>(`attribute-values/${encodeURIComponent(name)}`);
    } catch {
        return null;
    }

    return {
        from,
        options: values.map((value) => {
            const applied = applyValue(value, quote);

            return { label: value, apply: applied === value ? undefined : applied };
        }),
        validFor: validForValue(quote)
    };
}

/** How far the offered values stay valid as more of the one being typed arrives. */
function validForValue(quote: string) {
    return quote ? new RegExp(`[^${quote}]*`) : VALUE_TYPED;
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
function pathCompletions(path: string, pos: number): CompletionOutcome {
    const segments = path.split(".");
    const typed = segments[segments.length - 1];
    const previous = segments[segments.length - 2];
    const beforeThat = segments[segments.length - 3];
    const from = pos - typed.length;

    if (previous === "labels" || previous === "relations") {
        return attributeCompletions(previous === "labels" ? "label" : "relation", from);
    }

    // A segment follows the root, a traversal, or the relation name reached through `relations`.
    const isAllowed = segments.length === 2
        || (SEARCH_NOTE_PATH.traversals as readonly string[]).includes(previous)
        || beforeThat === "relations";

    if (!isAllowed) {
        return null;
    }

    return { from, options: segmentOptions(), validFor: SEGMENT_TYPED };
}

/**
 * Everything spelled as a word: the `note` object and the keywords that join, order and cut down a
 * query. Built per request rather than once, so the options read the catalogue after i18n has
 * loaded and follow a language switched while the app is running.
 */
function wordOptions(ordering: OrderingPosition): Completion[] {
    // Both complete with what has to follow them: a bare `note`, or a `not` without its
    // parenthesised sub-expression, is never a clause on its own.
    const noteObject: Completion = { label: "note", apply: "note.", type: "namespace", detail: t("search_completion.note") };
    const limit: Completion = { label: "limit", type: "keyword", detail: t("search_completion.keyword_limit") };
    // The characters the whole syntax turns on, and the only part of it a reader cannot arrive at
    // by typing a word, so they lead. `ValueExtractor` rewrites either into a path, so a sort key
    // takes them too. Drawn as keywords: the marker is already the icon.
    const attributeMarkers: Completion[] = [
        { label: "#", apply: "#", type: "keyword", boost: MARKER_BOOST, detail: t("search_completion.label_marker") },
        { label: "#!", apply: "#!", type: "keyword", boost: MARKER_BOOST - 1, detail: t("search_completion.label_marker_negated") },
        { label: "~", apply: "~", type: "keyword", boost: MARKER_BOOST - 2, detail: t("search_completion.relation_marker") },
        { label: "~!", apply: "~!", type: "keyword", boost: MARKER_BOOST - 3, detail: t("search_completion.relation_marker_negated") }
    ];
    // A sort key names the value to order by, which a negated marker has none of: `ValueExtractor`
    // reads `#!foo` as a label named `!foo` and would quietly order by one no note carries.
    const sortKeyMarkers = attributeMarkers.filter(({ label }) => !label.endsWith("!"));

    if (ordering === "key") {
        return [ ...sortKeyMarkers, noteObject ];
    }

    if (ordering === "sorted") {
        return [
            { label: "asc", type: "keyword", detail: t("order_by.asc") },
            { label: "desc", type: "keyword", detail: t("order_by.desc") },
            limit
        ];
    }

    return [
        ...attributeMarkers,
        noteObject,
        { label: "and", type: "keyword", detail: t("search_completion.keyword_and") },
        { label: "or", type: "keyword", detail: t("search_completion.keyword_or") },
        { label: "not", apply: "not(", type: "keyword", detail: t("search_completion.keyword_not") },
        { label: "orderBy", type: "keyword", detail: t("search_completion.keyword_order_by") },
        limit
    ];
}

/**
 * Whether picking `completion` reopens the popup. Every option that inserts one of these leaves a
 * clause unfinished: `note.`, `#` and `#!` are waiting for a name, `not(` for a sub-expression.
 */
export function searchCompletionReactivates(completion: Completion): boolean {
    const applied = completion.apply;

    return typeof applied === "string" && OPENERS.includes(applied.slice(-1));
}

const OPENERS = [ ".", "(", "#", "~", "!" ];

/**
 * Where the cursor stands in an `orderBy`, which decides what can follow it.
 * `parseOrderByAndLimit()` reads a property path, then an optional `asc` or `desc`, then either a
 * comma and another key or the `limit` that ends the query.
 */
type OrderingPosition = "none" | "key" | "sorted";

function orderingPosition(context: CompletionContext): OrderingPosition {
    const ordering = context.matchBefore(ORDER_BY_BEFORE);
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

function segmentOptions(): Completion[] {
    return SEARCH_NOTE_PATH_SEGMENTS.map((segment) => ({
        label: segment,
        type: "property",
        detail: SEGMENT_DETAILS[segment] ? t(SEGMENT_DETAILS[segment]) : undefined
    }));
}

/**
 * Glosses for the segments whose name does not already say what they hold. Several are the labels
 * the order-by dropdown offers for the same properties, which read the same way here.
 */
const SEGMENT_DETAILS: Record<string, string> = {
    content: "search_completion.property_content",
    rawContent: "search_completion.property_raw_content",
    text: "search_completion.property_text",
    parents: "search_completion.property_parents",
    children: "search_completion.property_children",
    ancestors: "search_completion.property_ancestors",
    labels: "search_completion.property_labels",
    relations: "search_completion.property_relations",
    attributeCount: "search_completion.property_attribute_count",
    labelCount: "search_completion.property_label_count",
    relationCount: "search_completion.property_relation_count",
    relationCountIncludingLinks: "search_completion.property_relation_count_including_links",
    ownedRelationCountIncludingLinks: "search_completion.property_owned_relation_count_including_links",
    targetRelationCountIncludingLinks: "search_completion.property_target_relation_count_including_links",
    parentCount: "order_by.parent_count",
    childrenCount: "order_by.children_count",
    ownedLabelCount: "order_by.owned_label_count",
    ownedRelationCount: "order_by.owned_relation_count",
    targetRelationCount: "order_by.target_relation_count",
    contentSize: "order_by.content_size",
    contentAndAttachmentsSize: "order_by.content_and_attachments_size",
    contentAndAttachmentsAndRevisionsSize: "order_by.content_and_attachments_and_revisions_size",
    revisionCount: "order_by.revision_count"
};

/** The operators the operand standing before the cursor can be compared with. */
function operatorOptions(context: CompletionContext): Completion[] {
    const allowed = allowedOperators(context);

    return [
        { label: "=", detail: t("search_completion.operator_equal") },
        { label: "!=", detail: t("search_completion.operator_not_equal") },
        { label: "*=*", detail: t("search_completion.operator_contains") },
        { label: "=*", detail: t("search_completion.operator_starts_with") },
        { label: "*=", detail: t("search_completion.operator_ends_with") },
        { label: ">", detail: t("search_completion.operator_greater_than") },
        { label: ">=", detail: t("search_completion.operator_greater_or_equal") },
        { label: "<", detail: t("search_completion.operator_less_than") },
        { label: "<=", detail: t("search_completion.operator_less_or_equal") },
        { label: "%=", detail: t("search_completion.operator_regex") },
        { label: "~=", detail: t("search_completion.operator_fuzzy_equal") },
        { label: "~*", detail: t("search_completion.operator_fuzzy_contains") }
    ]
        .filter(({ label }) => !allowed || allowed.has(label))
        .map((option) => ({ ...option, type: "keyword" }));
}

/**
 * What the operand restricts the comparison to, `undefined` standing for no restriction. Offering
 * more would build a query the parser rejects.
 */
function allowedOperators(context: CompletionContext): ReadonlySet<string> | undefined {
    const comparison = context.matchBefore(COMPARISON_OPERAND);
    const operand = comparison && COMPARISON_OPERAND.exec(comparison.text)?.[1];
    if (!operand) {
        return undefined;
    }

    return allowedSearchOperators(operand);
}

