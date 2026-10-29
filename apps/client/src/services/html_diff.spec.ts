import { describe, expect, it } from "vitest";

import { diffHtml } from "./html_diff";

describe("diffHtml", () => {
    it("returns identical content unchanged", () => {
        expect(diffHtml("<p>a b</p>", "<p>a b</p>")).toBe("<p>a b</p>");
    });

    it("marks a replaced, an inserted and a deleted word", () => {
        expect(diffHtml("<p>The quick brown fox</p>", "<p>The quick red fox</p>"))
            .toBe("<p>The quick <del class=\"diffmod\">brown</del><ins class=\"diffmod\">red</ins> fox</p>");
        expect(diffHtml("<p>one three</p>", "<p>one two three</p>"))
            .toBe("<p>one <ins class=\"diffins\">two </ins>three</p>");
        expect(diffHtml("<p>one two three</p>", "<p>one three</p>"))
            .toBe("<p>one <del class=\"diffdel\">two </del>three</p>");
    });

    it("keeps punctuation and entities out of the word they follow", () => {
        expect(diffHtml("<p>Hello, world.</p>", "<p>Hello, there.</p>"))
            .toBe("<p>Hello, <del class=\"diffmod\">world</del><ins class=\"diffmod\">there</ins>.</p>");
        expect(diffHtml("<p>Tom &amp; Jerry</p>", "<p>Tom &amp; Spike</p>"))
            .toBe("<p>Tom &amp; <del class=\"diffmod\">Jerry</del><ins class=\"diffmod\">Spike</ins></p>");
    });

    it("ignores a changed attribute, but marks a changed image", () => {
        expect(diffHtml("<p><a href=\"1\">x</a></p>", "<p><a href=\"2\">x</a></p>"))
            .toBe("<p><a href=\"2\">x</a></p>");
        expect(diffHtml("<p><img src=\"a.png\"></p>", "<p><img src=\"b.png\"></p>"))
            .toBe("<p><del class=\"diffmod\"><img src=\"a.png\"></del><ins class=\"diffmod\"><img src=\"b.png\"></ins></p>");
    });

    it("marks the text of an added paragraph inside the paragraph's own markup", () => {
        expect(diffHtml("<p>a</p>", "<p>a</p><p>b</p>"))
            .toBe("<p>a</p><p><ins class=\"diffins\">b</ins></p>");
        expect(diffHtml("", "<p>x</p>")).toBe("<p><ins class=\"diffins\">x</ins></p>");
    });

    it("keeps the space a mark starts with visible", () => {
        expect(diffHtml("<p>a</p>", "<p>a b</p>")).toBe("<p>a<ins class=\"diffins\">&nbsp;b</ins></p>");
    });

    it("marks a reworded phrase as one replacement rather than word by word", () => {
        expect(diffHtml("<p>In an age that prizes speed</p>", "<p>These days everyone's obsessed with speed</p>"))
            .toBe("<p><del class=\"diffmod\">In an age that prizes</del>"
                + "<ins class=\"diffmod\">These days everyone's obsessed with</ins> speed</p>");
        expect(diffHtml("<p>has become a quietly radical act</p>", "<p>almost feels like a rebellious little act</p>"))
            .toBe("<p><del class=\"diffmod\">has become a quietly radical</del>"
                + "<ins class=\"diffmod\">almost feels like a rebellious little</ins> act</p>");
    });

    it("keeps a tag between two changes out of the marks", () => {
        expect(diffHtml("<p>old</p><p>text</p>", "<p>new</p><p>words</p>"))
            .toBe("<p><del class=\"diffmod\">old</del><ins class=\"diffmod\">new</ins></p>"
                + "<p><del class=\"diffmod\">text</del><ins class=\"diffmod\">words</ins></p>");
    });

    it("keeps accented and non-Latin words whole", () => {
        expect(diffHtml("<p>Pijem čaj.</p>", "<p>Pijem čas.</p>"))
            .toBe("<p>Pijem <del class=\"diffmod\">čaj</del><ins class=\"diffmod\">čas</ins>.</p>");
        expect(diffHtml("<p>привет мир</p>", "<p>привет друг</p>"))
            .toBe("<p>привет <del class=\"diffmod\">мир</del><ins class=\"diffmod\">друг</ins></p>");
    });

    it("compares Chinese and Japanese text character by character", () => {
        expect(diffHtml("<p>我的笔记本</p>", "<p>我的电脑</p>"))
            .toBe("<p>我的<del class=\"diffmod\">笔记本</del><ins class=\"diffmod\">电脑</ins></p>");
    });

    it("shows a change of formatting as the new formatting, without marks", () => {
        expect(diffHtml("<p>foo bar</p>", "<p>foo <strong>bar</strong></p>"))
            .toBe("<p>foo <strong>bar</strong></p>");
        expect(diffHtml("<p>foo <strong>bar</strong></p>", "<p>foo bar</p>"))
            .toBe("<p>foo bar</p>");
    });

    it("diffs a long note with a short edit", () => {
        const words = Array.from({ length: 100_000 }, (_, index) => `w${index}`).join(" ");
        expect(diffHtml(`<p>${words} old</p>`, `<p>${words} new</p>`))
            .toBe(`<p>${words} <del class="diffmod">old</del><ins class="diffmod">new</ins></p>`);
    });
});
