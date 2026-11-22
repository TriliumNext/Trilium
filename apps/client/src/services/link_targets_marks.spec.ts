// @vitest-environment jsdom
// The HTML parser repairs table parts outside a table, and parses a `<template>` by other rules
// than a `<div>`, as browsers do; happy-dom's parser does neither, so these cases run under jsdom.
import { describe, expect, it, vi } from "vitest";

import { findMarkedIndex } from "./link_targets.js";

vi.mock("../components/app_context", () => ({ default: {} }));

/**
 * The positions that `findMarkedIndex()` gives the headings of a page showing `stored`, when the
 * server marked `stored` as `marked`, in source order.
 */
function findPositions(stored: string, marked: string) {
    const page = document.createElement("div");
    page.innerHTML = stored;
    const shown = Array.from(page.querySelectorAll("h1,h2,h3,h4,h5,h6"));
    const listing = { blobId: "b", headings: [], markedContent: marked, markToken: "Tok" };
    return shown.map((heading) => [ heading.textContent, findMarkedIndex(listing, shown, heading) ]);
}

/** `html` with `data-trilium-heading-index` on each `<h2>`, numbered in source order. */
function markInSourceOrder(html: string) {
    let position = 0;
    return html.replace(/<h2/g, () => `<h2 data-trilium-heading-index="Tok.${position++}"`);
}

describe("findMarkedIndex on content that the browser repairs", () => {
    it("names each heading of table rows without a table by its own mark", () => {
        const stored = "<tr><td><h2>A</h2></td></tr><tr><h2>B</h2><td><h2>C</h2></td></tr>";
        const template = document.createElement("template");
        template.innerHTML = stored;
        expect(Array.from(template.content.querySelectorAll("h2"), (h) => h.textContent))
            .toStrictEqual([ "A", "C", "B" ]);

        expect(findPositions(stored, markInSourceOrder(stored)))
            .toStrictEqual([ [ "A", 0 ], [ "B", 1 ], [ "C", 2 ] ]);
    });

    it("follows a heading that the browser moves out of a table", () => {
        const stored = "<table><tr><td><h2>Install</h2></td></tr>"
            + "<h2 class=\"moved\">Install</h2></table>";
        const page = document.createElement("div");
        page.innerHTML = stored;
        expect(page.querySelector("h2")?.className).toBe("moved");

        expect(findPositions(stored, markInSourceOrder(stored)))
            .toStrictEqual([ [ "Install", 1 ], [ "Install", 0 ] ]);
    });

    it("keeps the page's order around an orphaned cell, a caption and a stray closing tag", () => {
        for (const stored of [
            "<td><h2>A</h2></td><h2>B</h2>", "<caption><h2>A</h2></caption><h2>B</h2>",
            "<h2>A</h2></div><h2>B</h2>"
        ]) {
            expect(findPositions(stored, markInSourceOrder(stored)))
                .toStrictEqual([ [ "A", 0 ], [ "B", 1 ] ]);
        }
    });
});
