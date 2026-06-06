import { describe, expect, it } from "vitest";
import { Marked } from "marked";
import {
    createWikiLinkExtension,
    createTransclusionExtension,
    wikiLinkExtension,
    transclusionExtension
} from "./marked_extensions.js";

interface ExtensionInternals {
    start(src: string): number | undefined;
    tokenizer(src: string): unknown;
    renderer(token: { href: string; text?: string }): string;
}

function asInternal(extension: unknown): ExtensionInternals {
    return extension as ExtensionInternals;
}

describe("marked_extensions", () => {
    describe("createWikiLinkExtension", () => {
        it("should render basic wiki links", () => {
            const marked = new Marked({ extensions: [createWikiLinkExtension()] });
            const result = marked.parse("[[abc123]]");
            expect(result).toContain('<a class="reference-link" href="/abc123">abc123</a>');
        });

        it("should escape HTML in link text to prevent XSS", () => {
            const marked = new Marked({ extensions: [createWikiLinkExtension()] });
            // Malicious input attempting to inject HTML/script via link text
            const result = marked.parse("[[<script>alert('xss')</script>]]");

            // The output should NOT contain unescaped script tags
            expect(result).not.toContain("<script>");
            expect(result).not.toContain("</script>");
            // Should be properly escaped
            expect(result).toContain("&lt;script&gt;");
        });

        it("should escape attribute-breaking characters in href to prevent XSS", () => {
            const marked = new Marked({ extensions: [createWikiLinkExtension()] });
            // Malicious input attempting to break out of href attribute
            const result = marked.parse('[[x" onclick="alert(1)"]]');

            // The output should NOT allow breaking out of the href attribute
            // The key is that quotes are escaped, so onclick can't become an actual attribute
            expect(result).not.toContain('href="/x"');  // Would indicate unescaped quote breaking out
            expect(result).not.toContain('" onclick="');  // Unescaped pattern that would create event handler
            // Double quotes should be escaped
            expect(result).toContain('&quot;');
            // The href should contain the escaped malicious input, not be broken by it
            expect(result).toContain('href="/x&quot;');
        });

        it("should handle custom formatHref safely", () => {
            const marked = new Marked({
                extensions: [createWikiLinkExtension({ formatHref: (id) => `#root/${id}` })]
            });
            const result = marked.parse('[[x"><img src=x onerror=alert(1)>]]');

            // The < and > should be escaped so no img tag is injected
            expect(result).not.toContain('<img src');  // Actual img tag
            expect(result).toContain('&lt;img');  // Escaped version
            expect(result).toContain('&gt;');  // Escaped >
        });
    });

    describe("createTransclusionExtension", () => {
        it("should render basic transclusions", () => {
            const marked = new Marked({ extensions: [createTransclusionExtension()] });
            const result = marked.parse("![[abc123]]");
            expect(result).toContain('<img src="/abc123">');
        });

        it("should escape attribute-breaking characters in src to prevent XSS", () => {
            const marked = new Marked({ extensions: [createTransclusionExtension()] });
            // Malicious input attempting to break out of src attribute
            const result = marked.parse('![[x" onerror="alert(1)"]]');

            // The output should NOT allow breaking out of the src attribute
            // The key is that quotes are escaped, so onerror can't become an actual attribute
            expect(result).not.toContain('src="/x"');  // Would indicate unescaped quote
            expect(result).not.toContain('" onerror="');  // Unescaped pattern
            // Double quotes should be escaped
            expect(result).toContain('&quot;');
            // The src should contain the escaped malicious input
            expect(result).toContain('src="/x&quot;');
        });

        it("should escape HTML injection attempts in transclusion", () => {
            const marked = new Marked({ extensions: [createTransclusionExtension()] });
            // Attempt to close img tag and inject script
            const result = marked.parse('![[x"><script>alert(1)</script>]]');

            expect(result).not.toContain('<script>');
            expect(result).not.toContain('</script>');
        });

        it("should handle custom formatSrc safely", () => {
            const marked = new Marked({
                extensions: [createTransclusionExtension({ formatSrc: (id) => `/api/images/${id}` })]
            });
            const result = marked.parse('![[x" onload="alert(1)]]');

            // The quote should be escaped so onload can't become an actual attribute
            expect(result).not.toContain('src="/api/images/x"');  // Would indicate unescaped quote
            expect(result).toContain('&quot;');  // Quote should be escaped
            expect(result).toContain('src="/api/images/x&quot;');  // Escaped version
        });
    });

    describe("wikiLink start()", () => {
        it("should return the index of the first '[[' marker", () => {
            const src = "hello [[note]] world";
            expect(asInternal(wikiLinkExtension).start(src)).toBe(src.indexOf("[["));
            expect(asInternal(wikiLinkExtension).start(src)).toBe(6);
        });

        it("should return -1 when there is no '[[' marker", () => {
            expect(asInternal(wikiLinkExtension).start("hello world")).toBe(-1);
        });
    });

    describe("wikiLink tokenizer()", () => {
        it("should produce a wikiLink token for a matching source", () => {
            const token = asInternal(wikiLinkExtension).tokenizer("[[ note ]] rest");
            expect(token).toEqual({
                type: "wikiLink",
                raw: "[[ note ]]",
                text: "note",
                href: "note"
            });
        });

        it("should return undefined when the source does not match", () => {
            expect(asInternal(wikiLinkExtension).tokenizer("not a wiki link")).toBeUndefined();
        });
    });

    describe("transclusion start()", () => {
        it("should return the index of the first '![[' marker", () => {
            const src = "x ![[id]]";
            expect(asInternal(transclusionExtension).start(src)).toBe(src.indexOf("![["));
            expect(asInternal(transclusionExtension).start(src)).toBe(2);
        });

        it("should return undefined when there is no '![[' marker", () => {
            expect(asInternal(transclusionExtension).start("no transclusion here")).toBeUndefined();
        });
    });

    describe("transclusion tokenizer()", () => {
        it("should produce a transclusion token for a matching source", () => {
            const token = asInternal(transclusionExtension).tokenizer("![[ img ]] rest");
            expect(token).toEqual({
                type: "transclusion",
                raw: "![[ img ]]",
                href: "img"
            });
        });

        it("should return undefined when the source does not match", () => {
            expect(asInternal(transclusionExtension).tokenizer("plain text")).toBeUndefined();
        });
    });

    describe("default formatHref / formatSrc", () => {
        it("should default the wiki-link href to /${noteId}", () => {
            const extension = createWikiLinkExtension();
            const result = asInternal(extension).renderer({ href: "abc", text: "abc" });
            expect(result).toBe('<a class="reference-link" href="/abc">abc</a>');
        });

        it("should default the transclusion src to /${noteId}", () => {
            const extension = createTransclusionExtension();
            const result = asInternal(extension).renderer({ href: "abc" });
            expect(result).toBe('<img src="/abc">');
        });
    });
});
