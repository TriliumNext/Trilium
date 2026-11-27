import { describe, expect, it } from "vitest";

import { PageLayout } from "./ink_document";
import { drawPaper, type PaperScene } from "./ink_paper";

describe("ink paper", () => {
    it("lays the paper out on a page", () => {
        // The page spans 53 to 847 across and starts at the top of a view 900 by 300.
        const paperLines = (paper: PaperScene["paper"], pages = new PageLayout()) => {
            const { ctx, fillRects } = recordingContext();
            drawPaper(ctx, 0, 0, 900, 300, {
                paper, layout: "pages", pages, pageCount: 1, tx: 53, ty: 0, scale: 1, dpr: 1,
                textColor: "rgb(0, 0, 0)", backgroundColor: "rgb(255, 255, 255)", deskColor: undefined
            });
            return fillRects;
        };
        const inPaperColor = (paper: PaperScene["paper"], fillStyle: string, alpha: number, pages?: PageLayout) =>
            paperLines(paper, pages).filter((rect) => rect.fillStyle === fillStyle && rect.alpha === alpha);

        // Squares of 32 from the top left corner, in a pale blue: #cce6ff over white, as in RNote.
        // No line lies along an edge.
        const grid = inPaperColor("grid", "rgb(0, 130, 255)", 0.2);
        const columns = [ ...new Set(grid.filter(({ width }) => width === 1).map(({ x }) => x)) ];
        expect(columns).toEqual(Array.from({ length: 24 }, (_, index) => 53 + (index + 1) * 32));
        const rows = grid.filter(({ height }) => height === 1);
        expect(rows.map(({ y }) => y)).toEqual([ 32, 64, 96, 128, 160, 192, 224, 256, 288 ]);
        // The lines run from edge to edge.
        for (const { x, width } of rows) expect([ x, width ]).toEqual([ 53, 794 ]);

        // Dots on 5 mm squares, 42 across the width of A4, as in Xournal++.
        const dots = inPaperColor("dots", "rgb(0, 0, 0)", 0.16);
        const step = 794 / 42;
        expect([ ...new Set(dots.map(({ x }) => x)) ])
            .toEqual(Array.from({ length: 41 }, (_, index) => Math.round(53 + (index + 1) * step)));

        // Rules 32 apart, below a header of 80 pt, as in Xournal++.
        const rules = inPaperColor("ruled", "rgb(0, 0, 0)", 0.16).map(({ y }) => y);
        expect([ ...new Set(rules) ]).toEqual([ 107, 139, 171, 203, 235, 267, 299 ]);

        // A sheet of 400 by 250 is centered on the middle of an A4 sheet, so spans 250 to 650
        // across, and the paper's lines stay inside it and leave its footer.
        const small = new PageLayout([ { width: 400, height: 250 } ]);
        const sheets = paperLines("blank", small).filter(({ width }) => width === 400);
        expect(sheets.map(({ x, y, height }) => [ x, y, height ])).toEqual([ [ 250, 0, 250 ] ]);
        const smallRules = inPaperColor("ruled", "rgb(0, 0, 0)", 0.16, small);
        expect([ ...new Set(smallRules.map(({ y }) => y)) ]).toEqual([ 107, 139 ]);
        for (const { x, width } of smallRules) expect([ x, width ]).toEqual([ 250, 400 ]);
        const smallGrid = inPaperColor("grid", "rgb(0, 130, 255)", 0.2, small).filter(({ width }) => width === 1);
        expect(Math.max(...smallGrid.map(({ x }) => x))).toBe(250 + 12 * 32);
    });
});

/** A 2D context that records its `fillRect()` calls and does nothing else. */
function recordingContext() {
    const fillRects: { x: number, y: number, width: number, height: number, alpha: number, fillStyle: string }[] = [];
    const target: Record<string | symbol, unknown> = { globalAlpha: 1, fillStyle: "" };
    target.fillRect = (x: number, y: number, width: number, height: number) => {
        fillRects.push({
            x, y, width, height, alpha: target.globalAlpha as number, fillStyle: target.fillStyle as string
        });
    };
    const ctx = new Proxy(target, {
        get: (object, key) => (key in object ? object[key] : (object[key] = () => {}))
    }) as unknown as CanvasRenderingContext2D;
    return { ctx, fillRects };
}
