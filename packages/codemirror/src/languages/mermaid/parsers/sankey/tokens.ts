import { ExternalTokenizer } from "@lezer/lr";
import { fieldText } from "./parser.terms.js";

const COMMA = 44;
const NEWLINE = 10;
const EOF = -1;
const DQUOTE = 34;
const SPACE = 32;
const TAB = 9;
const CR = 13;

// Reads a single CSV field for a Sankey row. A field runs until the next comma
// or end of line, unless it is wrapped in double quotes, in which case commas
// inside the quotes are part of the field.
export const fieldTokens = new ExternalTokenizer((input) => {
    if (
        input.next === COMMA ||
        input.next === NEWLINE ||
        input.next === EOF ||
        input.next === SPACE ||
        input.next === TAB ||
        input.next === CR
    ) {
        return;
    }

    if (input.next === DQUOTE) {
        input.advance();
        while (input.next !== DQUOTE && input.next !== NEWLINE && input.next !== EOF) {
            input.advance();
        }
        if (input.next === DQUOTE) {
            input.advance();
        }
        input.acceptToken(fieldText);
        return;
    }

    while (
        input.next !== COMMA &&
        input.next !== NEWLINE &&
        input.next !== EOF
    ) {
        input.advance();
    }

    input.acceptToken(fieldText);
});
