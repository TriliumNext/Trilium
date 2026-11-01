import { ExternalTokenizer } from "@lezer/lr";
import { RelationshipStart } from "./parser.terms.js";

const notAllowedCodePoints = [ -1, 45, 60, 62, 10, 13, 123, 61 ];

export const relationshipStart = new ExternalTokenizer((input) => {
    if (notAllowedCodePoints.includes(input.next) || input.next === 32) return;

    let peek;
    let tokens = "";
    let count = 0;

    do {
        peek = input.peek(count);
        if (peek === -1) return;
        tokens += String.fromCodePoint(peek);
        count++;
    } while (!notAllowedCodePoints.includes(peek));

    if (peek === 45 || peek === 60) {
        tokens = tokens.slice(0, -1).trim();
        input.acceptToken(RelationshipStart, tokens.length);
    }
});
