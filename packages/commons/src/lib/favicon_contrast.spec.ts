import { afterEach, describe, expect, it, vi } from "vitest";

import {
    classifyFaviconContrast,
    contrastRatio,
    faviconContrastClass,
    measureFaviconVisibility,
    relativeLuminance,
    summarizeFaviconVisibility
} from "./favicon_contrast.js";

/** Builds an RGBA bitmap out of runs of identical pixels: `[r, g, b, alpha, howMany]`. */
function bitmap(...runs: [number, number, number, number, number][]): Uint8ClampedArray {
    const pixels: number[] = [];

    for (const [r, g, b, alpha, count] of runs) {
        for (let i = 0; i < count; i++) {
            pixels.push(r, g, b, alpha);
        }
    }

    return new Uint8ClampedArray(pixels);
}

const TRANSPARENT: [number, number, number, number, number] = [0, 0, 0, 0, 100];

describe("relative luminance and contrast", () => {
    it("anchors on black and white, and rates the pair at the maximum ratio", () => {
        expect(relativeLuminance({ r: 0, g: 0, b: 0 })).toBe(0);
        expect(relativeLuminance({ r: 255, g: 255, b: 255 })).toBeCloseTo(1, 5);

        expect(contrastRatio(0, 1)).toBeCloseTo(21, 5);
        // Order must not matter, and a colour against itself is the minimum.
        expect(contrastRatio(1, 0)).toBeCloseTo(21, 5);
        expect(contrastRatio(0.3, 0.3)).toBe(1);
    });

    it("ranks the channels by how much light each carries", () => {
        const red = relativeLuminance({ r: 255, g: 0, b: 0 });
        const green = relativeLuminance({ r: 0, g: 255, b: 0 });
        const blue = relativeLuminance({ r: 0, g: 0, b: 255 });

        expect(green).toBeGreaterThan(red);
        expect(red).toBeGreaterThan(blue);
    });
});

describe("classifying a favicon", () => {
    it("condemns a black glyph on nothing, which is the case that started all this", () => {
        // GitHub's octocat: a black mark on a transparent field.
        const visibility = summarizeFaviconVisibility(bitmap(TRANSPARENT, [0, 0, 0, 255, 40]));

        expect(visibility.hasContent).toBe(true);
        expect(visibility.onDark).toBe(0);
        expect(visibility.onLight).toBe(1);
        expect(classifyFaviconContrast(visibility)).toBe("dark");
    });

    it("condemns a white glyph on nothing just as readily, which a dark-mode-only fix would miss", () => {
        const visibility = summarizeFaviconVisibility(bitmap(TRANSPARENT, [255, 255, 255, 255, 40]));

        expect(visibility.onDark).toBe(1);
        expect(visibility.onLight).toBe(0);
        expect(classifyFaviconContrast(visibility)).toBe("light");
    });

    it("leaves an ordinary mid-tone colour alone on both surfaces", () => {
        const visibility = summarizeFaviconVisibility(bitmap([0x4a, 0x90, 0xd9, 255, 40]));

        expect(visibility.onDark).toBe(1);
        expect(visibility.onLight).toBe(1);
        expect(classifyFaviconContrast(visibility)).toBe("neutral");
    });

    it("leaves a filled tile alone: its own mark carries it, however dark the tile is", () => {
        // A black square with a white glyph over a fifth of it. The average colour is nearly black,
        // yet the glyph is what one actually sees, and it survives a dark theme untouched.
        const visibility = summarizeFaviconVisibility(bitmap([0, 0, 0, 255, 80], [255, 255, 255, 255, 20]));

        expect(visibility.onDark).toBeCloseTo(0.2, 5);
        expect(classifyFaviconContrast(visibility)).toBe("neutral");
    });

    it("leaves a tile alone however thin its mark is, since inverting one only moves the problem", () => {
        // Wikipedia's home-screen icon: a white tile with a thin dark W over a sixteenth of it. The
        // tile is the surface's own colour on a light theme, so it counts for nothing here — but
        // that is what makes the icon look right, and inverting it yields a black square with a
        // white W, which is what a reader saw before this share was lowered.
        const lightTile = summarizeFaviconVisibility(bitmap([255, 255, 255, 255, 94], [0x20, 0x20, 0x20, 255, 6]));

        expect(lightTile.onLight).toBeCloseTo(0.06, 5);
        expect(classifyFaviconContrast(lightTile)).toBe("neutral");

        // The same icon drawn the other way round, which a dark theme has to leave alone for the
        // same reason.
        const darkTile = summarizeFaviconVisibility(bitmap([0, 0, 0, 255, 94], [255, 255, 255, 255, 6]));

        expect(classifyFaviconContrast(darkTile)).toBe("neutral");
    });

    it("weighs each pixel by how opaque it is, so a faint edge does not count as a whole mark", () => {
        // A black glyph whose only light pixels are half-transparent: not enough to save it.
        const visibility = summarizeFaviconVisibility(bitmap([0, 0, 0, 255, 90], [255, 255, 255, 26, 10]));

        expect(visibility.onDark).toBeLessThan(0.02);
        expect(classifyFaviconContrast(visibility)).toBe("dark");
    });

    it("says nothing about an icon that draws nothing", () => {
        const visibility = summarizeFaviconVisibility(bitmap(TRANSPARENT));

        expect(visibility).toEqual({ onDark: 0, onLight: 0, hasContent: false });
        expect(classifyFaviconContrast(visibility)).toBe("neutral");
        expect(summarizeFaviconVisibility(new Uint8ClampedArray()).hasContent).toBe(false);
    });
});

describe("measureFaviconVisibility", () => {
    /** A canvas that draws nowhere and answers with the pixels it was given. */
    function stubCanvas(context: unknown) {
        vi.stubGlobal("document", { createElement: () => ({ getContext: () => context }) });
    }

    afterEach(() => {
        vi.unstubAllGlobals();
    });

    it("reads the icon back off the canvas it was rasterised into", () => {
        const drawn: unknown[][] = [];
        stubCanvas({
            drawImage: (...args: unknown[]) => drawn.push(args),
            getImageData: () => ({ data: bitmap(TRANSPARENT, [0, 0, 0, 255, 40]) })
        });

        const image = {} as CanvasImageSource;

        expect(measureFaviconVisibility(image)).toEqual({ onDark: 0, onLight: 1, hasContent: true });
        // Into a box of a stated size, because an SVG that declares only a viewBox has no size of
        // its own for `drawImage` to read — and the whole box is read back, transparent field and all.
        expect(drawn).toEqual([ [ image, 0, 0, 32, 32 ] ]);
    });

    it("answers nothing rather than a verdict when the icon cannot be measured", () => {
        // No 2d context to be had.
        stubCanvas(null);
        expect(measureFaviconVisibility({} as CanvasImageSource)).toBeUndefined();

        // `getImageData` throws on a tainted canvas. A preview's pictures are always same-origin, so
        // this should not arise — but an unreadable icon is a reason to leave it as the site drew it,
        // never to fail the render around it.
        stubCanvas({
            drawImage: () => {},
            getImageData: () => {
                throw new Error("tainted canvas");
            }
        });
        expect(measureFaviconVisibility({} as CanvasImageSource)).toBeUndefined();
    });
});

describe("faviconContrastClass", () => {
    it("names the two verdicts that need styling and stays silent on the third", () => {
        expect(faviconContrastClass("dark")).toBe("link-embed-favicon-dark");
        expect(faviconContrastClass("light")).toBe("link-embed-favicon-light");
        expect(faviconContrastClass("neutral")).toBeUndefined();
    });
});
