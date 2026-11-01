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
        // The appended title is normalized (lowercased) to match the normalized body.
        const html = `<p>See <a href="#root/abc123DEF456" class="reference-link"></a> for details.</p>`;
        const result = preprocessContent(html, type, mime, false, (id) => (id === "abc123DEF456" ? "Special Topic" : null));
        expect(result).toContain("special topic");
    });

    it("normalizes injected link text so a lowercased single-token query matches", () => {
        // Extraction runs against the case-preserved original (so link-target noteIds resolve),
        // but the APPENDED text must be lowercased and diacritic-stripped: the default single-token
        // content match lowercases the query token and does a raw includes(), so `zurich` must hit
        // a linked "Zürich" (and `special` a linked "Special Topic") in phase 1, not only via fuzzy.
        const html = `<p><a href="#root/city1" class="reference-link"></a></p>`;
        const result = preprocessContent(html, type, mime, false, (id) => (id === "city1" ? "Zürich" : null));
        expect(result).toContain("zurich");
        expect(result).not.toContain("Zürich");
    });

    it("also resolves plain internal links (not only reference links)", () => {
        const html = `<p>Jump to <a href="#root/parent1/target99">whatever</a>.</p>`;
        const result = preprocessContent(html, type, mime, false, (id) => (id === "target99" ? "Linked Note" : null));
        expect(result).toContain("linked note");
    });

    it("extracts link-embed metadata and entity-decodes attribute values", () => {
        // dataDowncast markup from link_embed_editing.ts (metadataViewAttributes): class first,
        // then META_KEYS-ordered data-* attributes. Injected metadata is normalized (lowercased).
        const html = `<section class="link-embed" data-url="https://example.com/a" data-embed-type="card" data-title="Great Article" data-description="Things &amp; stuff" data-site-name="Example Site"><div class="link-embed-preview-wrapper"></div></section>`;
        const result = preprocessContent(html, type, mime, false);
        expect(result).toContain("https://example.com/a");
        expect(result).toContain("great article");
        expect(result).toContain("things & stuff");
        expect(result).toContain("example site");
    });

    it("extracts link-mention metadata", () => {
        const html = `<p>a <span class="link-mention" data-url="https://example.com/x" data-title="Mentioned Thing" data-site-name="Mention Site">x</span> b</p>`;
        const result = preprocessContent(html, type, mime, false);
        expect(result).toContain("https://example.com/x");
        expect(result).toContain("mentioned thing");
        expect(result).toContain("mention site");
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
        expect(result.match(/repeated target/g)?.length).toEqual(1);
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

describe("Inline icon searchability", () => {
    const type: NoteType = "text";
    const mime = "text/html";

    it("makes an icon findable by its class and by the name inside it", () => {
        // dataDowncast markup from inline_icon_editing.ts: an element with nothing inside it, so
        // stripping the markup would otherwise leave no trace of the icon at all.
        const html = `<p>Press <span class="tn-icon bx bx-error-circle"></span> to stop.</p>`;

        const result = preprocessContent(html, type, mime);

        expect(result).toContain("press");
        expect(result).toContain("bx-error-circle");
        expect(result).toContain("error-circle");
    });

    it("leaves out the marker class and the pack's bare prefix, which name no icon", () => {
        const html = `<p><span class="tn-icon bx bx-star"></span></p>`;

        const words = preprocessContent(html, type, mime).split(/\s+/).filter(Boolean);

        expect(words).toEqual([ "bx-star", "star" ]);
    });

    it("names an icon by its pack's class, not by another class the tag carries", () => {
        // The editor keeps every class an imported icon wears, so a tag can carry a class from
        // somewhere else entirely. Only a class whose prefix the tag also wears bare names an icon,
        // and the snippet builder takes the first of them.
        const html = `<p><span class="tn-icon text-big bx bx-star"></span></p>`;

        const words = preprocessContent(html, type, mime).split(/\s+/).filter(Boolean);

        expect(words).toEqual([ "bx-star", "star" ]);
    });

    it("names an icon once however often the note carries it", () => {
        const icon = `<span class="tn-icon bx bx-star"></span>`;
        const html = `<p>${icon} one ${icon} two ${icon}</p>`;

        const words = preprocessContent(html, type, mime).split(/\s+/).filter(Boolean);

        expect(words.filter((word) => word === "star")).toHaveLength(1);
    });

    it("reads the icon out of a colour wrapper, and out of single-quoted markup", () => {
        const html = `<p><span style="color:red;">`
            + `<span class='tn-icon bx bx-bulb'></span></span></p>`;

        expect(preprocessContent(html, type, mime)).toContain("bulb");
    });

    it("leaves content carrying no icon as it was", () => {
        const html = "<p>Nothing to see here.</p>";

        expect(preprocessContent(html, type, mime).trim()).toBe("nothing to see here.");
    });
});

describe("Spreadsheet preprocessing", () => {
    const type: NoteType = "spreadsheet";
    const mime = "application/json";

    it("supports empty / invalid JSON", () => {
        expect(preprocessContent("{}", type, mime)).toEqual("");
        expect(preprocessContent("", type, mime)).toEqual("");
    });

    it("reads visible cell values", () => {
        const workbook = JSON.stringify({
            workbook: {
                sheets: {
                    s1: { cellData: { 0: { 0: { v: "Revenue" }, 1: { v: 42 } } } }
                }
            }
        });
        expect(preprocessContent(workbook, type, mime)).toEqual("revenue 42");
    });
});

describe("Text (HTML) preprocessing", () => {
    const type: NoteType = "text";
    const mime = "text/html";

    it("surfaces link-preview title, url and description from data attributes", () => {
        const content = `<section class="link-embed" data-url="https://en.wikipedia.org/wiki/The_Terminator" data-title="The Terminator - Wikipedia" data-description="A 1984 science fiction film.">&nbsp;</section>`;
        const result = preprocessContent(content, type, mime);

        expect(result).toContain("the terminator - wikipedia");
        expect(result).toContain("https://en.wikipedia.org/wiki/the_terminator");
        expect(result).toContain("a 1984 science fiction film.");
    });

    it("makes the searchable body the text the editor displays", () => {
        // `extractContentSnippet()` decodes the same set to render a hit, so the spelling on screen
        // is what a query has to be able to reach.
        const ampersand = "<p>AT&amp;T reported earnings.</p>";
        const entities = "<p>if a &lt; b &amp;&amp; b &gt; c, then&nbsp;done</p>";
        const href = `<p>see <a href="https://example.com/?a=1&amp;b=2">docs</a></p>`;
        const shown = "<p>use &amp;amp; to write one</p>";

        expect(preprocessContent(ampersand, type, mime)).toEqual("at&t reported earnings.");
        expect(preprocessContent(entities, type, mime)).toEqual("if a < b && b > c, then done");
        expect(preprocessContent(href, type, mime)).toContain("https://example.com/?a=1&b=2");
        // Decoded once: this body shows "&amp;", where a second pass would leave a bare "&".
        expect(preprocessContent(shown, type, mime)).toContain("use &amp; to write one");
    });

    it("keeps the markup but still unescapes entities when raw is requested", () => {
        const spacing = preprocessContent("<p>Hello&nbsp;world</p>", type, mime, true);
        // `note.rawContent` searches the stored markup, so the basic entities stay encoded there.
        const markup = preprocessContent("<p>AT&amp;T</p>", type, mime, true);

        expect(spacing).toEqual("<p>hello world</p>");
        expect(markup).toEqual("<p>at&amp;t</p>");
    });
});

describe("Unhandled type/mime combinations", () => {
    it("returns the normalized content untouched", () => {
        // Neither the type nor the mime matches any branch, so no extractor runs.
        expect(preprocessContent("Plain Text", "code", "text/plain")).toEqual("plain text");
        expect(preprocessContent("{}", "llmChat", "text/plain")).toEqual("{}");
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