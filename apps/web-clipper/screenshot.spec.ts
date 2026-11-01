import { afterEach, describe, expect, it, vi } from "vitest";

import { MAX_PART_HEIGHT, ScreenshotStitcher } from "./screenshot";

describe("ScreenshotStitcher", () => {
    afterEach(() => {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    it("draws each capture where it was taken, scaled to device pixels", async () => {
        stubImages({ naturalWidth: 1600, naturalHeight: 1000 });
        const canvas = stubCanvas();
        const stitcher = new ScreenshotStitcher({ pageHeight: 1200, devicePixelRatio: 2 });

        for (const y of [ 0, 500, 700 ]) {
            await stitcher.add({ dataUrl: `slice-${y}`, y });
        }

        expect(stitcher.finish()).toEqual([ "part-0" ]);
        expect(canvas.sizes()).toEqual([ [ 1600, 2400 ] ]);
        expect(canvas.events).toEqual([
            "draw 0: slice-0 0+1000 at 0", "draw 0: slice-500 0+1000 at 1000", "draw 0: slice-700 600+400 at 2000",
            "encode 0"
        ]);
    });

    it("keeps the rows an earlier capture drew, such as a fixed header only the first one shows", async () => {
        stubImages({ naturalWidth: 800, naturalHeight: 500 });
        const canvas = stubCanvas();
        const stitcher = new ScreenshotStitcher({ pageHeight: 520, devicePixelRatio: 1 });

        await stitcher.add({ dataUrl: "header", y: 0 });
        await stitcher.add({ dataUrl: "no-header", y: 20 });
        stitcher.finish();

        expect(canvas.events).toEqual([
            "draw 0: header 0+500 at 0", "draw 0: no-header 480+20 at 500", "encode 0"
        ]);
    });

    it("places captures by the pixel ratio, which a capture's rounded height would get wrong", async () => {
        // A 701 px viewport at 150% is 1,051.5 device pixels, captured as 1,052 rows.
        stubImages({ naturalWidth: 600, naturalHeight: 1052 });
        const canvas = stubCanvas();
        const stitcher = new ScreenshotStitcher({ pageHeight: 2200, devicePixelRatio: 1.5 });

        for (const y of [ 0, 701, 1402, 1499 ]) {
            await stitcher.add({ dataUrl: `slice-${y}`, y });
        }
        stitcher.finish();

        expect(canvas.sizes()).toEqual([ [ 600, 3300 ] ]);
        expect(canvas.events).toEqual([
            "draw 0: slice-0 0+1052 at 0", "draw 0: slice-701 0+1052 at 1052", "draw 0: slice-1402 1+1051 at 2104",
            "draw 0: slice-1499 906+145 at 3155", "encode 0"
        ]);
    });

    it("splits a long page into images, encoding each before the next is drawn", async () => {
        stubImages({ naturalWidth: 900, naturalHeight: 3000 });
        const canvas = stubCanvas();
        const stitcher = new ScreenshotStitcher({ pageHeight: 6000, devicePixelRatio: 3 });

        for (const y of [ 0, 1000, 2000, 3000, 4000, 5000 ]) {
            await stitcher.add({ dataUrl: `slice-${y}`, y });
        }

        expect(stitcher.finish()).toEqual([ "part-0", "part-1", "part-2" ]);
        expect(canvas.sizes()).toEqual([ [ 900, MAX_PART_HEIGHT ], [ 900, MAX_PART_HEIGHT ], [ 900, 1616 ] ]);
        expect(canvas.events).toEqual([
            "draw 0: slice-0 0+3000 at 0", "draw 0: slice-1000 0+3000 at 3000", "draw 0: slice-2000 0+2192 at 6000",
            "encode 0",
            "draw 1: slice-2000 2192+808 at 0", "draw 1: slice-3000 0+3000 at 808",
            "draw 1: slice-4000 0+3000 at 3808", "draw 1: slice-5000 0+1384 at 6808",
            "encode 1",
            "draw 2: slice-5000 1384+1616 at 0",
            "encode 2"
        ]);
    });

    it("leaves out the part of the last capture that reaches back into an image already encoded", async () => {
        stubImages({ naturalWidth: 100, naturalHeight: 1500 });
        const canvas = stubCanvas();
        const stitcher = new ScreenshotStitcher({ pageHeight: 9400, devicePixelRatio: 1 });

        for (const y of [ 0, 1500, 3000, 4500, 6000, 7500, 7900 ]) {
            await stitcher.add({ dataUrl: `slice-${y}`, y });
        }
        stitcher.finish();

        expect(canvas.events.slice(-5)).toEqual([
            "draw 0: slice-7500 0+692 at 7500", "encode 0", "draw 1: slice-7500 692+808 at 0",
            "draw 1: slice-7900 1100+400 at 808", "encode 1"
        ]);
    });

    it("ignores what a capture shows below the height it was given", async () => {
        stubImages({ naturalWidth: 100, naturalHeight: 1000 });
        const canvas = stubCanvas();
        const stitcher = new ScreenshotStitcher({ pageHeight: MAX_PART_HEIGHT, devicePixelRatio: 1 });

        await stitcher.add({ dataUrl: "slice", y: 7500 });

        expect(stitcher.finish()).toEqual([ "part-0" ]);
        expect(canvas.sizes()).toEqual([ [ 100, MAX_PART_HEIGHT ] ]);
        expect(canvas.events).toEqual([ "draw 0: slice 0+692 at 7500", "encode 0" ]);
    });

    it("crops the last image to the rows captured when the page stops scrolling early", async () => {
        stubImages({ naturalWidth: 100, naturalHeight: 500 });
        const canvas = stubCanvas();
        const stitcher = new ScreenshotStitcher({ pageHeight: 5000, devicePixelRatio: 1 });

        await stitcher.add({ dataUrl: "top", y: 0 });
        await stitcher.add({ dataUrl: "next", y: 500 });

        expect(stitcher.finish()).toEqual([ "part-1" ]);
        expect(canvas.sizes()).toEqual([ [ 100, 5000 ], [ 100, 1000 ] ]);
        expect(canvas.events).toEqual([
            "draw 0: top 0+500 at 0", "draw 0: next 0+500 at 500", "draw 1: canvas 0 0+1000 at 0", "encode 1"
        ]);
    });

    it("fails without captures, without a canvas, or on a capture that cannot be read", async () => {
        const request = { pageHeight: 100, devicePixelRatio: 1 };
        stubImages({ naturalWidth: 100, naturalHeight: 100 });

        expect(() => new ScreenshotStitcher(request).finish()).toThrow("There is no screenshot to stitch.");

        vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
        await expect(new ScreenshotStitcher(request).add({ dataUrl: "a", y: 0 }))
            .rejects.toThrow("The screenshot could not be drawn.");

        stubImages({ naturalWidth: 100, naturalHeight: 100, fail: true });
        await expect(new ScreenshotStitcher(request).add({ dataUrl: "a", y: 0 }))
            .rejects.toThrow("A part of the screenshot could not be read.");
    });
});

/** Replaces `Image` with one that loads at the given size, or fails to load. */
function stubImages({ naturalWidth, naturalHeight, fail = false }: {
    naturalWidth: number, naturalHeight: number, fail?: boolean
}) {
    vi.stubGlobal("Image", class {

        naturalWidth = naturalWidth;
        naturalHeight = naturalHeight;
        onload?: () => void;
        onerror?: () => void;

        set src(value: string) {
            Object.defineProperty(this, "src", { value });
            setTimeout(() => (fail ? this.onerror?.() : this.onload?.()));
        }

    });
}

/** Records, in order, which rows of which capture are drawn where, and when each canvas is encoded. */
function stubCanvas() {
    const canvases: HTMLCanvasElement[] = [];
    const events: string[] = [];
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(function (this: HTMLCanvasElement) {
        const index = canvases.push(this) - 1;
        return {
            drawImage: (
                image: { src: string } | HTMLCanvasElement,
                _sx: number, sy: number, _sw: number, sh: number, _dx: number, dy: number
            ) => {
                const source = "src" in image ? image.src : `canvas ${canvases.indexOf(image)}`;
                events.push(`draw ${index}: ${source} ${sy}+${sh} at ${dy}`);
            }
        } as unknown as CanvasRenderingContext2D;
    });
    vi.spyOn(HTMLCanvasElement.prototype, "toDataURL").mockImplementation(function (this: HTMLCanvasElement) {
        const index = canvases.indexOf(this);
        events.push(`encode ${index}`);
        return `part-${index}`;
    });
    return { events, sizes: () => canvases.map((canvas) => [ canvas.width, canvas.height ]) };
}
