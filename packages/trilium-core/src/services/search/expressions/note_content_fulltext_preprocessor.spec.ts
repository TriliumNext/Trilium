import { NoteType } from "@triliumnext/commons";
import { describe, expect,it } from "vitest";

import preprocessContent from "./note_content_fulltext_preprocessor";

describe("Mind map preprocessing", () => {
    const type: NoteType = "mindMap";
    const mime = "application/json";

    it("supports empty JSON", () => {
        expect(preprocessContent("{}", type, mime)).toEqual("");
    });

    it("supports blank text / invalid JSON", () => {
        expect(preprocessContent("", type, mime)).toEqual("");
        expect(preprocessContent(`{ "node": " }`, type, mime)).toEqual("");
    });

    it("reads data", () => {
        expect(preprocessContent(`{ "nodedata": { "topic": "Root", "children": [ { "topic": "Child 1" }, { "topic": "Child 2", "children": [ { "topic": "Grandchild" } ] } ] } }`, type, mime)).toEqual("root, child 1, child 2, grandchild");        
    });
});

describe("Canvas preprocessing", () => {
    const type: NoteType = "canvas";
    const mime = "application/json";

    it("supports empty JSON", () => {
        expect(preprocessContent("{}", type, mime)).toEqual("");
    });

    it("supports blank text / invalid JSON", () => {
        expect(preprocessContent("", type, mime)).toEqual("");        
    });

    it("reads elements", () => {
        expect(preprocessContent(`{ "elements": [ { "type": "text", "text": "Hello" } ] }`, type, mime)).toEqual("hello");
        expect(preprocessContent(`{ "elements": [ { "type": "text" }, { "type": "text", "text": "World" }, { "type": "rectangle", "text": "Ignored" } ] }`, type, mime)).toEqual("world");
    });
});

describe("Reference-link & link-preview searchability", () => {
    const type: NoteType = "text";
    const mime = "text/html";

    it("appends the resolved title of an empty-text reference link", () => {
        // dataDowncast markup from referencelink.ts: <a href=... class="reference-link">title</a>.
        // The stored anchor text is stale/empty, so the real title must come from the resolver.
        const html = `<p>See <a href="#root/abc123DEF456" class="reference-link"></a> for details.</p>`;
        const result = preprocessContent(html, type, mime, false, (id) => (id === "abc123DEF456" ? "Special Topic" : null));
        expect(result).toContain("Special Topic");
    });

    it("also resolves plain internal links (not only reference links)", () => {
        const html = `<p>Jump to <a href="#root/parent1/target99">whatever</a>.</p>`;
        const result = preprocessContent(html, type, mime, false, (id) => (id === "target99" ? "Linked Note" : null));
        expect(result).toContain("Linked Note");
    });

    it("extracts link-embed metadata and entity-decodes attribute values", () => {
        // dataDowncast markup from link_embed_editing.ts (metadataViewAttributes): class first,
        // then META_KEYS-ordered data-* attributes.
        const html = `<section class="link-embed" data-url="https://example.com/a" data-embed-type="card" data-title="Great Article" data-description="Things &amp; stuff" data-site-name="Example Site"><div class="link-embed-preview-wrapper"></div></section>`;
        const result = preprocessContent(html, type, mime, false);
        expect(result).toContain("https://example.com/a");
        expect(result).toContain("Great Article");
        expect(result).toContain("Things & stuff");
        expect(result).toContain("Example Site");
    });

    it("extracts link-mention metadata", () => {
        const html = `<p>a <span class="link-mention" data-url="https://example.com/x" data-title="Mentioned Thing" data-site-name="Mention Site">x</span> b</p>`;
        const result = preprocessContent(html, type, mime, false);
        expect(result).toContain("https://example.com/x");
        expect(result).toContain("Mentioned Thing");
        expect(result).toContain("Mention Site");
    });

    it("appends a repeated link target's title only once", () => {
        const html = `<p><a href="#root/dup1" class="reference-link"></a> and <a href="#root/dup1">again</a></p>`;
        let calls = 0;
        const result = preprocessContent(html, type, mime, false, (id) => {
            if (id === "dup1") {
                calls++;
                return "Repeated Target";
            }
            return null;
        });
        expect(result.match(/Repeated Target/g)?.length).toEqual(1);
        expect(calls).toEqual(1);
    });

    it("skips link targets whose resolver returns null (no crash, nothing appended)", () => {
        const html = `<p><a href="#root/missing1" class="reference-link"></a></p>`;
        const withNullResolver = preprocessContent(html, type, mime, false, () => null);
        const withoutResolver = preprocessContent(html, type, mime, false);
        // A null return appends no title, so output matches the resolver-omitted case.
        expect(withNullResolver).toEqual(withoutResolver);
    });

    it("behaves as before when no resolver is given (internal-link titles not injected)", () => {
        const html = `<p><a href="#root/abc123DEF456" class="reference-link"></a></p>`;
        const result = preprocessContent(html, type, mime, false);
        // No title is injected; the stripped anchor leaves the href-bearing tag behind.
        expect(result).not.toContain("Special Topic");
    });

    it("keeps plain external link URLs searchable (regression)", () => {
        const html = `<p>see <a href="https://example.com/x">the site</a> now</p>`;
        const result = preprocessContent(html, type, mime, false);
        expect(result).toContain("https://example.com/x");
    });
});

describe("LLM chat preprocessing", () => {
    const type: NoteType = "llmChat";
    const mime = "application/json";

    it("supports empty / invalid JSON", () => {
        expect(preprocessContent("{}", type, mime)).toEqual("");
        expect(preprocessContent("", type, mime)).toEqual("");
    });

    it("reads conversation prose and skips metadata", () => {
        const chat = JSON.stringify({
            version: 1,
            messages: [
                { id: "1", role: "user", content: "What is a Branch?" },
                { id: "2", role: "assistant", content: [ { type: "text", content: "A parent-child link." } ] }
            ]
        });
        expect(preprocessContent(chat, type, mime)).toEqual("what is a branch? a parent-child link.");
    });
});