import { ExternalTokenizer, type InputStream } from "@lezer/lr";

import { lineText } from "../line_text.js";
import { Name, titleKeyword, TitleText } from "./parser.terms.js";

const whitespace = [ 9, 13, 32 ];

/**
 * A `title` keyword before the first node, or a bare node name, both only at the start of a line.
 * A bare name runs to the line's end, stopping before whitespace that opens an annotation: `:::`
 * with a class name, `icon(` or `##`. Quoted names and whole-line `%%` comments are left to the
 * grammar's tokens.
 */
export const names = new ExternalTokenizer((input, stack) => {
    const next = input.next;
    if ([ -1, 10, 34, 39, ...whitespace ].includes(next)) return;
    if (next === 37 && input.peek(1) === 37) return;
    let before = -1;
    while (whitespace.includes(input.peek(before))) before--;
    if (input.peek(before) !== 10) return;

    if (stack.canShift(titleKeyword) && startsWith(input, 0, "title")
        && [ ...whitespace, 10, -1 ].includes(input.peek(5))) {
        input.acceptToken(titleKeyword, 5);
        return;
    }

    let length = 1;
    while (![ 10, -1 ].includes(input.peek(length)) && !opensAnnotation(input, length)) length++;
    input.acceptToken(Name, length);
});

export const titleText = lineText(TitleText);

function opensAnnotation(input: InputStream, offset: number) {
    if (!whitespace.includes(input.peek(offset))) return false;
    let start = offset;
    while (whitespace.includes(input.peek(start))) start++;
    if (startsWith(input, start, "icon(") || startsWith(input, start, "##")) return true;
    if (!startsWith(input, start, ":::")) return false;
    start += 3;
    while (whitespace.includes(input.peek(start))) start++;
    const first = input.peek(start);
    return first === 95 || (first >= 65 && first <= 90) || (first >= 97 && first <= 122);
}

function startsWith(input: InputStream, offset: number, text: string) {
    for (let index = 0; index < text.length; index++) {
        if (input.peek(offset + index) !== text.charCodeAt(index)) return false;
    }
    return true;
}
