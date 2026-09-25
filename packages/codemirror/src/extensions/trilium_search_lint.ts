import { type Diagnostic, linter } from "@codemirror/lint";
import type { Extension } from "@codemirror/state";
import { allowedSearchOperators, NO_SEARCH_OPERATORS, TEXT_SEARCH_OPERATORS } from "@triliumnext/commons";

import { type SearchToken, tokenizeSearchQuery } from "./trilium_search_highlighter.js";

/**
 * The wording a diagnostic is reported with, supplied by the consumer because this package holds no
 * translation catalogue.
 */
export interface SearchLintMessages {
    /** `~author = hello`, which the parser rejects outright. */
    relationNeedsProperty: string;
    /** `note.text = hello`: the virtual property is matched with `*=*` alone. */
    textNeedsContains: string;
    /** `note.content > hello`: content is matched rather than ordered. */
    contentNotOrdered: string;
    /** Names the fix that compares the related note's title. */
    compareTheTitle: string;
    /** Names the fix that writes `operator` in place of the one already there. */
    useOperator(operator: string): string;
}

/**
 * Reads a query by the engine's own rules, without running it. Answers the first fault, or `null`
 * where the query has none.
 */
export type SearchValidator = (query: string) => Promise<string | null>;

/**
 * Marks the comparisons `parse.ts` refuses, which a query reaches only by being rewritten: no token
 * typed after `~author =` makes it valid again, so a completion has nothing to offer there and the
 * mistake would otherwise surface only once the search is run.
 *
 * The rules below read the same tokens the highlighter colours and hold to what they decide on
 * their own, which keeps them instant and lets them mark the operator they object to. `validate`
 * covers the rest of what the engine refuses, at the cost of a round trip and of a message it can
 * only attach to the whole query, since `SearchContext` records no offsets.
 */
export function triliumSearchLinter(messages: SearchLintMessages, validate?: SearchValidator): Extension {
    return linter((view) => searchDiagnostics(
        view.state.doc.toString(),
        messages,
        validate,
        () => view.state.doc.toString()
    ));
}

/**
 * The lint source, apart from an editor, which is also how the spec drives it. `currentQuery` is
 * read again once `validate` answers, so a message describing text already typed over is dropped.
 */
export async function searchDiagnostics(
    query: string,
    messages: SearchLintMessages,
    validate?: SearchValidator,
    currentQuery: () => string = () => query
): Promise<Diagnostic[]> {
    const local = diagnoseSearchQuery(query, messages);

    // The local rules already name a fault, and the engine would only report the same one again,
    // less precisely. They also answer for an empty query, which has nothing to say.
    if (local.length > 0 || !validate || query.trim() === "") {
        return local;
    }

    let error: string | null;
    try {
        error = await validate(query);
    } catch {
        // The editor keeps working without the engine's opinion.
        return [];
    }

    // Typing during the round trip has already queued another run, whose answer describes what the
    // query says now.
    if (!error || currentQuery() !== query) {
        return [];
    }

    return [ { from: 0, to: query.length, severity: "error", message: error } ];
}

/** Runs the rules over `query`, apart from an editor, which is also how the spec drives them. */
export function diagnoseSearchQuery(query: string, messages: SearchLintMessages): Diagnostic[] {
    const tokens = tokenizeSearchQuery(query);
    const diagnostics: Diagnostic[] = [];

    for (const [ index, token ] of tokens.entries()) {
        if (token.kind !== "operator") {
            continue;
        }

        const operand = operandBefore(query, tokens, index);
        const allowed = operand && allowedSearchOperators(query.slice(operand.from, operand.to));
        if (!operand || !allowed || allowed.has(query.slice(token.from, token.to))) {
            continue;
        }

        diagnostics.push(diagnose(operand, token, allowed, messages));
    }

    return diagnostics;
}

/**
 * The attribute or property path the operator at `operatorIndex` compares, walked back over the
 * dotted path to whatever opened it. Answers nothing where a word stands between the two: that word
 * is the query's full text, and the operator compares something else.
 */
function operandBefore(query: string, tokens: SearchToken[], operatorIndex: number) {
    const last = tokens[operatorIndex - 1];
    if (!last || !OPERAND_KINDS.has(last.kind)) {
        return null;
    }

    if (query.slice(last.to, tokens[operatorIndex].from).trim() !== "") {
        return null;
    }

    let start = operatorIndex - 1;
    while (tokens[start].kind === "property") {
        const before = tokens[start - 1];
        if (!before || !OPERAND_KINDS.has(before.kind) || before.to !== tokens[start].from) {
            break;
        }

        start--;
    }

    return { from: tokens[start].from, to: last.to };
}

/** What a path can be walked from, `note` itself being a property token. */
const OPERAND_KINDS = new Set([ "property", "relation", "label" ]);

function diagnose(
    operand: { from: number, to: number },
    operator: SearchToken,
    allowed: ReadonlySet<string>,
    messages: SearchLintMessages
): Diagnostic {
    const at = { from: operator.from, to: operator.to, severity: "error" } as const;

    // A relation takes no operator at all, so the repair opens a property path in front of the one
    // written. The name is left selected, so typing over it reaches the rest of the path.
    if (allowed === NO_SEARCH_OPERATORS) {
        return {
            ...at,
            message: messages.relationNeedsProperty,
            actions: [ {
                name: messages.compareTheTitle,
                apply: (view) => view.dispatch({
                    changes: { from: operand.to, insert: `.${RELATED_NOTE_PROPERTY}` },
                    selection: {
                        anchor: operand.to + 1,
                        head: operand.to + 1 + RELATED_NOTE_PROPERTY.length
                    }
                })
            } ]
        };
    }

    const isText = allowed === TEXT_SEARCH_OPERATORS;

    return {
        ...at,
        message: isText ? messages.textNeedsContains : messages.contentNotOrdered,
        actions: [ {
            name: messages.useOperator(CONTAINS),
            apply: (view) => view.dispatch({
                changes: { from: operator.from, to: operator.to, insert: CONTAINS },
                selection: { anchor: operator.from + CONTAINS.length }
            })
        } ]
    };
}

/** The one operator `note.text` accepts, and the one a rejected content comparison falls back to. */
const CONTAINS = "*=*";

/**
 * What a related note is compared by where the query does not say. It is the property the parser's
 * own error names (`~relation.title=hello`) and the one the user guide leads with, and a repair has
 * to land on a query that parses: opening the path alone leaves the value behind it unrecognised.
 */
const RELATED_NOTE_PROPERTY = "title";
