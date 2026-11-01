import { ExternalTokenizer } from "@lezer/lr";
import type { InputStream } from "@lezer/lr";
import { Keyword, periodEventText, keywordText } from "./parser.terms.js";

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

    const activeKeyword = keywords.filter((keyword) => keyword === tokens);

    if (activeKeyword.length > 0) {
        input.acceptToken(Keyword, activeKeyword[0].length - tokens.length);
    }
});

export const periodEventTokens = new ExternalTokenizer((input) => {
    if (shouldSkip(input)) return;

    while (input.next !== 58 && input.next !== 10 && input.next !== -1) {
        input.advance();
    }

    input.acceptToken(periodEventText);
});

export const keywordTextTokens = new ExternalTokenizer((input) => {
    if (shouldSkip(input)) return;

    while (input.next !== 10 && input.next !== -1) {
        input.advance();
    }

    input.acceptToken(keywordText);
});
