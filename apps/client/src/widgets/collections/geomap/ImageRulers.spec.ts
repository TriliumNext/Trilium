import { describe, expect, it } from "vitest";

import { axisTicks, niceStep, rulerFeatures } from "./ImageRulers";
import { imageSpace, parseImageExtent } from "./space";

describe("niceStep", () => {
    it("rounds up to 1, 2 or 5 times a power of ten", () => {
        expect(niceStep(0.7)).toBe(1);
        expect(niceStep(1)).toBe(1);
        expect(niceStep(1.3)).toBe(2);
        expect(niceStep(3)).toBe(5);
        expect(niceStep(7)).toBe(10);
        expect(niceStep(130)).toBe(200);
        expect(niceStep(0.03)).toBeCloseTo(0.05, 12);
    });
});

describe("axisTicks", () => {
    it("spaces round values at least 90 screen pixels apart, edges included", () => {
        // 1000 units over 1000 image pixels, drawn one to one: 90 units → a step of 100.
        expect(axisTicks(0, 1000, 1000, 1).map(({ value }) => value)).toEqual([ 0, 100, 200, 300, 400, 500, 600, 700, 800, 900, 1000 ]);
        // Zoomed in four times: 22.5 units → 50.
        const zoomed = axisTicks(0, 1000, 1000, 4).map(({ value }) => value);
        expect(zoomed.slice(0, 3)).toEqual([ 0, 50, 100 ]);
        expect(zoomed).toHaveLength(21);
    });

    it("works either way round, across zero, and labels without stray digits or a minus zero", () => {
        const ticks = axisTicks(512, -512, 1024, 1);
        expect(ticks.map(({ value }) => value)).toEqual([ -500, -400, -300, -200, -100, 0, 100, 200, 300, 400, 500 ]);
        expect(ticks.find(({ value }) => value === 0)?.text).toBe("0");

        // 0.09 units → a step of 0.1, which floating point would otherwise print as 0.30000000000000004.
        const fine = axisTicks(0, 1, 1000, 1);
        expect(fine.map(({ text }) => text)).toEqual([ "0", "0.1", "0.2", "0.3", "0.4", "0.5", "0.6", "0.7", "0.8", "0.9", "1" ]);
    });
});

describe("rulerFeatures", () => {
    it("draws a grid line, two ticks and a label per value, and the image's outline", () => {
        const space = imageSpace({ width: 1000, height: 500 }, parseImageExtent("-2000,1000 2000,-1000"));
        const { features } = rulerFeatures(space, 1);
        const byKind = (kind: string) => features.filter((feature) => feature.properties?.kind === kind);

        // A step of 500 both ways: 9 values across, 5 down.
        const labels = byKind("label");
        expect(labels.map((feature) => feature.properties?.label)).toEqual([
            "-2000", "-1500", "-1000", "-500", "0", "500", "1000", "1500", "2000",
            "-1000", "-500", "0", "500", "1000"
        ]);
        expect(byKind("grid")).toHaveLength(14);
        expect(byKind("tick")).toHaveLength(14 * 2 + 1);

        // y grows upwards: the label for 1000 stands beside the top edge, -1000 beside the bottom.
        const yLabel = (text: string) => {
            const feature = labels.find((candidate) => candidate.properties?.anchor === "right" && candidate.properties?.label === text);
            if (feature?.geometry.type !== "Point") throw new Error(`no label ${text}`);
            return feature.geometry.coordinates;
        };
        expect(yLabel("1000")[1]).toBeCloseTo(space.pixelToLngLat([ 0, 0 ])[1], 9);
        expect(yLabel("-1000")[1]).toBeCloseTo(space.pixelToLngLat([ 0, 500 ])[1], 9);
    });
});
