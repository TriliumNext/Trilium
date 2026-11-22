import { Marked } from "marked";
import { describe, expect, it } from "vitest";

import { CONTAINER_PREFIX_SOURCE, countLineBreaks, walkBlockTokens } from "./markdown_source.js";
import { createTabsExtensions } from "./marked_extensions.js";

const marked = new Marked({ gfm: true });
marked.use({ extensions: createTabsExtensions() });

describe("walkBlockTokens", () => {
    it("visits the blocks of lists, quotes and tabs in document order, with their lines", () => {
        const source = [
            "# Title",
            "",
            "- one",
            "- two",
            "  > quoted",
            "",
            "> quote",
            "> - item",
            "",
            "=== \"A\"",
            "",
            "    Panel",
            "",
            "    ```",
            "    code",
            "    ```",
            "",
            "=== \"B\"",
            "",
            "    Other"
        ].join("\n");
        const visited: string[] = [];
        walkBlockTokens(marked.lexer(source), (token, line) => {
            if (token.type !== "space") {
                visited.push(`${token.type} ${line}`);
            }
        });

        expect(visited).toEqual([
            "heading 1", "list 3", "text 3", "text 4", "blockquote 5", "paragraph 5",
            "blockquote 7", "paragraph 7", "list 8", "text 8",
            "tabs 10", "tab 10", "paragraph 12", "code 14", "tab 18", "paragraph 20"
        ]);
    });

    it("counts from the first line given, in the text that `getRaw` gives", () => {
        const lines: number[] = [];
        walkBlockTokens(marked.lexer("a\n\nb"), (_token, line) => lines.push(line), {
            firstLine: 10, getRaw: () => "\r\n"
        });

        expect(lines).toEqual([ 10, 11, 12 ]);
    });
});

describe("countLineBreaks", () => {
    it("counts each form of line break once", () => {
        expect(countLineBreaks("a\r\nb\rc\nd\n")).toBe(4);
        expect(countLineBreaks("")).toBe(0);
    });
});

describe("CONTAINER_PREFIX_SOURCE", () => {
    it("matches the quote markers, list markers and indentation in front of the content", () => {
        const prefix = new RegExp(`^${CONTAINER_PREFIX_SOURCE}`);

        expect(prefix.exec("> 1. - ```js")?.[0]).toBe("> 1. - ");
        expect(prefix.exec("  >>  text")?.[0]).toBe("  >>  ");
        expect(prefix.exec("-text")?.[0]).toBe("");
    });
});
