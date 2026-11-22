import { describe, expect, it } from "vitest";

import {
    findActivePdfHeading, type PdfOutlineEntry, type PdfOutlineSource, type PdfTocHeading,
    readPdfOutline, toPdfTocHeadings
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

        expect((await readPdfOutline(pdf)).headings).toStrictEqual([
            { title: "Chapter 1", level: 1, page: 1, dest: xyz, left: 72, top: 700 },
            { title: "Section <b>1.1</b> & more", level: 2, page: 1, dest: [ ref(0), { name: "Fit" } ] },
            {
                title: "Named", level: 1, page: 2, dest: [ ref(1), { name: "XYZ" }, 0, 0, null ],
                left: 0, top: 0
            },
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

    it("reads where each explicit destination starts on its page", async () => {
        const { headings } = await readPdfOutline(fakePdf([
            entry("XYZ", [ ref(0), { name: "XYZ" }, 72, 700, 1.5 ]),
            entry("XYZ without top", [ ref(0), { name: "XYZ" }, 72, null, null ]),
            entry("FitH", [ ref(1), { name: "FitH" }, 500 ]),
            entry("FitBH", [ ref(1), { name: "FitBH" }, 400 ]),
            entry("FitV", [ ref(1), { name: "FitV" }, 30 ]),
            entry("FitBV", [ ref(1), { name: "FitBV" }, 40 ]),
            entry("FitR", [ ref(2), { name: "FitR" }, 10, 20, 300, 600 ]),
            entry("Fit", [ ref(2), { name: "Fit" } ]),
            entry("Not finite", [ ref(2), { name: "XYZ" }, Infinity, Number.NaN, null ]),
            entry("Inherits", null, [ entry("Child", [ ref(3), { name: "XYZ" }, 5, 6, null ]) ])
        ]));

        expect(headings.map(({ title, left, top }) => [ title, left, top ])).toStrictEqual([
            [ "XYZ", 72, 700 ], [ "XYZ without top", 72, undefined ],
            [ "FitH", undefined, 500 ], [ "FitBH", undefined, 400 ],
            [ "FitV", 30, undefined ], [ "FitBV", 40, undefined ], [ "FitR", 10, 600 ],
            [ "Fit", undefined, undefined ], [ "Not finite", undefined, undefined ],
            [ "Inherits", undefined, undefined ], [ "Child", 5, 6 ]
        ]);
        expect(toPdfTocHeadings(headings).slice(-2)).toStrictEqual([
            { title: "Inherits", level: 1, page: 4 },
            { title: "Child", level: 2, page: 4, left: 5, top: 6 }
        ]);
    });

    it("reads a document without an outline, and entries without a title or children", async () => {
        expect(await readPdfOutline(fakePdf(null))).toStrictEqual({ headings: [], isCut: false });

        const odd = { title: undefined, dest: null } as unknown as PdfOutlineEntry;
        expect((await readPdfOutline(fakePdf([ odd ]))).headings)
            .toStrictEqual([ { title: "", level: 1 } ]);
    });

    it("gives a heading without a page the page of the first heading below it that has one", async () => {
        const { headings } = await readPdfOutline(fakePdf([
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

        const { headings } = await readPdfOutline(fakePdf([ deepest ]));

        expect(headings).toHaveLength(33);
        expect(headings[31]).toMatchObject({ title: "Level 32", level: 32, inheritedPage: 4 });
        expect(headings[32]).toMatchObject({ title: "Level 33", level: 33, page: 4 });
    });

    it("keeps at most the limit of headings, reports the cut, and normalizes titles", async () => {
        const entries = Array.from({ length: MAX_TOC_HEADINGS + 5 }, (_, index) =>
            entry(`${index}\u0008${"x".repeat(600)}`, null));

        const { headings, isCut } = await readPdfOutline(fakePdf(entries));

        expect(isCut).toBe(true);
        expect(headings).toHaveLength(MAX_TOC_HEADINGS);
        expect(headings[0].title).toBe(`0${"x".repeat(499)}`);
        expect(headings.at(-1)?.title.startsWith(`${MAX_TOC_HEADINGS - 1}x`)).toBe(true);
    });

    it("reports no cut for an outline of exactly the limit, nested or not", async () => {
        const flat = Array.from({ length: MAX_TOC_HEADINGS },
            (_, index) => entry(`${index}`, null));
        const nested = [ entry("Parent", null, flat.slice(1)) ];
        // An entry past the limit is a cut, whatever its title.
        const past = [ ...flat, { title: undefined, dest: null } as unknown as PdfOutlineEntry ];

        expect((await readPdfOutline(fakePdf(flat))).isCut).toBe(false);
        expect((await readPdfOutline(fakePdf(nested))).isCut).toBe(false);
        expect((await readPdfOutline(fakePdf(past))).isCut).toBe(true);
    });
});

describe("toPdfTocHeadings", () => {
    it("gives each heading the page its own destination or its first descendant leads to", () => {
        expect(toPdfTocHeadings([
            { title: "Own", level: 1, page: 3, dest: [ ref(2) ], left: 10, top: 20 },
            { title: "Inherited", level: 1, inheritedPage: 5 },
            { title: "Nowhere", level: 2 }
        ])).toStrictEqual([
            { title: "Own", level: 1, page: 3, left: 10, top: 20 },
            { title: "Inherited", level: 1, page: 5 },
            { title: "Nowhere", level: 2 }
        ]);
    });
});

describe("findActivePdfHeading", () => {
    it("takes the nearest heading at or above the reading point of an upright page", () => {
        const headings = [ at("a", 1, 0, 700), at("b", 1, 0, 400), at("c", 2, 0, 700) ];

        expect(find(headings, 1, 300, 500)).toBe("a");
        expect(find(headings, 1, 300, 400)).toBe("b");
        // A reading line in the gap below page 1 is clamped to its bottom.
        expect(find(headings, 1, 300, 0)).toBe("b");
        expect(find(headings, 2, 300, 750)).toBe("b");
        expect(find(headings, 1, 300, 750)).toBeNull();
    });

    it("compares along the PDF axis that runs down the screen at each rotation", () => {
        const sameTop = [ at("near", 1, 100, 500), at("far", 1, 400, 500) ];
        expect(find(sameTop, 1, 200, 0, [ 90 ])).toBe("near");
        expect(find(sameTop, 1, 450, 0, [ 90 ])).toBe("far");
        expect(find(sameTop, 1, 200, 0, [ 270 ])).toBe("far");
        expect(find(sameTop, 1, 50, 0, [ 270 ])).toBe("near");

        const stacked = [ at("high", 1, 0, 700), at("low", 1, 0, 400) ];
        expect(find(stacked, 1, 0, 500)).toBe("high");
        expect(find(stacked, 1, 0, 500, [ 180 ])).toBe("low");
        expect(find(stacked, 1, 0, 750, [ 180 ])).toBe("high");
    });

    it("orders an earlier page by its own rotation", () => {
        const headings = [ at("p1a", 1, 0, 100), at("p1b", 1, 0, 600), at("p2", 2, 0, 700) ];

        expect(find(headings, 2, 0, 750, [ 180, 0 ])).toBe("p1b");
        expect(find(headings, 2, 0, 750, [ 0, 0 ])).toBe("p1a");
    });

    it("starts a heading without the anchor of the axis at the top of its page", () => {
        const headings = [ at("noLeft", 1, undefined, 500), at("withLeft", 1, 100, 500) ];

        expect(find(headings, 1, 50, 0, [ 90 ])).toBe("noLeft");
        expect(find(headings, 1, 200, 0, [ 270 ])).toBe("noLeft");
        const noTop = [ at("noTop", 1, 100, undefined), at("withTop", 1, 100, 500) ];
        expect(find(noTop, 1, 0, 400, [ 180 ])).toBe("noTop");
        expect(find([ at("noAnchor", 2) ], 2, 0, 790)).toBe("noAnchor");
    });

    it("takes the last of several at one place, and compares places, not the outline's order",
        () => {
        expect(find([ at("first", 1, 0, 500), at("second", 1, 0, 500) ], 1, 0, 400)).toBe("second");

        const outOfOrder = [ at("late", 3, 0, 700), at("early", 1, 0, 700) ];
        expect(find(outOfOrder, 2, 0, 400)).toBe("early");
        expect(find(outOfOrder, 3, 0, 600)).toBe("late");
        expect(find([ at("pageless", undefined), at("early", 1, 0, 700) ], 1, 0, 10)).toBe("early");
        expect(find([ at("pageless", undefined) ], 5, 0, 0)).toBeNull();
    });

    /** A heading `id` on `page`, starting at `left` and `top` when given. */
    function at(id: string, page?: number, left?: number, top?: number): PdfTocHeading {
        return {
            id, title: id, level: 1,
            ...(page === undefined ? {} : { page }),
            ...(left === undefined ? {} : { left }),
            ...(top === undefined ? {} : { top })
        };
    }

    function find(
        headings: PdfTocHeading[], pageNumber: number, x: number, y: number,
        rotations: number[] = []
    ) {
        return findActivePdfHeading(headings, { pageNumber, x, y }, rotations);
    }
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
