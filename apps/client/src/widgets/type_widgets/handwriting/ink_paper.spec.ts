import { describe, expect, it } from "vitest";

import { drawPaper, type PaperScene } from "./ink_paper";

describe("ink paper", () => {
    it("lays the paper out on a page as Xournal++ does", () => {
        // The page spans 53 to 847 across and starts at the top of a view 900 by 300.
        const paperLines = (paper: PaperScene["paper"]) => {
            const { ctx, fillRects } = recordingContext();
            drawPaper(ctx, 0, 0, 900, 300, {
                paper, layout: "pages", pageCount: 1, tx: 53, ty: 0, scale: 1, dpr: 1,
                textColor: "rgb(0, 0, 0)", backgroundColor: "rgb(255, 255, 255)", deskColor: undefined
            });
            return fillRects.filter(({ alpha }) => alpha === 0.16);
        };

        // 5 mm squares from the top left corner, 42 across the width of A4, with no line along an edge.
        const grid = paperLines("grid");
        const step = 794 / 42;
        const columns = [ ...new Set(grid.filter(({ width }) => width === 1).map(({ x }) => x)) ];
        expect(columns).toEqual(Array.from({ length: 41 }, (_, index) => Math.round(53 + (index + 1) * step)));
        const rows = grid.filter(({ height }) => height === 1);
        expect(rows[0].y).toBe(Math.round(step));
        // The lines run from edge to edge.
        for (const { x, width } of rows) expect([ x, width ]).toEqual([ 53, 794 ]);

        // Rules 32 apart, below a header of 80 pt.
        const rules = paperLines("ruled").map(({ y }) => y);
        expect([ ...new Set(rules) ]).toEqual([ 107, 139, 171, 203, 235, 267, 299 ]);
    });
});

/** A 2D context that records its `fillRect()` calls and does nothing else. */
function recordingContext() {
    const fillRects: { x: number, y: number, width: number, height: number, alpha: number }[] = [];
    const target: Record<string | symbol, unknown> = { globalAlpha: 1 };
    target.fillRect = (x: number, y: number, width: number, height: number) => {
        fillRects.push({ x, y, width, height, alpha: target.globalAlpha as number });
    };
    const ctx = new Proxy(target, {
        get: (object, key) => (key in object ? object[key] : (object[key] = () => {}))
    }) as unknown as CanvasRenderingContext2D;
    return { ctx, fillRects };
}
