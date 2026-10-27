import { ExternalTokenizer } from "@lezer/lr";
import { betaHeader, NodeText, NodeEdgeText, StyleText } from  "./parser.terms.js";

const skipCodePoints = [ -1, 9, 13, 32, 34, 39, 96 ];
const startBracketCodePoints = [ 40, 62, 91, 123, 124 ];
const endBracketCodePoints = [ 41, 93, 124, 125 ];
const hyphen = 45;
const equal = 61;
const dot = 46;

export const nodeText = new ExternalTokenizer((input) => {
    if (
        skipCodePoints.includes(input.next) ||
        startBracketCodePoints.includes(input.next)
    )
        return;

    while (!endBracketCodePoints.includes(input.next) && input.next !== -1) {
        input.advance();
    }

    input.acceptToken(NodeText);
});

export const nodeEdgeText = new ExternalTokenizer((input) => {
    if (
        skipCodePoints.includes(input.next) ||
        startBracketCodePoints.includes(input.next) ||
        input.next === hyphen ||
        input.next === equal ||
        input.next === dot
    )
        return;

    while (
        input.next !== hyphen &&
        input.next !== equal &&
        input.next !== dot &&
        input.next !== -1
    ) {
        input.advance();
    }

    input.acceptToken(NodeEdgeText);
});

export const styleText = new ExternalTokenizer((input) => {
    if (input.next === 10 || input.next === -1) return;

    while (input.next !== 10 && input.next !== -1) {
        input.advance();
    }

    input.acceptToken(StyleText);
});

/** The `swimlane-beta` and `agentflow-beta` headers, whose `-` an identifier cannot hold. */
export const headers = new ExternalTokenizer((input) => {
    for (const header of [ "swimlane-beta", "agentflow-beta" ]) {
        let length = 0;
        while (length < header.length && input.peek(length) === header.charCodeAt(length)) length++;
        const next = input.peek(length);
        const wordCharacter = (next >= 48 && next <= 57) || (next >= 65 && next <= 90)
            || (next >= 97 && next <= 122) || next === 95 || next === 45;
        if (length === header.length && !wordCharacter) {
            input.acceptToken(betaHeader, length);
            return;
        }
    }
});
