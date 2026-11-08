import { ContextTracker, ExternalTokenizer, type InputStream } from "@lezer/lr";

import { Category, Cause, Effect } from "./parser.terms.js";

// The context is the indentation of the first category, as Mermaid's `IshikawaDB` keeps its
// `baseLevel`, or one of these two values before there is one.
const beforeEffect = -2;
const beforeCategory = -1;

/**
 * A node line, without the whitespace around it: the effect first, then a category when it is
 * indented no deeper than the first line after the effect, or else a cause. A line starting with
 * `%%` is a comment, but `%%` later in a line is part of its text.
 */
export const lines = new ExternalTokenizer((input, stack) => {
    if ([ -1, 9, 10, 13, 32 ].includes(input.next)) return;
    if (input.next === 37 && input.peek(1) === 37) return;

    let length = 0;
    let end = 0;
    for (let next = input.peek(0); next !== 10 && next !== -1; next = input.peek(++length)) {
        if (![ 9, 13, 32 ].includes(next)) end = length + 1;
    }

    const context: number = stack.context;
    if (context === beforeEffect) {
        input.acceptToken(Effect, end);
    } else {
        const category = context === beforeCategory || indentation(input) <= context;
        input.acceptToken(category ? Category : Cause, end);
    }
}, { contextual: true });

export const trackLevels = new ContextTracker<number>({
    start: beforeEffect,
    shift(context, term, _stack, input) {
        if (term === Effect) return beforeCategory;
        if (term === Category && context === beforeCategory) return indentation(input);
        return context;
    },
    hash: (context) => context + 2
});

/** The number of spaces and tabs before the stream position on its line. */
function indentation(input: InputStream) {
    let length = 0;
    while ([ 9, 32 ].includes(input.peek(-length - 1))) length++;
    return length;
}
