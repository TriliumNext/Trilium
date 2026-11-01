import { describe, expect, it } from "vitest";

import { buildQuoteMarkdown, QUOTE_SOURCE_HREF_PREFIX, renderQuoteSourceLinks, stripQuoteSources } from "./chat_quote.js";

describe("buildQuoteMarkdown", () => {
    it("quotes a single line and appends the attribution with a message-id token", () => {
        expect(buildQuoteMarkdown("The answer is 42.", "msg123", "Quoted from")).toBe(
            "> The answer is 42.\n" +
            "> (Quoted from <<mid:msg123>>)"
        );
    });

    it("prefixes every line of a multi-line selection", () => {
        expect(buildQuoteMarkdown("first line\nsecond line", "abc", "Quoted from")).toBe(
            "> first line\n" +
            "> second line\n" +
            "> (Quoted from <<mid:abc>>)"
        );
    });

    it("keeps blank lines inside the selection as a bare '>' so the quote stays contiguous", () => {
        expect(buildQuoteMarkdown("para one\n\npara two", "abc", "Quoted from")).toBe(
            "> para one\n" +
            ">\n" +
            "> para two\n" +
            "> (Quoted from <<mid:abc>>)"
        );
    });

    it("drops leading and trailing blank lines but keeps the attribution", () => {
        expect(buildQuoteMarkdown("\n  \nkept\n \n", "abc", "Quoted from")).toBe(
            "> kept\n" +
            "> (Quoted from <<mid:abc>>)"
        );
    });

    it("normalizes CRLF and does not alter Markdown characters within the quote", () => {
        expect(buildQuoteMarkdown("# heading > *stars*\r\nb", "abc", "Quoted from")).toBe(
            "> # heading > *stars*\n" +
            "> b\n" +
            "> (Quoted from <<mid:abc>>)"
        );
    });

    it("honours a localized attribution label", () => {
        expect(buildQuoteMarkdown("x", "abc", "Citat din")).toBe(
            "> x\n" +
            "> (Citat din <<mid:abc>>)"
        );
    });
});

describe("stripQuoteSources", () => {
    it("removes the attribution line, keeping the quoted text", () => {
        const quote = buildQuoteMarkdown("hello", "abc", "Quoted from");
        expect(stripQuoteSources(`${quote}\n\nmy question`)).toBe("> hello\n\nmy question");
    });

    it("removes attribution lines regardless of how many tokens are present", () => {
        const markdown = "> a\n> (Quoted from <<mid:x>>)\n> (Quoted from <<mid:y>>)\n\ntext";
        expect(stripQuoteSources(markdown)).toBe("> a\n\ntext");
    });

    it("leaves text with no token untouched", () => {
        expect(stripQuoteSources("> a normal quote\n\ntext")).toBe("> a normal quote\n\ntext");
    });

    it("keeps quoted content that merely contains a token but isn't an attribution footer", () => {
        const md = "> the api uses <<mid:abc123>> as an anchor\n> (Quoted from <<mid:def456>>)\n\nq";
        expect(stripQuoteSources(md)).toBe("> the api uses <<mid:abc123>> as an anchor\n\nq");
    });
});

describe("renderQuoteSourceLinks", () => {
    const label = "Show quote source";

    it("replaces a single-token block's attribution with a jump link", () => {
        const quote = buildQuoteMarkdown("hello", "abc", "Quoted from");
        expect(renderQuoteSourceLinks(quote, label)).toBe(
            "> hello\n" +
            `> [${label}](${QUOTE_SOURCE_HREF_PREFIX}abc)`
        );
    });

    it("leaves a plain user blockquote (no token) untouched", () => {
        const md = "> just a quote the user typed\n\ntext";
        expect(renderQuoteSourceLinks(md, label)).toBe(md);
    });

    it("drops token lines and shows no link when a block has two or more sources", () => {
        const md = "> a\n> (Quoted from <<mid:x>>)\n> (Quoted from <<mid:y>>)\n\ntext";
        expect(renderQuoteSourceLinks(md, label)).toBe("> a\n\ntext");
    });

    it("treats blocks separated by a blank line independently", () => {
        const md =
            "> first\n> (Quoted from <<mid:aaa>>)\n\n" +
            "> second\n> (Quoted from <<mid:bbb>>)";
        expect(renderQuoteSourceLinks(md, label)).toBe(
            `> first\n> [${label}](${QUOTE_SOURCE_HREF_PREFIX}aaa)\n\n` +
            `> second\n> [${label}](${QUOTE_SOURCE_HREF_PREFIX}bbb)`
        );
    });

    it("does not treat a quoted line that merely contains a token as a source", () => {
        const md = "> mentions <<mid:abc123>> mid-sentence\n\ntext";
        expect(renderQuoteSourceLinks(md, label)).toBe(md);
    });

    it("leaves surrounding non-quote text in place", () => {
        const md = "before\n\n> q\n> (Quoted from <<mid:abc>>)\n\nafter";
        expect(renderQuoteSourceLinks(md, label)).toBe(
            `before\n\n> q\n> [${label}](${QUOTE_SOURCE_HREF_PREFIX}abc)\n\nafter`
        );
    });
});
