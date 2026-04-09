import { describe, expect, it } from "vitest";
import { Marked } from "marked";
import { createWikiLinkExtension, createTransclusionExtension } from "./marked_extensions.js";

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
});
