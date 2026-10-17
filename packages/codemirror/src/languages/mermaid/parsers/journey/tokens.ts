import { ExternalTokenizer } from "@lezer/lr";
import { Keyword, text1, text2, text3 } from "./parser.terms.js";

import type { InputStream } from "@lezer/lr";

const skipCodePoints = [ -1, 9, 10, 13, 32 ];

const keywords = [ "title", "section" ];

const isComment = (input: InputStream) => {
    return input.peek(0) === 37 && input.peek(1) === 37;
};

const shouldSkip = (input: InputStream) => {
    return skipCodePoints.includes(input.next) || isComment(input);
};

export const keywordTokens = new ExternalTokenizer((input) => {
    if (shouldSkip(input)) return;

    let tokens = "";

    while (!skipCodePoints.includes(input.next)) {
        tokens += String.fromCodePoint(input.next);
        input.advance();
    }

    const activeKeyword = keywords.filter((keyword) => {
        if (keyword === tokens) {
            return tokens.toLowerCase().startsWith(keyword);
        }
        // ensure the keyword isn't used as a token unless there's a space at the end
        // e.g. titleStuff
        return tokens.toLowerCase().startsWith(keyword + " ");
    });

    if (activeKeyword.length > 0) {
        input.acceptToken(Keyword, activeKeyword[0].length - tokens.length);
        return;
    }
});

export const textTokens1 = new ExternalTokenizer((input) => {
    if (shouldSkip(input)) return;

    while (input.next !== 10 && input.next !== -1) {
        input.advance();
    }

    input.acceptToken(text1);
});

export const textTokens2 = new ExternalTokenizer((input) => {
    if (shouldSkip(input)) return;

    while (input.next !== 58 && input.next !== 10 && input.next !== -1) {
        input.advance();
    }

    input.acceptToken(text2);
});

export const textTokens3 = new ExternalTokenizer((input) => {
    if (shouldSkip(input)) return;

    while (input.next !== 44 && input.next !== 10 && input.next !== -1) {
        input.advance();
    }

    input.acceptToken(text3);
});
