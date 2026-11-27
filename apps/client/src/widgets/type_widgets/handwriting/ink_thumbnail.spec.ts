import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
    AUTO_COLOR, type Bounds, createImage, createStroke, type InkImage, PageLayout, type Stroke, StrokeIndex
} from "./ink_document";
import type { MeasuredTextBox } from "./ink_text";

const getPageTop = (index: number) => new PageLayout().getPageTop(index);
import InkThumbnail from "./ink_thumbnail";

describe("ink thumbnail", () => {
    /** The color of each stroke filled on the thumbnail. */
    let fills: string[];
    /** What each call drew, in order: `"picture"` for an image, the color for a stroke and the text of a text box. */
    let drawn: string[];
    let texts: MeasuredTextBox[];
    /** The area that the thumbnail last asked the text boxes of. */
    let askedWithin: Bounds | undefined;
    let strokes: Set<Stroke>;
    let images: InkImage[];
    let firstSheet = { minX: 0, minY: 0, maxX: 794, maxY: 1123 };
    const picture = document.createElement("canvas");
    let background: { picture: HTMLCanvasElement, rect: { x: number, y: number, width: number, height: number } } | undefined;
    let index: StrokeIndex;
    let thumbnail: InkThumbnail;

    beforeEach(() => {
        fills = [];
        drawn = [];
        images = [];
        texts = [];
        vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockImplementation(() => {
            const ctx = {
                fillStyle: "", globalAlpha: 1, font: "", textBaseline: "", setTransform() {},
                fillText: (text: string) => drawn.push(`${text} in ${ctx.fillStyle}`),
                fill: () => {
                    fills.push(ctx.fillStyle);
                    drawn.push(ctx.fillStyle);
                },
                drawImage: () => drawn.push("picture")
            };
            return ctx as unknown as CanvasRenderingContext2D;
        });
        vi.spyOn(HTMLCanvasElement.prototype, "toBlob").mockImplementation((callback) => {
            callback(new Blob([ "png" ], { type: "image/png" }));
        });
        vi.stubGlobal("Path2D", class { moveTo() {} quadraticCurveTo() {} closePath() {} });
        strokes = new Set();
        index = new StrokeIndex();
        thumbnail = new InkThumbnail({
            getAll: () => strokes,
            query: (bounds) => index.query(bounds),
            getFirstSheet: () => firstSheet,
            getImages: () => images,
            getPicture: (image) => (image.url.includes("loaded") ? picture : undefined),
            whenImagesLoaded: async () => {},
            getBackground: () => background,
            getTexts: (within) => {
                askedWithin = within;
                return texts;
            }
        });
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

    it("draws the text of the text boxes over the ink of the first page", async () => {
        const textBox = (text: string, y: number, color?: string): MeasuredTextBox => ({
            bounds: { minX: 100, minY: y, maxX: 400, maxY: y + 40 },
            runs: [ { text, x: 108, y: y + 12, font: "16px serif", ...(color && { color }) } ]
        });
        draw(100, 500, "#ff0000");
        texts = [ textBox("on the page", 100), textBox("colored", 200, "rgb(0, 0, 255)"), textBox("on the next page", getPageTop(1) + 10) ];
        thumbnail.markChanged(texts[0]);
        await thumbnail.export();
        expect(askedWithin).toEqual(firstSheet);
        expect(drawn).toEqual([ "#ff0000", "on the page in #000", "colored in rgb(0, 0, 255)" ]);

        // A stroke clear of the text is drawn onto the picture, and one under a text box has the
        // picture drawn again, so that the text stays over the ink.
        drawn = [];
        draw(500, 800, "#00ff00");
        expect(drawn).toEqual([ "#00ff00" ]);
        drawn = [];
        draw(150, 110, "#0000ff");
        expect(drawn).toEqual([]);
        await thumbnail.export();
        expect(drawn.slice(-2)).toEqual([ "on the page in #000", "colored in rgb(0, 0, 255)" ]);
        expect(drawn).toHaveLength(5);
    });

    it("fits the text boxes of a canvas without bounds, with or without ink", async () => {
        thumbnail.reset("infinite");
        texts = [ { bounds: { minX: 1000, minY: 2000, maxX: 1200, maxY: 2100 }, runs: [ { text: "typed", x: 1008, y: 2012, font: "16px serif" } ] } ];
        thumbnail.markChanged(texts[0]);
        const exported = await thumbnail.export();
        expect(askedWithin).toBeUndefined();
        // The box of 200 by 100 with a margin of 16 on each side.
        expect(exported?.svg).toMatch(/^<svg [^>]*width="232" height="132"/);
        expect(drawn).toEqual([ "typed in #000" ]);
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

    it("draws the pictures of the images under the ink, as a WebP", async () => {
        const toBlob = vi.mocked(HTMLCanvasElement.prototype.toBlob);
        const add = (url: string, y: number) => {
            const image = createImage({ url, x: 100, y, width: 200, height: 100, order: images.length });
            images.push(image);
            thumbnail.markChanged(image);
            return image;
        };
        draw(100, 100, "#ff0000");
        thumbnail.markSaved((await thumbnail.export())?.version ?? -1);
        expect(toBlob).toHaveBeenLastCalledWith(expect.anything(), "image/png", expect.anything());

        // An image on another page, or one whose picture did not load, leaves the thumbnail as it is.
        add("api/attachments/loaded1/image/a.png", getPageTop(1) + 10);
        expect(await thumbnail.export()).toBeUndefined();
        add("api/attachments/missing/image/a.png", 100);
        drawn = [];
        expect(await thumbnail.export()).toBeDefined();
        expect(drawn).toEqual([ "#ff0000" ]);
        expect(toBlob).toHaveBeenLastCalledWith(expect.anything(), "image/png", expect.anything());

        const shown = add("api/attachments/loaded2/image/a.png", 100);
        drawn = [];
        await thumbnail.export();
        expect(drawn).toEqual([ "picture", "#ff0000" ]);
        expect(toBlob).toHaveBeenLastCalledWith(expect.anything(), "image/webp", expect.anything());

        // The first page of a PDF lies under the images.
        background = { picture, rect: { x: 0, y: 0, width: 794, height: 446 } };
        thumbnail.invalidate();
        drawn = [];
        await thumbnail.export();
        expect(drawn).toEqual([ "picture", "picture", "#ff0000" ]);
        background = undefined;

        // A first sheet of another size, as that of a slide, is shown whole.
        firstSheet = { minX: -243, minY: 0, maxX: 1037, maxY: 720 };
        thumbnail.invalidate();
        expect((await thumbnail.export())?.svg).toMatch(/^<svg [^>]*width="600" height="338"/);
        firstSheet = { minX: 0, minY: 0, maxX: 794, maxY: 1123 };

        // On a canvas without bounds, the thumbnail fits the images as well as the ink, which
        // starts 3 units before the image, with 16 units around them.
        images = [ shown ];
        thumbnail.setLayout("infinite");
        expect((await thumbnail.export())?.svg).toMatch(/^<svg [^>]*width="235" height="135"/);
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
