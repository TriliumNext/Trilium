import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AUTO_COLOR, createStroke, getPageTop, type Stroke, StrokeIndex } from "./ink_document";
import InkThumbnail from "./ink_thumbnail";

describe("ink thumbnail", () => {
    /** The color of each stroke filled on the thumbnail. */
    let fills: string[];
    let strokes: Set<Stroke>;
    let index: StrokeIndex;
    let thumbnail: InkThumbnail;

    beforeEach(() => {
        fills = [];
        vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(() => {
            const ctx = { fillStyle: "", globalAlpha: 1, setTransform() {}, fill: () => fills.push(ctx.fillStyle) };
            return ctx as unknown as CanvasRenderingContext2D;
        });
        vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation((callback) => {
            callback(new Blob([ "png" ], { type: "image/png" }));
        });
        vi.stubGlobal("Path2D", class { moveTo() {} quadraticCurveTo() {} closePath() {} });
        strokes = new Set();
        index = new StrokeIndex();
        thumbnail = new InkThumbnail({ getAll: () => strokes, query: (bounds) => index.query(bounds) });
        thumbnail.reset("pages");
    });

    afterEach(() => {
        vi.restoreAllMocks();
        vi.unstubAllGlobals();
    });

    function draw(x: number, y: number, color = AUTO_COLOR) {
        const stroke = createStroke({
            tool: "pen", color, size: 3, simulatePressure: false, order: strokes.size,
            points: [ x, y, 0.5, x + 10, y + 10, 0.5, x + 20, y, 0.5 ]
        });
        strokes.add(stroke);
        index.add(stroke);
        thumbnail.add(stroke);
        return stroke;
    }

    it("shows the first page, drawing each new stroke onto it, until it is saved", async () => {
        expect(await thumbnail.export()).toBeUndefined();

        draw(100, getPageTop(1) + 100);
        expect(await thumbnail.export()).toBeUndefined();

        draw(100, 100, "#ff0000");
        const first = await thumbnail.export();
        expect(first?.svg).toMatch(/^<svg [^>]*width="600" height="849"/);
        expect(first?.svg).toContain("@media (prefers-color-scheme: dark) { svg { filter: invert(93%) hue-rotate(180deg); } }");
        expect(first?.svg).toContain(`<image href="data:image/png;base64,${btoa("png")}"`);
        expect(fills).toEqual([ "#ff0000" ]);

        // A stroke drawn while that picture was saving keeps it changed.
        draw(200, 200);
        expect(fills).toEqual([ "#ff0000", "#000" ]);
        thumbnail.markSaved(first?.version ?? -1);
        const second = await thumbnail.export();
        expect(second).toBeDefined();
        thumbnail.markSaved(second?.version ?? -1);
        thumbnail.markSaved(first?.version ?? -1);
        expect(await thumbnail.export()).toBeUndefined();
        expect(fills).toHaveLength(2);
    });

    it("draws all the strokes again once one is removed", async () => {
        const removed = draw(100, 100);
        draw(200, 200, "#00ff00");
        await thumbnail.export();
        fills = [];

        strokes.delete(removed);
        index.remove(removed);
        thumbnail.markChanged(removed);
        expect(fills).toEqual([]);
        await thumbnail.export();
        expect(fills).toEqual([ "#00ff00" ]);
    });

    it("fits the strokes of a canvas without bounds, and grows past a stroke outside them", async () => {
        thumbnail.setLayout("infinite");
        expect((await thumbnail.export())?.svg).toContain(`width="0" height="0"`);

        draw(0, 0);
        expect((await thumbnail.export())?.svg).toMatch(/^<svg [^>]*width="58" height="48"/);
        fills = [];

        draw(5, 5);
        expect(fills).toEqual([ "#000" ]);
        draw(1000, 0);
        expect(fills).toEqual([ "#000" ]);
        expect((await thumbnail.export())?.svg).toMatch(/^<svg [^>]*width="600" height="31"/);
        expect(fills).toHaveLength(4);
    });
});
