import { MAX_TOC_DEPTH, type TocCache, type TocHeading } from "@triliumnext/commons";
import { describe, expect, it } from "vitest";

import type { TocFormat } from "../toc/index.js";
import { docxTocFormat } from "../toc/office.js";
import pdfTocFormat from "../toc/pdf.js";
import { toTargets } from "./toc.js";

describe("toTargets", () => {
    it("leaves a heading without a link out, so its targets nest under the target before it",
        () => {
        const format = {
            ...docxTocFormat,
            getLinkParams: ({ id }: TocHeading) =>
                (id.startsWith("x") ? undefined : { heading: id })
        } as TocFormat;

        const targets = toTargets(cacheOf([
            [ "a", 1 ], [ "x1", 2 ], [ "b", 3 ], [ "c", 4 ], [ "x2", 2 ], [ "x3", 3 ], [ "d", 4 ],
            [ "e", 2 ], [ "f", 1 ], [ "x4", 1 ], [ "g", 2 ]
        ]), format);

        expect(targets.map(({ params, level }) => [ params?.heading, level ])).toStrictEqual([
            [ "a", 1 ], [ "b", 2 ], [ "c", 3 ], [ "d", 3 ], [ "e", 2 ], [ "f", 1 ], [ "g", 2 ]
        ]);
    });

    it("keeps the levels of PDF and DOCX targets, capped at the deepest level shown", () => {
        const levels = [ 1, 2, 3, 2, 1, 2 ];
        const deep = Array.from({ length: MAX_TOC_DEPTH + 2 }, (_, index) => index + 1);
        const docx = toTargets(cacheOf([ ...levels, ...deep ].map((level, index) =>
            [ `h${index}`, level ])), docxTocFormat);
        expect(docx.map(({ level }) => level)).toStrictEqual([
            ...levels, ...deep.map((level) => Math.min(level, MAX_TOC_DEPTH))
        ]);

        // A PDF heading without a page has no link.
        const pdfCache = cacheOf([ [ "p", 1 ], [ "q", 2 ], [ "r", 1 ] ]);
        pdfCache.headings[0] = { ...pdfCache.headings[0], page: 3 } as TocHeading;
        pdfCache.headings[2] = { ...pdfCache.headings[2], page: 5 } as TocHeading;
        expect(toTargets(pdfCache, pdfTocFormat as TocFormat)
            .map(({ title, level }) => [ title, level ])).toStrictEqual([ [ "p", 1 ], [ "r", 1 ] ]);
    });
});

function cacheOf(headings: (readonly [ string, number ])[]): TocCache {
    return {
        version: 1,
        targetBlobHash: "blob",
        headings: headings.map(([ id, level ]) => ({ id, title: id, level }))
    };
}
