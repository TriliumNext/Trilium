import { beforeEach, describe, expect, it, vi } from "vitest";

import { PAGE_HEIGHT, PageLayout, type SheetSpec } from "./ink_document";
import PdfLayer, { fitPage, MAX_PAGE_PIXELS, type PdfPages, toSheetSize } from "./ink_pdf";

describe("PDF layer", () => {
    const URL = "api/attachments/abc/open";
    const OTHER = "api/attachments/def/open";
    const picture = document.createElement("canvas");
    /** The PDF, the page and the length in pixels of each picture asked for. */
    let renders: (string | number)[][];
    /** The sheet that each `drawImage()` call drew a page on, from where it lies. */
    let drawn: number[];
    let busy: boolean;
    let scale: number;
    let layout: PageLayout;
    const getPageTop = (index: number) => layout.getPageTop(index);
    const openPages = (url: string, pageCount: number): PdfPages => ({
        pageCount,
        sizes: Array.from({ length: pageCount }, () => ({ width: 794, height: 1123 })),
        render: async (index, pixels) => {
            renders.push([ url, index, pixels ]);
            const rendered = Object.assign(document.createElement("canvas"), { width: pixels, height: pixels * 9 / 16 });
            return { picture: url === URL && index === 0 ? picture : rendered, width: 960, height: 540 };
        },
        destroy: vi.fn()
    });
    let documents: Record<string, PdfPages>;
    const openPdf = vi.fn();
    const redrawBounds = vi.fn();
    let layer: PdfLayer;
    const ctx = {
        drawImage: (_picture: unknown, _x: number, y: number) => drawn.push(Math.round(y / getPageTop(1)))
    } as unknown as CanvasRenderingContext2D;
    /** A4 sheets with the pages `from` to `to` of the PDF at `url` on them. */
    const sheetsOf = (url: string, from: number, to: number): SheetSpec[] =>
        Array.from({ length: to - from + 1 }, (_, index) => ({ width: 794, height: 1123, source: { url, page: from + index } }));

    /** Draws the sheets `from` to `to`, as the surface does for the part of them on screen. */
    function drawSheets(from: number, to = from) {
        drawn = [];
        layer.draw(ctx, { minX: 0, minY: getPageTop(from) + 1, maxX: 794, maxY: getPageTop(to) + PAGE_HEIGHT }, false);
        return drawn;
    }

    const settle = () => new Promise((resolve) => setTimeout(resolve));

    beforeEach(() => {
        renders = [];
        busy = false;
        scale = 1;
        layout = new PageLayout(sheetsOf(URL, 0, 11));
        documents = { [URL]: openPages(URL, 12), [OTHER]: openPages(OTHER, 2) };
        openPdf.mockReset().mockImplementation(async (url: string) => documents[url]);
        redrawBounds.mockReset();
        layer = new PdfLayer({ openPdf, redrawBounds, getLayout: () => layout, getScale: () => scale, isBusy: () => busy });
    });

    it("gives a sheet the size of its page as printed, which the page then fills", () => {
        // A slide of 960 by 540 points, and A4 to a tenth of a unit.
        expect(toSheetSize({ width: 960, height: 540 })).toEqual({ width: 1280, height: 720 });
        expect(toSheetSize({ width: 595.28, height: 841.89 })).toEqual({ width: 793.7, height: 1122.5 });
        // A page larger than a saved sheet can be shrinks to fit, in its shape; a sliver widens.
        expect(toSheetSize({ width: 30000, height: 15000 })).toEqual({ width: 20000, height: 10000 });
        expect(toSheetSize({ width: 1, height: 600 })).toEqual({ width: 16, height: 800 });
        const slides = new PageLayout([ { width: 1280, height: 720 } ]);
        expect(fitPage(960, 540, slides.getSheet(0))).toEqual({ x: -243, y: 0, width: 1280, height: 720 });

        // On a sheet of another shape, a slide leaves the lower part free, and a narrow page its sides.
        expect(fitPage(960, 540, layout.getSheet(0))).toEqual({ x: 0, y: 0, width: 794, height: 446.625 });
        expect(fitPage(400, 1123, layout.getSheet(2))).toEqual({ x: 197, y: getPageTop(2), width: 400, height: 1123 });
    });

    it("opens a PDF when one of its pages comes into view, and draws each page on its sheet", async () => {
        expect(drawSheets(0, 1)).toEqual([]);
        expect(openPdf).toHaveBeenCalledExactlyOnceWith(URL);
        await settle();
        expect(renders).toHaveLength(2);
        expect(renders).toEqual(expect.arrayContaining([ [ URL, 0, PAGE_HEIGHT ], [ URL, 1, PAGE_HEIGHT ] ]));
        expect(redrawBounds).toHaveBeenCalledWith({ minX: 0, minY: 0, maxX: 794, maxY: 446.625 });
        expect(layer.getFirstPage()).toEqual({ picture, rect: fitPage(960, 540, layout.getSheet(0)) });

        // The pictures are kept, and the PDF is not opened again.
        expect(drawSheets(0, 1)).toEqual([ 0, 1 ]);
        await settle();
        expect(renders).toHaveLength(2);
        expect(openPdf).toHaveBeenCalledOnce();
        expect(await layer.open(URL)).toBe(documents[URL]);

        // A page follows its sheet: with the sheets in another order, each shows the page it names,
        // and a sheet that names none, or a page that the PDF has not, stays empty.
        layout = new PageLayout([
            ...sheetsOf(URL, 1, 1), { width: 794, height: 1123 }, ...sheetsOf(URL, 0, 0), ...sheetsOf(URL, 40, 40)
        ]);
        expect(drawSheets(0, 3)).toEqual([ 0, 2 ]);
        expect(layer.getFirstPage()?.picture).not.toBe(picture);
        await settle();
        expect(renders).toHaveLength(2);
    });

    it("draws the pages of several PDFs, and drops those of a PDF that is closed", async () => {
        layout = new PageLayout([ ...sheetsOf(URL, 0, 1), ...sheetsOf(OTHER, 0, 1) ]);
        drawSheets(0, 3);
        await settle();
        expect(openPdf.mock.calls.map(([ url ]) => url).sort()).toEqual([ URL, OTHER ]);
        expect(renders.map(([ url, index ]) => `${url}#${index}`).sort())
            .toEqual([ `${URL}#0`, `${URL}#1`, `${OTHER}#0`, `${OTHER}#1` ]);
        expect(drawSheets(0, 3)).toEqual([ 0, 1, 2, 3 ]);

        layer.close(URL);
        expect(documents[URL].destroy).toHaveBeenCalledOnce();
        expect(documents[OTHER].destroy).not.toHaveBeenCalled();
        layout = new PageLayout([ { width: 794, height: 1123 }, { width: 794, height: 1123 }, ...sheetsOf(OTHER, 0, 1) ]);
        expect(drawSheets(0, 3)).toEqual([ 2, 3 ]);

        // A note just loaded keeps open the PDFs it shares with the one before.
        layer.retain([ URL ]);
        expect(documents[OTHER].destroy).toHaveBeenCalledOnce();
        expect(drawSheets(0, 3)).toEqual([]);
    });

    it("draws the page of the first sheet for the thumbnail, whatever is in view", async () => {
        expect(layer.getFirstPage()).toBeUndefined();
        await layer.prepareFirstPage();
        expect(renders).toEqual([ [ URL, 0, PAGE_HEIGHT ] ]);
        expect(layer.getFirstPage()?.picture).toBe(picture);
        await layer.prepareFirstPage();
        expect(renders).toHaveLength(1);

        layout = new PageLayout([ { width: 794, height: 1123 }, ...sheetsOf(URL, 0, 0) ]);
        await layer.prepareFirstPage();
        expect(layer.getFirstPage()).toBeUndefined();
        expect(renders).toHaveLength(1);
    });

    it("draws no page while a gesture is in progress, and catches up when it ends", async () => {
        await layer.prepareFirstPage();
        busy = true;
        drawSheets(1, 2);
        await settle();
        expect(renders).toHaveLength(1);

        busy = false;
        layer.resume();
        await settle();
        // The page asked for last comes first.
        expect(renders.map(([ , index ]) => index)).toEqual([ 0, 2, 1 ]);
    });

    it("draws a page again for a closer view, up to a size, and keeps the pages near the view", async () => {
        await layer.prepareFirstPage();
        scale = 1.2;
        drawSheets(0);
        await settle();
        expect(renders).toHaveLength(1);

        scale = 8;
        expect(drawSheets(0)).toEqual([ 0 ]);
        await settle();
        expect(renders[1]).toEqual([ URL, 0, MAX_PAGE_PIXELS ]);
        drawSheets(0);
        await settle();
        expect(renders).toHaveLength(2);

        // Paging through the document keeps the first page and the nearest ones that fit the
        // memory for pictures: six slides at the largest size.
        for (let index = 1; index < 12; index++) {
            drawSheets(index);
            await settle();
        }
        expect(drawSheets(0, 11)).toEqual([ 0, 6, 7, 8, 9, 10, 11 ]);

        // Zoomed far out, the pictures are small, and every page on screen keeps its own.
        scale = 0.25;
        layer.close(URL);
        drawSheets(0, 11);
        await settle();
        expect(drawSheets(0, 11)).toEqual([ 0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11 ]);
    });

    it("leaves the sheets empty for a PDF that cannot be read, and does not open it again", async () => {
        openPdf.mockRejectedValue(new Error("not a PDF"));
        expect(await layer.open(URL)).toBeUndefined();
        drawSheets(0);
        await settle();
        expect(drawSheets(0)).toEqual([]);
        expect(openPdf).toHaveBeenCalledOnce();
    });
});
