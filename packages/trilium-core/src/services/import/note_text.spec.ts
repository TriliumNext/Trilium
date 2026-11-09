import { describe, expect, it } from "vitest";

import { prepareNoteText, removeTriliumTags } from "./note_text.js";

describe("prepareNoteText", () => {
    const prepare = (content: string) => prepareNoteText({
        content,
        title: "Title",
        extractFrontmatter: false,
        renderMarkdown: false,
        isTextLike: true,
        safeImport: false
    }).content;

    it("strips the wrappers the way a greedy regex does", () => {
        const cases = [
            `<div class="ck-content"><p>a</p></div>`,
            `<div class="content"><div class="ck-content"><p>a</p></div></div>`,
            `<p>before</p><div class="ck-content"><div>inner</div><p>x</p></div><p>after</p>`,
            `<div class="ck-content"><p>no closing tag</p>`,
            `</div><div class="ck-content"><p>closing tag only before</p>`,
            `<div class="ck-content"></div><div class="ck-content"></div>`
        ];

        for (const input of cases) {
            expect(removeTriliumTags(input)).toBe(input
                .replace(/<div class="ck-content">(.*)<\/div>/gms, "$1")
                .replace(/<div class="content">(.*)<\/div>/gms, "$1"));
        }

        const documents = [
            `<!DOCTYPE html><HTML lang="en"><head><title>t</title></head>`
                + `<Body class="x"><p>a</p></BODY></html>`,
            `<html><body><p>a</p></body></html><p>tail</p>`,
            `<html><body><p>a</p><body><p>b</p></body></html>`,
            `<html><head></head><p>no body</p></html>`,
            `<html><body`,
            `<p>a</p></body><p>no html</p>`,
            `<p>only text</p>`
        ];

        for (const input of documents) {
            expect(prepare(input)).toBe(input
                .replace(/<html.*<body[^>]*>/gis, "")
                .replace(/<\/body>.*<\/html>/gis, ""));
        }
    });

    it("runs in linear time on unterminated wrappers", () => {
        const inputs = [
            `<div class="ck-content">a`.repeat(20_000),
            `<div class="content">a`.repeat(20_000),
            "<html".repeat(80_000),
            "</body>".repeat(60_000)
        ];

        for (const input of inputs) {
            const start = performance.now();
            prepare(input);
            expect(performance.now() - start).toBeLessThan(250);
        }
    });
});
