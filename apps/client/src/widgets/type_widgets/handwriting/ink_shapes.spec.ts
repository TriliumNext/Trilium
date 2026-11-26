import { describe, expect, it } from "vitest";

import { buildStrokePoints, parseInkDocument } from "./ink_document";
import { lineToPoints, polygonToPoints, recognizeLine, recognizeRectangle } from "./ink_shapes";

describe("line recognition", () => {
    /** Flat triples through `[x, y]` pairs, at a pressure of 0.5. */
    const stroke = (...positions: number[][]) => positions.flatMap(([ x, y ]) => [ x, y, 0.5 ]);

    it("takes a stroke close to the line between its ends as that line", () => {
        const wobbly = stroke([ 10, 10 ], [ 60, 14 ], [ 110, 7 ], [ 160, 12 ], [ 210, 10 ]);
        expect(recognizeLine(wobbly, 20)).toEqual({ fromX: 10, fromY: 10, toX: 210, toY: 10 });

        // In any direction, and with the jitter of a pen held still at the end.
        const diagonal = stroke([ 0, 0 ], [ 52, 48 ], [ 100, 100 ], [ 101, 99 ], [ 100, 101 ]);
        expect(recognizeLine(diagonal, 20)).toEqual({ fromX: 0, fromY: 0, toX: 100, toY: 101 });
    });

    it("leaves a stroke that is not a line as it is", () => {
        // An arc that rises a quarter of its width.
        expect(recognizeLine(stroke([ 0, 0 ], [ 50, 40 ], [ 100, 50 ], [ 150, 40 ], [ 200, 0 ]), 20)).toBeUndefined();
        // Shading back and forth along one line.
        expect(recognizeLine(stroke([ 0, 0 ], [ 100, 2 ], [ 10, 0 ], [ 100, 1 ]), 20)).toBeUndefined();
        // A closed loop, a dot and a stroke shorter than the minimum.
        expect(recognizeLine(stroke([ 0, 0 ], [ 50, 50 ], [ 0, 100 ], [ 0, 0 ]), 20)).toBeUndefined();
        expect(recognizeLine(stroke([ 5, 5 ]), 20)).toBeUndefined();
        expect(recognizeLine(stroke([ 0, 0 ], [ 5, 0 ], [ 10, 0 ]), 20)).toBeUndefined();
    });

    it("builds a line of three points at one pressure", () => {
        expect(lineToPoints({ fromX: 0, fromY: 10, toX: 100, toY: 30 }, 0.4))
            .toEqual([ 0, 10, 0.4, 50, 20, 0.4, 100, 30, 0.4 ]);
    });
});

describe("rectangle recognition", () => {
    /**
     * Flat triples of a stroke through `corners` and back to the first, with a point every 10
     * units that `wobble` moves off the side, and the whole turned by `angle` degrees.
     */
    const outline = (corners: number[][], wobble = 0, angle = 0) => {
        const cos = Math.cos(angle * Math.PI / 180);
        const sin = Math.sin(angle * Math.PI / 180);
        const points: number[] = [];
        for (const [ index, [ fromX, fromY ] ] of corners.entries()) {
            const [ toX, toY ] = corners[(index + 1) % corners.length];
            const steps = Math.ceil(Math.hypot(toX - fromX, toY - fromY) / 10);
            for (let step = 0; step < steps; step++) {
                const offset = step % 2 ? wobble : -wobble;
                const x = fromX + (toX - fromX) * step / steps + offset;
                const y = fromY + (toY - fromY) * step / steps + offset;
                points.push(x * cos - y * sin, x * sin + y * cos, 0.5);
            }
        }
        points.push(points[0], points[1], 0.5);
        return points;
    };
    const rounded = (corners: number[][] | undefined) =>
        corners?.map(([ x, y ]) => [ Math.round(x), Math.round(y) ]).sort((a, b) => a[0] - b[0] || a[1] - b[1]);
    const box = [ [ 10, 20 ], [ 210, 20 ], [ 210, 120 ], [ 10, 120 ] ];

    it("takes a stroke around a rectangle as that rectangle, level when drawn almost level", () => {
        expect(rounded(recognizeRectangle(outline(box), 20)))
            .toEqual([ [ 10, 20 ], [ 10, 120 ], [ 210, 20 ], [ 210, 120 ] ]);

        // A wobbly stroke gives a level rectangle within a few units of the one drawn.
        const wobbly = rounded(recognizeRectangle(outline(box, 2), 20)) ?? [];
        expect(wobbly).toHaveLength(4);
        for (const [ index, [ x, y ] ] of [ [ 10, 20 ], [ 10, 120 ], [ 210, 20 ], [ 210, 120 ] ].entries()) {
            expect(Math.hypot(wobbly[index][0] - x, wobbly[index][1] - y)).toBeLessThan(6);
        }
        expect(new Set(wobbly.flat()).size).toBe(4);

        // A rectangle drawn by hand, with sides that lean, is level and as large as its mean sides.
        const stroke = { c: "auto", w: 3, p: PEN_RECTANGLE };
        const { points } = parseInkDocument(JSON.stringify({ version: 1, strokes: [ stroke ] })).strokes[0];
        expect(rounded(recognizeRectangle(points, 20)))
            .toEqual([ [ 343, 162 ], [ 343, 244 ], [ 453, 162 ], [ 453, 244 ] ]);

        // Turned by 5 degrees either way, or by 95, the sides lie along the axes, around the same center.
        for (const angle of [ 5, -5, 12, 95 ]) {
            const corners = recognizeRectangle(outline(box, 0, angle), 20) ?? [];
            expect(new Set(corners.map(([ x ]) => Math.round(x))).size).toBe(2);
            expect(new Set(corners.map(([ , y ]) => Math.round(y))).size).toBe(2);
            const sides = [ 0, 1 ].map((index) => Math.hypot(
                corners[index + 1][0] - corners[index][0], corners[index + 1][1] - corners[index][1]
            ));
            expect(sides.map(Math.round).sort((a, b) => a - b)).toEqual([ 100, 200 ]);
        }

        // Turned further, it keeps its angle.
        expect(rounded(recognizeRectangle(outline(box, 0, 30), 20)))
            .toEqual([ [ -51, 109 ], [ -1, 22 ], [ 122, 209 ], [ 172, 122 ] ]);
    });

    it("leaves other strokes as they are", () => {
        const circle: number[] = [];
        for (let angle = 0; angle <= 360; angle += 10) {
            circle.push(100 + 80 * Math.cos(angle * Math.PI / 180), 100 + 80 * Math.sin(angle * Math.PI / 180), 0.5);
        }
        expect(recognizeRectangle(circle, 20)).toBeUndefined();
        // A triangle, three sides of a rectangle, a rectangle drawn twice around and a small one.
        expect(recognizeRectangle(outline([ [ 0, 0 ], [ 200, 0 ], [ 100, 150 ] ]), 20)).toBeUndefined();
        expect(recognizeRectangle(outline(box).slice(0, -33 * 3), 20)).toBeUndefined();
        expect(recognizeRectangle([ ...outline(box), ...outline(box) ], 20)).toBeUndefined();
        expect(recognizeRectangle(outline([ [ 0, 0 ], [ 15, 0 ], [ 15, 15 ], [ 0, 15 ] ]), 20)).toBeUndefined();
    });

    it("runs a stroke of one pressure around a polygon, close to its corners once smoothed", () => {
        const corners = [ [ 0, 0 ], [ 200, 0 ], [ 200, 100 ], [ 0, 100 ] ];
        const points = polygonToPoints(corners, 0.4);
        expect(points.slice(0, 3)).toEqual([ 100, 0, 0.4 ]);
        expect(points.slice(-3)).toEqual([ 100, 0, 0.4 ]);
        expect(points.length / 3).toBeLessThan(80);

        const smoothed = buildStrokePoints({ size: 4, simulatePressure: false, points });
        for (const { point: [ x, y ], pressure } of smoothed) {
            expect(pressure).toBe(0.4);
            expect(Math.min(Math.abs(x), Math.abs(x - 200), Math.abs(y), Math.abs(y - 100))).toBeLessThan(0.5);
        }
        for (const [ cornerX, cornerY ] of corners) {
            const nearest = Math.min(...smoothed.map(({ point: [ x, y ] }) => Math.hypot(x - cornerX, y - cornerY)));
            expect(nearest).toBeLessThan(1);
        }
    });
});

/**
 * A rectangle drawn with a pen on a tablet, as the saved `p` of its stroke. Its corners are between
 * 81 and 98 degrees and its sides lean up to 18 degrees.
 */
const PEN_RECTANGLE = [
    4662, 2351, 3, -8, 0, 36, 0, -8, 2, -8, -8, 4, -8, -15, 1, 0, -8, 1, -8, -8, 1, 0, -8, 1,
    -8, -16, 1, -8, -16, 0, -8, -15, 1, -8, -24, 0, -7, -24, 1, -8, -24, 0, -8, -23, 2, 0, -24, 0,
    -8, -24, 0, -8, -31, 1, -8, -32, 0, 0, -32, -1, -8, -31, 1, -8, -32, 0, -8, -31, 0, -8, -32, 0,
    -8, -32, 0, -7, -31, 0, -8, -24, 0, -8, -31, 0, -8, -24, 0, -8, -24, 0, -8, -16, -1, -8, -16, 0,
    0, -15, 1, -8, -8, 0, 0, -16, 0, 0, -8, 0, 0, -8, 0, 0, -16, 0, -8, 0, 1, 0, -8, 0,
    0, -7, 1, 0, -8, 1, 0, -8, 1, -8, 0, 2, 0, -8, 2, -7, 0, 0, -8, -8, 1, -8, 0, 3,
    -8, 0, 1, -8, 0, 0, -8, 0, 1, -16, -8, 1, -8, 0, 1, -8, 0, 0, -7, 0, 2, -8, 0, 4,
    -16, 0, 1, -16, 0, 0, -24, 0, 0, -23, 0, 1, -16, 0, 0, -24, 0, 0, -24, 8, 1, -31, 0, 0,
    -24, 0, 0, -32, 8, 0, -31, 8, 0, -32, 0, 0, -31, 0, 1, -40, 8, 0, -31, 0, 0, -40, 8, 1,
    -32, 0, -1, -31, 7, 0, -40, 0, 1, -23, 8, 0, -32, 0, -1, -32, 8, 1, -23, 0, 1, -24, 8, -1,
    -24, 0, 1, -23, 8, 1, -24, 8, 0, -16, 0, 0, -16, 8, 0, -16, 0, 0, -7, 0, 0, -16, 8, 0,
    -8, 0, 0, -8, 8, -1, -8, 0, 0, -8, 0, 0, -8, 0, -1, -8, 8, -1, -8, 0, -2, -15, 0, 0,
    -8, 0, -1, -16, 0, 0, 0, 7, 0, -8, 0, 0, -8, 0, 1, -8, 0, 0, -8, 0, -1, -8, 8, 0,
    -8, 0, 0, -7, 0, -1, -8, 8, 0, 0, 8, 1, 0, 8, 0, 0, 8, 0, 0, 8, 1, 0, 8, 0,
    0, 8, 1, 0, 16, 1, 8, 15, 2, 0, 16, 1, 0, 24, 2, 0, 16, 1, -8, 23, 1, 0, 24, 2,
    0, 32, 2, 0, 23, 1, -8, 32, 2, 0, 24, 2, 0, 31, 2, 0, 32, 1, 0, 32, 1, 0, 31, 1,
    8, 24, 1, 0, 31, 0, 8, 24, 1, 0, 24, 0, 7, 24, 1, 0, 23, 1, 8, 16, 1, 0, 16, 0,
    8, 16, 1, 8, 15, 0, 0, 16, 0, 0, 16, 1, 8, 16, 0, 8, 8, 0, 8, 16, 0, 8, 8, 1,
    8, 15, 0, 8, 8, 0, 7, 8, 0, 8, 16, 0, 8, 0, 1, 0, 8, 0, 8, 0, 1, 0, 8, -1,
    8, 8, 2, 8, 0, 1, 8, 8, 1, 8, 0, 0, 8, 0, 0, 16, 0, 0, 7, 0, 0, 8, 0, 0,
    24, 0, 1, 16, 0, 0, 8, -8, 0, 16, 0, 0, 23, 0, 0, 16, 0, 0, 32, 0, 1, 23, 0, -1,
    32, 0, 0, 32, -8, 1, 39, 0, 1, 48, -8, 0, 47, 0, 1, 55, -8, 0, 48, -8, 1, 55, -8, 0,
    47, 0, 0, 48, -8, 0, 47, -8, 2, 48, -8, -1, 39, -7, 0, 32, -8, 2, 31, 0, 0, 24, -8, 1,
    32, 0, 1, 23, -8, 0, 24, 0, 1, 24, -8, 1, 16, 0, 0, 15, 0, 1, 8, 0, 2, 16, -8, 0,
    8, 0, 3, 8, 0, -1, 8, 0, 3, 8, 0, 0, 8, 0, -1, 8, 0, 3, 7, 0, 7, 8, 0, -1,
    16, 0, 0, 8, 0, 1, 8, 0, 0, -8, -8, 17, -8, 0, 0, -8, 0, 2, 8, 0, 15, 0, 8, 1,
    8, 8, -1
];
