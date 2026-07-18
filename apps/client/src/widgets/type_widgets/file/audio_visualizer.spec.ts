import { describe, expect, it } from "vitest";

import { buildRowColors, cellIntensity, computeColumnAmplitudes, computeGrid, hasMotion, parseRgb, resizePreserving, smoothAmplitudes } from "./audio_visualizer";

describe("computeGrid", () => {
    it("fits as many cells as the size allows and centres horizontally", () => {
        // stride = 21 + 4 = 25. Width 100 → floor((100+4)/25) = 4 cols; grid spans 4*25-4 = 96, centred → 2px.
        const grid = computeGrid(100, 50, 21, 4);
        expect(grid.cols).toBe(4);
        expect(grid.rows).toBe(2); // floor((50+4)/25) = 2
        expect(grid.offsetX).toBeCloseTo(2);
    });

    it("returns an empty grid for non-positive sizes", () => {
        expect(computeGrid(0, 0, 21, 4)).toEqual({ cols: 0, rows: 0, offsetX: 0 });
        expect(computeGrid(10, 10, 0, 0)).toEqual({ cols: 0, rows: 0, offsetX: 0 });
    });
});

describe("parseRgb", () => {
    it("parses rgb()/rgba() and hex forms", () => {
        expect(parseRgb("rgb(10, 20, 30)")).toEqual([ 10, 20, 30 ]);
        expect(parseRgb("rgba(255, 128, 0, 0.5)")).toEqual([ 255, 128, 0 ]);
        expect(parseRgb("#ff8800")).toEqual([ 255, 136, 0 ]);
        expect(parseRgb("#abc")).toEqual([ 170, 187, 204 ]);
    });

    it("clamps out-of-range channels and falls back to black on garbage", () => {
        expect(parseRgb("rgb(300, -5, 999)")).toEqual([ 255, 0, 255 ]);
        expect(parseRgb("not-a-color")).toEqual([ 0, 0, 0 ]);
    });
});

describe("buildRowColors", () => {
    it("interpolates from the low colour at the bottom to the high colour at the top", () => {
        const colors = buildRowColors("rgb(0, 0, 0)", "rgb(200, 200, 200)", 3);
        expect(colors).toHaveLength(3);
        expect(colors[0]).toBe("rgb(0, 0, 0)"); // bottom = low
        expect(colors[1]).toBe("rgb(100, 100, 100)"); // midpoint
        expect(colors[2]).toBe("rgb(200, 200, 200)"); // top = high
    });

    it("handles the single-row and empty cases", () => {
        expect(buildRowColors("rgb(10, 10, 10)", "rgb(90, 90, 90)", 1)).toEqual([ "rgb(10, 10, 10)" ]);
        expect(buildRowColors("rgb(0, 0, 0)", "rgb(1, 1, 1)", 0)).toEqual([]);
    });
});

describe("computeColumnAmplitudes", () => {
    it("downsamples to one normalized peak per column over the selected window", () => {
        // 8 bins; full window; 2 columns → first column = max(bins 0..3), second = max(bins 4..7).
        const freq = new Uint8Array([ 0, 51, 0, 0, 0, 0, 255, 0 ]);
        const out = computeColumnAmplitudes(freq, new Float32Array(2), 0, 1);
        expect(out[0]).toBeCloseTo(51 / 255);
        expect(out[1]).toBeCloseTo(1);
    });

    it("restricts to the [loFraction, hiFraction] slice of the spectrum", () => {
        // Energy only in the top half; with a window of the bottom half it reads as silent.
        const freq = new Uint8Array([ 0, 0, 0, 0, 200, 200, 200, 200 ]);
        const out = computeColumnAmplitudes(freq, new Float32Array(1), 0, 0.5);
        expect(out[0]).toBe(0);
    });

    it("guards empty input", () => {
        expect(Array.from(computeColumnAmplitudes(new Uint8Array(0), new Float32Array(3), 0, 1))).toEqual([ 0, 0, 0 ]);
    });
});

describe("smoothAmplitudes", () => {
    it("rises fast and falls slow toward the target", () => {
        const current = new Float32Array([ 0, 1 ]);
        smoothAmplitudes(current, new Float32Array([ 1, 0 ]), 0.5, 0.1);
        expect(current[0]).toBeCloseTo(0.5); // rose by rise factor
        expect(current[1]).toBeCloseTo(0.9); // fell by fall factor
    });

    it("decays to exactly zero when the target is null (paused)", () => {
        const current = new Float32Array([ 0.5 ]);
        for (let i = 0; i < 200; i++) smoothAmplitudes(current, null, 0.5, 0.2);
        expect(current[0]).toBe(0);
        expect(hasMotion(current)).toBe(false);
    });
});

describe("cellIntensity", () => {
    it("saturates cells inside the bar and fades the leading one", () => {
        // amplitude 0.35 over 10 rows → fill 3.5: rows 0-2 fully on, row 3 half-lit, rows 4+ off.
        expect(cellIntensity(0.35, 10, 0)).toBe(1);
        expect(cellIntensity(0.35, 10, 2)).toBe(1);
        expect(cellIntensity(0.35, 10, 3)).toBeCloseTo(0.5);
        expect(cellIntensity(0.35, 10, 4)).toBe(0);
    });

    it("is zero for a silent column", () => {
        expect(cellIntensity(0, 10, 0)).toBe(0);
    });
});

describe("resizePreserving", () => {
    it("preserves overlapping values when growing or shrinking", () => {
        // Float32-exact values so the round-trip through Float32Array compares exactly.
        const grown = resizePreserving(new Float32Array([ 0.5, 0.25 ]), 4);
        expect(Array.from(grown)).toEqual([ 0.5, 0.25, 0, 0 ]);
        const shrunk = resizePreserving(new Float32Array([ 0.5, 0.25, 0.75 ]), 2);
        expect(Array.from(shrunk)).toEqual([ 0.5, 0.25 ]);
    });

    it("returns the same array when the length is unchanged", () => {
        const arr = new Float32Array([ 1, 2 ]);
        expect(resizePreserving(arr, 2)).toBe(arr);
    });
});
