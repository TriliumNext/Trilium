import { ExternalTokenizer } from "@lezer/lr";

const whitespace = [ 9, 13, 32 ];

/**
 * A tokenizer for the text after a keyword on the same line, such as a `title` or the styles of a
 * `classDef`. The text ends at a `%%` comment, the line's end or one of `stops`, without the
 * spaces around it. The tokenizer leaves leading whitespace to the grammar's skip, then looks back
 * for a newline after the keyword.
 */
export function lineText(term: number, stops: readonly number[] = []) {
    return new ExternalTokenizer((input) => {
        if (whitespace.includes(input.next)) return;
        for (let offset = -1; [ ...whitespace, 10 ].includes(input.peek(offset)); offset--) {
            if (input.peek(offset) === 10) return;
        }

        let length = 0;
        let end = 0;
        for (let next = input.peek(0); next !== 10 && next !== -1; next = input.peek(++length)) {
            if (stops.includes(next) || (next === 37 && input.peek(length + 1) === 37)) break;
            if (!whitespace.includes(next)) end = length + 1;
        }
        if (end > 0) input.acceptToken(term, end);
    });
}
