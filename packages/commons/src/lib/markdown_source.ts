import type { Token, Tokens } from "marked";

/**
 * The quote markers, list markers and indentation in front of the content of a line of Markdown,
 * as the source of a regular expression without anchors.
 */
export const CONTAINER_PREFIX_SOURCE =
    String.raw`(?:[ \t]*(?:>|[-*+](?=[ \t])|\d{1,9}[.)](?=[ \t])))*[ \t]*`;

/** Options of {@link walkBlockTokens}. */
export interface BlockTokenWalkOptions {
    /** The 1-indexed source line of the first token, 1 by default. */
    firstLine?: number;
    /** The source text of a token, whose line breaks are counted. `token.raw` by default. */
    getRaw?: (token: Token) => string;
}

/**
 * Calls `visit` with each block token of `tokens` and the 1-indexed source line it starts on, in
 * document order, a container before its content: the blocks of each list item, of a quote and of
 * a tab panel, and the tabs of a tabs block. Marked has no positions, so the lines are counted: a
 * token starts after the line breaks of the tokens before it, and the blocks of an item, a quote or
 * a panel after those of their earlier siblings, as marked lexes them line for line without their
 * prefix. A tab panel starts on the line after the title of its tab.
 */
export function walkBlockTokens(
    tokens: Token[],
    visit: (token: Tokens.Generic, line: number) => void,
    { firstLine = 1, getRaw = (token: Token) => token.raw }: BlockTokenWalkOptions = {}
) {
    const walk = (list: Token[], startLine: number) => {
        let line = startLine;
        for (const token of list as Tokens.Generic[]) {
            visit(token, line);
            if (token.type === "list") {
                let itemLine = line;
                for (const item of (token as Tokens.List).items) {
                    walk(item.tokens, itemLine);
                    itemLine += countLineBreaks(getRaw(item));
                }
            } else if (token.type === "blockquote" || token.type === "tabs") {
                walk(token.tokens as Token[], line);
            } else if (token.type === "tab") {
                walk(token.tokens as Token[], line + 1);
            }
            line += countLineBreaks(getRaw(token));
        }
    };
    walk(tokens, firstLine);
}

/** The number of line breaks in `text`: `\r\n`, `\r` and `\n` each count once. */
export function countLineBreaks(text: string) {
    return (text.match(/\r\n?|\n/g) ?? []).length;
}
