import { type EditorState, type Extension, RangeSetBuilder, StateField } from "@codemirror/state";
import { Decoration, type DecorationSet, EditorView } from "@codemirror/view";

/**
 * Highlighter for Trilium's search syntax, as entered in the `#searchString` of a saved search.
 *
 * It scans the query the way `lex()` does — left to right, one token at a time — but classifies
 * rather than parses: nothing here decides whether a query is valid, so a half-typed clause still
 * colours the part that is already there. Operators, quoting and the rule that `+`/`-` bind only
 * to digits follow the lexer, which is what keeps `today-30` three tokens rather than one word.
 *
 * Recognised tokens:
 *  - `#label` and `~relation`, either optionally negated with `!`
 *  - `note` and the dotted path after it or after a relation (`~author.relations.son.title`)
 *  - the comparison operators, including the fuzzy `~=` and `~*` that look like a relation prefix
 *  - `and`, `or`, `not`, `orderBy`, `limit`, `asc`, `desc`
 *  - quoted operands, numbers, and the smart date values `now`, `today`, `month` and `year`
 *
 * Words outside all of that are the full-text part of the query and stay unstyled.
 */

export type SearchTokenKind =
    | "label"
    | "relation"
    | "property"
    | "keyword"
    | "operator"
    | "string"
    | "literal"
    | "bracket";

export interface SearchToken {
    from: number;
    to: number;
    kind: SearchTokenKind;
}

const KEYWORDS = new Set([ "and", "or", "not", "orderby", "limit", "asc", "desc" ]);
/** Values `resolveConstantOperand()` turns into a date, optionally followed by `+`/`-` and a count. */
const DATE_VALUES = new Set([ "now", "today", "month", "year" ]);

/**
 * Characters that end an attribute name or a property-path segment. They are the structural ones
 * plus `+`/`-`, which `isSymbolAnOperator()` counts as operators and so splits a word on.
 */
const NAME = "[^\\s#~().,=<>*!%+\\-'\"`]";

const SPACE = /\s+/y;
// Runs to the matching quote, or to the end of the query while the closing quote is still missing.
const STRING = /(['"`])(?:\\[^]|(?!\1)[^])*(?:\1|$)/y;
const ESCAPE = /\\[^]/y;
const ATTRIBUTE = new RegExp(`([#~])!?${NAME}+`, "y");
// The segment is allowed to be empty so a trailing `note.` colours while it is being typed.
const PATH_SEGMENT = new RegExp(`\\.${NAME}*`, "y");
const NOTE_PREFIX = /note(?=\.)/iy;
const OPERATOR = /\*=\*|~=|~\*|!=|>=|<=|%=|\*=|=\*|[=><]|[+\-](?=\d)/y;
const BRACKET = /[()]/y;
const NUMBER = /\d+(?:\.\d+)?/y;
const WORD = /[^\s#~().,=<>*!%+\-'"`]+/y;

/** Splits a search query into the tokens worth colouring, skipping over everything else. */
export function tokenizeSearchQuery(text: string): SearchToken[] {
    const tokens: SearchToken[] = [];
    let pos = 0;
    // Set by `note` and by a relation, both of which a dotted property path can follow.
    let inPath = false;

    const match = (pattern: RegExp) => {
        pattern.lastIndex = pos;
        return pattern.exec(text);
    };
    const take = (kind: SearchTokenKind, pattern: RegExp) => {
        tokens.push({ from: pos, to: pattern.lastIndex, kind });
        pos = pattern.lastIndex;
    };

    while (pos < text.length) {
        if (match(SPACE)) {
            pos = SPACE.lastIndex;
            continue;
        }

        if (inPath) {
            if (match(PATH_SEGMENT)) {
                take("property", PATH_SEGMENT);
                continue;
            }
            inPath = false;
        }

        if (match(STRING)) {
            take("string", STRING);
            continue;
        }

        if (match(ESCAPE)) {
            // An escaped `#`, `~` or `note.` is full text, so it carries no colour of its own.
            pos = ESCAPE.lastIndex;
            continue;
        }

        const attribute = match(ATTRIBUTE);
        if (attribute) {
            const isLabel = attribute[1] === "#";
            take(isLabel ? "label" : "relation", ATTRIBUTE);
            inPath = !isLabel;
            continue;
        }

        if (match(NOTE_PREFIX)) {
            take("property", NOTE_PREFIX);
            inPath = true;
            continue;
        }

        if (match(OPERATOR)) {
            take("operator", OPERATOR);
            continue;
        }

        if (match(BRACKET)) {
            take("bracket", BRACKET);
            continue;
        }

        if (match(NUMBER)) {
            take("literal", NUMBER);
            continue;
        }

        const word = match(WORD);
        if (word) {
            const lowerCased = word[0].toLowerCase();
            if (KEYWORDS.has(lowerCased)) {
                take("keyword", WORD);
            } else if (DATE_VALUES.has(lowerCased)) {
                take("literal", WORD);
            } else {
                pos = WORD.lastIndex;
            }
            continue;
        }

        // A structural character carrying no meaning where it stands, such as a stray `.` or `,`.
        pos++;
    }

    return tokens;
}

const MARKS: Record<SearchTokenKind, Decoration> = {
    label: Decoration.mark({ class: "cm-search-label" }),
    relation: Decoration.mark({ class: "cm-search-relation" }),
    property: Decoration.mark({ class: "cm-search-property" }),
    keyword: Decoration.mark({ class: "cm-search-keyword" }),
    operator: Decoration.mark({ class: "cm-search-operator" }),
    string: Decoration.mark({ class: "cm-search-string" }),
    literal: Decoration.mark({ class: "cm-search-literal" }),
    bracket: Decoration.mark({ class: "cm-search-bracket" })
};

/**
 * The `!` of `#!fiction`, drawn apart from the attribute it negates so the one character that
 * inverts a clause is not read as part of the name. It is a decoration rather than a token of its
 * own: the linter reads the same stream and takes an attribute to be one token.
 */
const NEGATION_MARK = Decoration.mark({ class: "cm-search-negation" });

/**
 * The Next themes own the palette (`--search-*` in theme-next-light.css / theme-next-dark.css).
 * The fallbacks below are what the legacy themes — which don't define those variables — render
 * with, so they are mid-tones that hold up on a light and a dark background alike.
 */
const searchHighlightTheme = EditorView.baseTheme({
    ".cm-search-label": { color: "var(--search-label-color, #539bf5)" },
    ".cm-search-relation": { color: "var(--search-relation-color, #8957e5)" },
    ".cm-search-negation": { color: "var(--search-negation-color, #e5534b)" },
    ".cm-search-property": { color: "var(--search-property-color, #268a8a)" },
    ".cm-search-keyword": { color: "var(--search-keyword-color, #bf3989)", fontWeight: "bold" },
    ".cm-search-operator": { color: "var(--search-operator-color, var(--muted-text-color))" },
    ".cm-search-string": { color: "var(--search-string-color, #2ea043)" },
    ".cm-search-literal": { color: "var(--search-literal-color, #d29922)" },
    ".cm-search-bracket": { color: "var(--search-bracket-color, var(--muted-text-color))" }
});

const searchHighlightField = StateField.define<DecorationSet>({
    create: (state) => buildSearchDecorations(state),
    update: (decorations, tr) => (tr.docChanged ? buildSearchDecorations(tr.state) : decorations),
    provide: (field) => EditorView.decorations.from(field)
});

/**
 * The extension to register on an editor holding a search query.
 *
 * The decorations live in a {@link StateField} rather than a view plugin so they paint the moment
 * the extension enters the configuration instead of only after the next edit — the same reason
 * `triliumLogHighlighter` uses one. A query is one short line, so every change rescans all of it.
 */
export const triliumSearchHighlighter: Extension = [ searchHighlightField, searchHighlightTheme ];

function buildSearchDecorations(state: EditorState): DecorationSet {
    const builder = new RangeSetBuilder<Decoration>();
    const text = state.doc.toString();

    for (const token of tokenizeSearchQuery(text)) {
        const negation = token.from + 1;

        if (ATTRIBUTE_KINDS.has(token.kind) && text[negation] === "!") {
            builder.add(token.from, negation, MARKS[token.kind]);
            builder.add(negation, negation + 1, NEGATION_MARK);
            builder.add(negation + 1, token.to, MARKS[token.kind]);
            continue;
        }

        builder.add(token.from, token.to, MARKS[token.kind]);
    }

    return builder.finish();
}

/** The tokens spelled with a marker, which is the only place a `!` can negate. */
const ATTRIBUTE_KINDS: ReadonlySet<SearchTokenKind> = new Set([ "label", "relation" ]);
