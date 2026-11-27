import { beforeEach, describe, expect, it, vi } from "vitest";

import { getPageTop, PAGE_HEIGHT } from "./ink_document";
import PdfLayer, { fitPage, MAX_PAGE_PIXELS, type PdfPages } from "./ink_pdf";

describe("PDF layer", () => {
    const URL = "api/attachments/abc/open";
    const picture = document.createElement("canvas");
    /** The page and the length in pixels of each picture asked of the PDF. */
    let renders: number[][];
    /** The page that each `drawImage()` call drew, from where it lies. */
    let drawn: number[];
    let busy: boolean;
    let scale: number;
    const pages: PdfPages = {
        pageCount: 12,
        render: async (index, pixels) => {
            renders.push([ index, pixels ]);
            return { picture, width: 960, height: 540 };
        },
        destroy: vi.fn()
    };
    const openPdf = vi.fn();
    const redrawBounds = vi.fn();
    const onOpen = vi.fn();
    let layer: PdfLayer;
    const ctx = {
        drawImage: (_picture: unknown, _x: number, y: number) => drawn.push(Math.round(y / getPageTop(1)))
    } as unknown as CanvasRenderingContext2D;

    /** Draws the sheets of the pages `from` to `to`, as the surface does for the part of them on screen. */
    function drawPages(from: number, to = from) {
        drawn = [];
        layer.draw(ctx, { minX: 0, minY: getPageTop(from) + 1, maxX: 794, maxY: getPageTop(to) + PAGE_HEIGHT }, false);
        return drawn;
    }

    const settle = () => new Promise((resolve) => setTimeout(resolve));

    beforeEach(() => {
        renders = [];
        busy = false;
        scale = 1;
        vi.mocked(pages.destroy).mockClear();
        openPdf.mockReset().mockResolvedValue(pages);
        redrawBounds.mockReset();
        onOpen.mockReset();
        layer = new PdfLayer({ openPdf, redrawBounds, getScale: () => scale, isBusy: () => busy, onOpen });
    });

    it("fits a page to the top of its sheet, across its width or down its height", () => {
        // A slide leaves the lower part of the sheet free, and a narrow page its sides.
        expect(fitPage(960, 540, 0)).toEqual({ x: 0, y: 0, width: 794, height: 446.625 });
        expect(fitPage(400, 1123, 2)).toEqual({ x: 197, y: getPageTop(2), width: 400, height: 1123 });
    });

    it("opens the PDF and draws its first page at once, then each page when it comes into view", async () => {
        expect(drawPages(0)).toEqual([]);
        layer.set(URL);
        layer.set(URL);
        await layer.whenReady();
        expect(openPdf).toHaveBeenCalledExactlyOnceWith(URL);
        expect(onOpen).toHaveBeenCalledOnce();
        expect(layer.pageCount).toBe(12);
        expect(renders).toEqual([ [ 0, PAGE_HEIGHT ] ]);
        expect(redrawBounds).toHaveBeenLastCalledWith({ minX: 0, minY: 0, maxX: 794, maxY: 446.625 });
        expect(layer.getFirstPage()?.rect).toEqual(fitPage(960, 540, 0));

        // The second page shows once its picture is there, and the picture is kept.
        expect(drawPages(0, 1)).toEqual([ 0 ]);
        await settle();
        expect(renders).toEqual([ [ 0, PAGE_HEIGHT ], [ 1, PAGE_HEIGHT ] ]);
        expect(drawPages(0, 1)).toEqual([ 0, 1 ]);
        await settle();
        expect(renders).toHaveLength(2);

        // No page is drawn past the last one, and none once the PDF is taken away.
        expect(drawPages(12, 14)).toEqual([]);
        layer.set(undefined);
        expect(pages.destroy).toHaveBeenCalledOnce();
        expect(layer.pageCount).toBe(0);
        expect(drawPages(0, 1)).toEqual([]);
    });

    it("draws no page while a gesture is in progress, and catches up when it ends", async () => {
        layer.set(URL);
        await layer.whenReady();
        busy = true;
        drawPages(1, 2);
        await settle();
        expect(renders).toHaveLength(1);

        busy = false;
        layer.resume();
        await settle();
        // The page asked for last comes first.
        expect(renders.map(([ index ]) => index)).toEqual([ 0, 2, 1 ]);
    });

    it("draws a page again for a closer view, up to a size, and keeps the pages near the view", async () => {
        layer.set(URL);
        await layer.whenReady();
        scale = 1.2;
        drawPages(0);
        await settle();
        expect(renders).toHaveLength(1);

        scale = 8;
        expect(drawPages(0)).toEqual([ 0 ]);
        await settle();
        expect(renders[1]).toEqual([ 0, MAX_PAGE_PIXELS ]);
        drawPages(0);
        await settle();
        expect(renders).toHaveLength(2);

        // Paging through the document keeps the first page and the five nearest the view.
        for (let index = 1; index < 12; index++) {
            drawPages(index);
            await settle();
        }
        expect(drawPages(0, 11)).toEqual([ 0, 7, 8, 9, 10, 11 ]);
    });

    it("leaves the sheets empty for a PDF that cannot be read", async () => {
        openPdf.mockRejectedValue(new Error("not a PDF"));
        layer.set(URL);
        await layer.whenReady();
        expect(layer.pageCount).toBe(0);
        expect(onOpen).not.toHaveBeenCalled();
        expect(drawPages(0)).toEqual([]);
    });
});
