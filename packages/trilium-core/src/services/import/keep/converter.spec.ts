import { describe, expect, it } from "vitest";

import { convertKeepHtml, convertKeepHtmlInline } from "./converter.js";

/** Builds a Keep-style styled span (the export wraps every run of text in one of these). */
function span(text: string, style: string): string {
    return `<span style="font-size:7.2pt;font-family:'Google Sans';color:#000000;${style}">${text}</span>`;
}

describe("Google Keep converter — convertKeepHtml", () => {
    it("converts bold / italic / underline spans to semantic tags and drops the style noise", () => {
        const html =
            `<p dir="ltr" style="line-height:1.38;">` +
            span("Bold", "font-weight:700;font-style:normal;text-decoration:none;") +
            span("italic", "font-weight:400;font-style:italic;text-decoration:none;") +
            span("underline", "font-weight:400;font-style:normal;text-decoration:underline;-webkit-text-decoration-skip:none;") +
            `</p>`;

        expect(convertKeepHtml(html)).toBe("<p><strong>Bold</strong><i>italic</i><u>underline</u></p>");
    });

    it("nests all three when a run is bold + italic + underline (bold outermost)", () => {
        const html = `<p>${span("all three", "font-weight:700;font-style:italic;text-decoration:underline;")}</p>`;

        expect(convertKeepHtml(html)).toBe("<p><strong><i><u>all three</u></i></strong></p>");
    });

    it("preserves headings (unwrapping their unstyled spans) and leaves entities intact", () => {
        const html =
            `<h1 dir="ltr" style="line-height:1.38;">${span("Heading 1", "font-weight:400;")}</h1>` +
            `<h2 dir="ltr" style="line-height:1.38;">${span("Heading 2", "font-weight:400;")}</h2>` +
            `<p>${span("a &amp; b", "font-weight:400;font-style:normal;text-decoration:none;")}</p>`;

        expect(convertKeepHtml(html)).toBe("<h1>Heading 1</h1><h2>Heading 2</h2><p>a &amp; b</p>");
    });

    it("unwraps a plain span entirely, keeping only its text", () => {
        expect(convertKeepHtml(`<p>${span("plain", "font-weight:400;")}</p>`)).toBe("<p>plain</p>");
    });

    it("treats the `font-weight:bold` keyword (no numeric weight) as bold", () => {
        expect(convertKeepHtml(`<p>${span("bold keyword", "font-weight:bold;")}</p>`)).toBe("<p><strong>bold keyword</strong></p>");
    });

    it("unwraps a span that has no style attribute at all", () => {
        expect(convertKeepHtml(`<p><span>no style</span></p>`)).toBe("<p>no style</p>");
    });
});

describe("Google Keep converter — convertKeepHtmlInline", () => {
    it("unwraps the single block element Keep wraps a list item's text in", () => {
        const html = `<p dir="ltr" style="line-height:1.38;">${span("This is a note with", "font-weight:400;")}</p>`;

        expect(convertKeepHtmlInline(html)).toBe("This is a note with");
    });

    it("keeps inline formatting inside the unwrapped item", () => {
        const html = `<p>${span("done", "font-weight:700;")}</p>`;

        expect(convertKeepHtmlInline(html)).toBe("<strong>done</strong>");
    });

    it("falls back to the cleaned markup when the fragment is not a single element", () => {
        const html =
            `<p dir="ltr" style="line-height:1.38;">${span("first", "font-weight:400;")}</p>` +
            `<p dir="ltr" style="line-height:1.38;">${span("second", "font-weight:700;")}</p>`;

        expect(convertKeepHtmlInline(html)).toBe("<p>first</p><p><strong>second</strong></p>");
    });
});
