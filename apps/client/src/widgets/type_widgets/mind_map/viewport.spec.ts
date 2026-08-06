import type { MindElixirInstance } from "mind-elixir";
import { describe, expect, it, vi } from "vitest";

import { centerMapOn, parseMapTranslation, readMapCenter, stepZoom } from "./viewport";

const LIMITS = { sensitivity: 0.1, min: 0.2, max: 1.4 };

/**
 * A stand-in for the Mind Elixir instance exposing only what the viewport helpers touch: the size of
 * the view, the transform the map is drawn with, the scale, and the way it is moved.
 */
function buildMind({ width = 800, height = 600, transform = "", scaleVal = 1 } = {}) {
    const move = vi.fn();
    const mind = {
        container: { getBoundingClientRect: () => ({ width, height }) },
        map: { style: { transform } },
        scaleVal,
        move
    } as unknown as MindElixirInstance;

    return { mind, move };
}

describe("stepZoom", () => {
    it("steps by the sensitivity in either direction", () => {
        expect(stepZoom(1, 1, LIMITS)).toBeCloseTo(1.1);
        expect(stepZoom(1, -1, LIMITS)).toBeCloseTo(0.9);
    });

    it("refuses the step that would leave the range, and only at the end being moved towards", () => {
        expect(stepZoom(1.35, 1, LIMITS)).toBeNull();
        expect(stepZoom(1.35, -1, LIMITS)).toBeCloseTo(1.25);
        expect(stepZoom(0.25, -1, LIMITS)).toBeNull();
        expect(stepZoom(0.25, 1, LIMITS)).toBeCloseTo(0.35);
    });

    it("still zooms a map drawn smaller than the minimum, as fitting one to a small pane leaves it", () => {
        expect(stepZoom(0.1, 1, LIMITS)).toBeCloseTo(0.2);
        expect(stepZoom(0.1, -1, LIMITS)).toBeNull();
    });

    it("allows the step that lands on the end of the range", () => {
        const limits = { sensitivity: 0.5, min: 0.5, max: 1.5 };
        expect(stepZoom(1, 1, limits)).toBe(1.5);
        expect(stepZoom(1, -1, limits)).toBe(0.5);
    });
});

describe("parseMapTranslation", () => {
    it("reads the offset Mind Elixir writes, whether or not a scale follows it", () => {
        expect(parseMapTranslation("translate3d(120px, -40px, 0) scale(0.8)")).toEqual({ x: 120, y: -40 });
        expect(parseMapTranslation("translate3d(1.5px, 2.5px, 0)")).toEqual({ x: 1.5, y: 2.5 });
    });

    it("takes a map that has not been placed yet to sit at the origin", () => {
        expect(parseMapTranslation("")).toEqual({ x: 0, y: 0 });
        expect(parseMapTranslation("none")).toEqual({ x: 0, y: 0 });
        expect(parseMapTranslation("scale(2)")).toEqual({ x: 0, y: 0 });
    });
});

describe("readMapCenter / centerMapOn", () => {
    it("reads the point of the map lying in the middle of the view, in the map's own coordinates", () => {
        const { mind } = buildMind({
            width: 800, height: 600,
            transform: "translate3d(100px, 50px, 0) scale(2)",
            scaleVal: 2
        });

        // The middle of the view is 300px right of and 250px below the map's origin on screen,
        // which the map draws at half that in its own coordinates.
        expect(readMapCenter(mind)).toEqual({ x: 150, y: 125 });
    });

    it("moves by whatever it takes to bring a point back to the middle", () => {
        const { mind, move } = buildMind({
            width: 400, height: 300,
            transform: "translate3d(0px, 0px, 0) scale(1)"
        });

        centerMapOn(mind, { x: 50, y: 25 });

        expect(move).toHaveBeenCalledWith(150, 125);
    });

    it("puts back what it read once the view has changed size", () => {
        const transform = "translate3d(100px, 50px, 0) scale(1)";
        const { mind: small } = buildMind({ width: 800, height: 600, transform });
        const center = readMapCenter(small);

        // The same map, drawn at the same offset and scale, on a view the size of a screen.
        const { mind: large, move } = buildMind({ width: 1920, height: 1080, transform });
        centerMapOn(large, center);

        const [ dx, dy ] = move.mock.calls[0];
        expect(dx).toBeCloseTo((1920 - 800) / 2);
        expect(dy).toBeCloseTo((1080 - 600) / 2);
    });
});
