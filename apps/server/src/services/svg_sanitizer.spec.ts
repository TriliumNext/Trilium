import { describe, expect, it } from "vitest";
import { sanitizeSvg } from "./svg_sanitizer.js";

describe("SVG Sanitizer", () => {
    describe("removes dangerous elements", () => {
        it("strips <script> tags with content", () => {
            const dirty = `<svg xmlns="http://www.w3.org/2000/svg"><script>alert('XSS')</script><circle r="50"/></svg>`;
            const clean = sanitizeSvg(dirty);
            expect(clean).not.toContain("<script");
            expect(clean).not.toContain("alert");
            expect(clean).toContain("<circle");
        });

        it("strips <script> tags case-insensitively", () => {
            const dirty = `<svg xmlns="http://www.w3.org/2000/svg"><SCRIPT>alert('XSS')</SCRIPT></svg>`;
            const clean = sanitizeSvg(dirty);
            expect(clean).not.toContain("SCRIPT");
            expect(clean).not.toContain("alert");
        });

        it("strips <script> tags with attributes", () => {
            const dirty = `<svg xmlns="http://www.w3.org/2000/svg"><script type="text/javascript">alert('XSS')</script></svg>`;
            const clean = sanitizeSvg(dirty);
            expect(clean).not.toContain("<script");
            expect(clean).not.toContain("alert");
        });

        it("strips self-closing <script> tags", () => {
            const dirty = `<svg xmlns="http://www.w3.org/2000/svg"><script src="evil.js"/></svg>`;
            const clean = sanitizeSvg(dirty);
            expect(clean).not.toContain("<script");
            expect(clean).not.toContain("evil.js");
        });

        it("strips <foreignObject> elements", () => {
            const dirty = `<svg xmlns="http://www.w3.org/2000/svg"><foreignObject><body xmlns="http://www.w3.org/1999/xhtml"><script>alert(1)</script></body></foreignObject></svg>`;
            const clean = sanitizeSvg(dirty);
            expect(clean).not.toContain("foreignObject");
            expect(clean).not.toContain("alert");
        });

        it("strips <iframe> elements", () => {
            const dirty = `<svg xmlns="http://www.w3.org/2000/svg"><iframe src="https://evil.com"></iframe></svg>`;
            const clean = sanitizeSvg(dirty);
            expect(clean).not.toContain("<iframe");
            expect(clean).not.toContain("evil.com");
        });

        it("strips <embed> elements", () => {
            const dirty = `<svg xmlns="http://www.w3.org/2000/svg"><embed src="evil.swf"/></svg>`;
            const clean = sanitizeSvg(dirty);
            expect(clean).not.toContain("<embed");
        });

        it("strips <object> elements", () => {
            const dirty = `<svg xmlns="http://www.w3.org/2000/svg"><object data="evil.swf"></object></svg>`;
            const clean = sanitizeSvg(dirty);
            expect(clean).not.toContain("<object");
        });

        it("strips <link> elements", () => {
            const dirty = `<svg xmlns="http://www.w3.org/2000/svg"><link rel="stylesheet" href="evil.css"/></svg>`;
            const clean = sanitizeSvg(dirty);
            expect(clean).not.toContain("<link");
        });

        it("strips <meta> elements", () => {
            const dirty = `<svg xmlns="http://www.w3.org/2000/svg"><meta http-equiv="refresh" content="0;url=evil.com"/></svg>`;
            const clean = sanitizeSvg(dirty);
            expect(clean).not.toContain("<meta");
        });
    });

    describe("removes event handler attributes", () => {
        it("strips onload from SVG root", () => {
            const dirty = `<svg xmlns="http://www.w3.org/2000/svg" onload="alert('XSS')"><circle r="50"/></svg>`;
            const clean = sanitizeSvg(dirty);
            expect(clean).not.toContain("onload");
            expect(clean).not.toContain("alert");
            expect(clean).toContain("<circle");
            expect(clean).toContain("<svg");
        });

        it("strips onclick from elements", () => {
            const dirty = `<svg xmlns="http://www.w3.org/2000/svg"><circle r="50" onclick="alert('XSS')"/></svg>`;
            const clean = sanitizeSvg(dirty);
            expect(clean).not.toContain("onclick");
            expect(clean).not.toContain("alert");
            expect(clean).toContain("r=\"50\"");
        });

        it("strips onerror from elements", () => {
            const dirty = `<svg xmlns="http://www.w3.org/2000/svg"><image onerror="alert('XSS')" href="x"/></svg>`;
            const clean = sanitizeSvg(dirty);
            expect(clean).not.toContain("onerror");
            expect(clean).not.toContain("alert");
        });

        it("strips onmouseover from elements", () => {
            const dirty = `<svg xmlns="http://www.w3.org/2000/svg"><rect onmouseover="alert('XSS')" width="100" height="100"/></svg>`;
            const clean = sanitizeSvg(dirty);
            expect(clean).not.toContain("onmouseover");
        });

        it("strips onfocus from elements", () => {
            const dirty = `<svg xmlns="http://www.w3.org/2000/svg"><rect onfocus="alert('XSS')" tabindex="0"/></svg>`;
            const clean = sanitizeSvg(dirty);
            expect(clean).not.toContain("onfocus");
        });
    });

    describe("removes dangerous URI schemes", () => {
        it("strips javascript: URIs from href", () => {
            const dirty = `<svg xmlns="http://www.w3.org/2000/svg"><a href="javascript:alert('XSS')"><text>Click</text></a></svg>`;
            const clean = sanitizeSvg(dirty);
            expect(clean).not.toContain("javascript:");
            expect(clean).toContain("<text>Click</text>");
        });

        it("strips javascript: URIs from xlink:href", () => {
            const dirty = `<svg xmlns="http://www.w3.org/2000/svg"><a xlink:href="javascript:alert('XSS')"><text>Click</text></a></svg>`;
            const clean = sanitizeSvg(dirty);
            expect(clean).not.toContain("javascript:");
        });

        it("strips data:text/html URIs", () => {
            const dirty = `<svg xmlns="http://www.w3.org/2000/svg"><a href="data:text/html,<script>alert(1)</script>"><text>Click</text></a></svg>`;
            const clean = sanitizeSvg(dirty);
            expect(clean).not.toContain("data:text/html");
        });

        it("strips vbscript: URIs", () => {
            const dirty = `<svg xmlns="http://www.w3.org/2000/svg"><a href="vbscript:msgbox('XSS')"><text>Click</text></a></svg>`;
            const clean = sanitizeSvg(dirty);
            expect(clean).not.toContain("vbscript:");
        });

        it("strips javascript: URIs with whitespace padding", () => {
            const dirty = `<svg xmlns="http://www.w3.org/2000/svg"><a href="  javascript:alert(1)"><text>Click</text></a></svg>`;
            const clean = sanitizeSvg(dirty);
            expect(clean).not.toContain("javascript:");
        });
    });

    describe("removes xml-stylesheet processing instructions", () => {
        it("strips xml-stylesheet PIs", () => {
            const dirty = `<?xml-stylesheet type="text/xsl" href="evil.xsl"?><svg xmlns="http://www.w3.org/2000/svg"><circle r="50"/></svg>`;
            const clean = sanitizeSvg(dirty);
            expect(clean).not.toContain("xml-stylesheet");
            expect(clean).toContain("<circle");
        });
    });

    describe("preserves legitimate SVG content", () => {
        it("preserves basic SVG shapes", () => {
            const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="40" fill="red"/><rect x="10" y="10" width="80" height="80" fill="blue"/></svg>`;
            const clean = sanitizeSvg(svg);
            expect(clean).toBe(svg);
        });

        it("preserves SVG paths", () => {
            const svg = `<svg xmlns="http://www.w3.org/2000/svg"><path d="M10 10 L90 90" stroke="black" stroke-width="2"/></svg>`;
            const clean = sanitizeSvg(svg);
            expect(clean).toBe(svg);
        });

        it("preserves SVG text elements", () => {
            const svg = `<svg xmlns="http://www.w3.org/2000/svg"><text x="50" y="50" font-size="20">Hello World</text></svg>`;
            const clean = sanitizeSvg(svg);
            expect(clean).toBe(svg);
        });

        it("preserves SVG groups and transforms", () => {
            const svg = `<svg xmlns="http://www.w3.org/2000/svg"><g transform="translate(10,10)"><circle r="5"/></g></svg>`;
            const clean = sanitizeSvg(svg);
            expect(clean).toBe(svg);
        });

        it("preserves SVG style elements with CSS (not script)", () => {
            const svg = `<svg xmlns="http://www.w3.org/2000/svg"><style>.cls{fill:red}</style><circle class="cls" r="50"/></svg>`;
            const clean = sanitizeSvg(svg);
            expect(clean).toContain("<style>");
            expect(clean).toContain("fill:red");
        });

        it("preserves SVG defs and gradients", () => {
            const svg = `<svg xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="grad"><stop offset="0%" stop-color="red"/><stop offset="100%" stop-color="blue"/></linearGradient></defs><rect fill="url(#grad)" width="100" height="100"/></svg>`;
            const clean = sanitizeSvg(svg);
            expect(clean).toContain("linearGradient");
            expect(clean).toContain("url(#grad)");
        });

        it("preserves safe href attributes (non-javascript)", () => {
            const svg = `<svg xmlns="http://www.w3.org/2000/svg"><a href="https://example.com"><text>Link</text></a></svg>`;
            const clean = sanitizeSvg(svg);
            expect(clean).toContain(`href="https://example.com"`);
        });

        it("preserves data: URIs for images (non-HTML)", () => {
            const svg = `<svg xmlns="http://www.w3.org/2000/svg"><image href="data:image/png;base64,abc123"/></svg>`;
            const clean = sanitizeSvg(svg);
            expect(clean).toContain("data:image/png;base64,abc123");
        });

        it("preserves empty SVG", () => {
            const svg = `<svg xmlns="http://www.w3.org/2000/svg"></svg>`;
            const clean = sanitizeSvg(svg);
            expect(clean).toBe(svg);
        });
    });

    describe("handles edge cases", () => {
        it("handles Buffer input", () => {
            const svg = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>`);
            const clean = sanitizeSvg(svg);
            expect(clean).not.toContain("<script");
        });

        it("handles multiple script tags", () => {
            const dirty = `<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script><circle r="50"/><script>alert(2)</script></svg>`;
            const clean = sanitizeSvg(dirty);
            expect(clean).not.toContain("<script");
            expect(clean).toContain("<circle");
        });

        it("handles mixed dangerous content", () => {
            const dirty = `<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"><script>alert(2)</script><foreignObject><body xmlns="http://www.w3.org/1999/xhtml"><img onerror="alert(3)"/></body></foreignObject><circle r="50" onclick="alert(4)"/></svg>`;
            const clean = sanitizeSvg(dirty);
            expect(clean).not.toContain("alert");
            expect(clean).not.toContain("onload");
            expect(clean).not.toContain("<script");
            expect(clean).not.toContain("foreignObject");
            expect(clean).not.toContain("onclick");
            expect(clean).toContain("<circle");
        });

        it("handles empty string input", () => {
            expect(sanitizeSvg("")).toBe("");
        });
    });
});
