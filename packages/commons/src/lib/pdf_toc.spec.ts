import { describe, expect, it } from "vitest";

import {
    type PdfOutlineEntry, type PdfOutlineSource, readPdfOutline, toPdfTocHeadings
} from "./pdf_toc.js";
import { MAX_TOC_HEADINGS } from "./toc.js";

describe("readPdfOutline", () => {
    it("reads every shape of destination, and keeps only those that lead to a page", async () => {
        const xyz = [ ref(0), { name: "XYZ" }, 72, 700, null ];
        const pdf = fakePdf([
            entry("Chapter 1", xyz, [ entry("Section <b>1.1</b> & more", [ ref(0), { name: "Fit" } ]) ]),
            entry("Named", "chapter-2"),
            entry("Missing", "no-such-destination"),
            entry("  Spaced\tout ", [ 1, { name: "Fit" } ]),
            entry("Link", null),
            entry("Past the end", [ ref(12), { name: "Fit" } ]),
            entry("Before the start", [ -1, { name: "Fit" } ]),
            entry("Bad reference", [ { num: 99, gen: 0 }, { name: "Fit" } ]),
            entry("No target", [ null, { name: "Fit" } ]),
            entry("Text target", [ "page", { name: "Fit" } ])
        ], { "chapter-2": [ ref(1), { name: "XYZ" }, 0, 0, null ] });

        expect(await readPdfOutline(pdf)).toStrictEqual([
            { title: "Chapter 1", level: 1, page: 1, dest: xyz },
            { title: "Section <b>1.1</b> & more", level: 2, page: 1, dest: [ ref(0), { name: "Fit" } ] },
            { title: "Named", level: 1, page: 2, dest: [ ref(1), { name: "XYZ" }, 0, 0, null ] },
            { title: "Missing", level: 1 },
            { title: "Spaced out", level: 1, page: 2, dest: [ 1, { name: "Fit" } ] },
            { title: "Link", level: 1 },
            { title: "Past the end", level: 1 },
            { title: "Before the start", level: 1 },
            { title: "Bad reference", level: 1 },
            { title: "No target", level: 1 },
            { title: "Text target", level: 1 }
        ]);
    });

    it("reads a document without an outline, and entries without a title or children", async () => {
        expect(await readPdfOutline(fakePdf(null))).toStrictEqual([]);

        const odd = { title: undefined, dest: null } as unknown as PdfOutlineEntry;
        expect(await readPdfOutline(fakePdf([ odd ]))).toStrictEqual([ { title: "", level: 1 } ]);
    });

    it("gives a heading without a page the page of the first heading below it that has one", async () => {
        const headings = await readPdfOutline(fakePdf([
            entry("Part I", null, [
                entry("Intro", null, [ entry("Scope", null), entry("Aims", [ ref(4) ]) ]),
                entry("Methods", [ ref(6) ])
            ]),
            entry("Part II", null, [ entry("Nothing here", null) ]),
            entry("Part III", [ ref(8) ])
        ]));

        expect(headings.map(({ title, page, inheritedPage }) => ({ title, page, inheritedPage })))
            .toStrictEqual([
                { title: "Part I", page: undefined, inheritedPage: 5 },
                { title: "Intro", page: undefined, inheritedPage: 5 },
                { title: "Scope", page: undefined, inheritedPage: undefined },
                { title: "Aims", page: 5, inheritedPage: undefined },
                { title: "Methods", page: 7, inheritedPage: undefined },
                { title: "Part II", page: undefined, inheritedPage: undefined },
                { title: "Nothing here", page: undefined, inheritedPage: undefined },
                { title: "Part III", page: 9, inheritedPage: undefined }
            ]);
    });

    it("keeps the levels of the file past 32, and a deep group inherits its child's page", async () => {
        let deepest = entry("Level 33", [ ref(3) ]);
        deepest = entry("Level 32", null, [ deepest ]);
        for (let level = 31; level >= 1; level--) {
            deepest = entry(`Level ${level}`, [ ref(0) ], [ deepest ]);
        }

        const headings = await readPdfOutline(fakePdf([ deepest ]));

        expect(headings).toHaveLength(33);
        expect(headings[31]).toMatchObject({ title: "Level 32", level: 32, inheritedPage: 4 });
        expect(headings[32]).toMatchObject({ title: "Level 33", level: 33, page: 4 });
    });

    it("keeps at most the limit of headings, and normalizes titles", async () => {
        const entries = Array.from({ length: MAX_TOC_HEADINGS + 5 }, (_, index) =>
            entry(`${index}\u0008${"x".repeat(600)}`, null));

        const headings = await readPdfOutline(fakePdf(entries));

        expect(headings).toHaveLength(MAX_TOC_HEADINGS);
        expect(headings[0].title).toBe(`0${"x".repeat(499)}`);
        expect(headings.at(-1)?.title.startsWith(`${MAX_TOC_HEADINGS - 1}x`)).toBe(true);
    });
});

describe("toPdfTocHeadings", () => {
    it("gives each heading the page its own destination or its first descendant leads to", () => {
        expect(toPdfTocHeadings([
            { title: "Own", level: 1, page: 3, dest: [ ref(2) ] },
            { title: "Inherited", level: 1, inheritedPage: 5 },
            { title: "Nowhere", level: 2 }
        ])).toStrictEqual([
            { title: "Own", level: 1, page: 3 },
            { title: "Inherited", level: 1, page: 5 },
            { title: "Nowhere", level: 2 }
        ]);
    });
});

function entry(title: string, dest: PdfOutlineEntry["dest"], items: PdfOutlineEntry[] = []): PdfOutlineEntry {
    return { title, dest, items };
}

/** A page reference as pdf.js gives it, for the page at `pageIndex`. */
function ref(pageIndex: number) {
    return { num: pageIndex + 10, gen: 0 };
}

/** A document of 10 pages with `outline` and the named destinations `destinations`. */
function fakePdf(
    outline: PdfOutlineEntry[] | null, destinations: Record<string, unknown[]> = {}
): PdfOutlineSource {
    return {
        numPages: 10,
        getOutline: async () => outline,
        getDestination: async (name) => destinations[name] ?? null,
        async getPageIndex(target) {
            const { num } = target as { num: number };
            if (num >= 10 && num < 30) {
                return num - 10;
            }
            throw new Error("Invalid page reference.");
        }
    };
}
