import { describe, expect, it } from "vitest";

import { buildStrokePoints, parseInkDocument } from "./ink_document";
import {
    type Arrow, arrowToPoints, type Ellipse, ellipseToPoints, lineToPoints, polygonToPoints, recognizeArrow,
    recognizeEllipse, recognizeLine, recognizeRectangle, recognizeTriangle, shapeToPoints
} from "./ink_shapes";

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

    it("takes a stroke around a triangle as that triangle, with a side along an axis if close", () => {
        const triangle = [ [ 0, 0 ], [ 200, 0 ], [ 100, 150 ] ];
        expect(rounded(recognizeTriangle(outline(triangle, 2), 20)))
            .toEqual([ [ -2, -2 ], [ 98, 148 ], [ 198, -2 ] ]);

        // Drawn 6 degrees off, the base is level again, and as long.
        const leveled = rounded(recognizeTriangle(outline(triangle, 0, 6), 20)) ?? [];
        expect(leveled[0][1]).toBe(leveled[2][1]);
        expect(leveled[2][0] - leveled[0][0]).toBe(200);
        expect(leveled[1][1] - leveled[0][1]).toBe(150);

        // With every side more than 10 degrees off the axes, the corners stay where drawn.
        const equilateral = [ [ 0, 0 ], [ 200, 0 ], [ 100, 173 ] ];
        expect(rounded(recognizeTriangle(outline(equilateral, 0, 15), 20)))
            .toEqual(rounded([ [ 0, 0 ], [ 193.2, 51.8 ], [ 51.8, 193 ] ]));
    });

    it("leaves a stroke that is not a triangle as it is", () => {
        const circle: number[] = [];
        for (let angle = 0; angle <= 360; angle += 10) {
            circle.push(100 + 80 * Math.cos(angle * Math.PI / 180), 100 + 80 * Math.sin(angle * Math.PI / 180), 0.5);
        }
        expect(recognizeTriangle(circle, 20)).toBeUndefined();
        // A rectangle, two sides of a triangle, a sliver and a small triangle.
        const triangle = outline([ [ 0, 0 ], [ 200, 0 ], [ 100, 150 ] ]);
        expect(recognizeTriangle(outline(box), 20)).toBeUndefined();
        expect(recognizeTriangle(triangle.slice(0, -19 * 3), 20)).toBeUndefined();
        expect(recognizeTriangle(outline([ [ 0, 0 ], [ 200, 0 ], [ 100, 12 ] ]), 20)).toBeUndefined();
        expect(recognizeTriangle(outline([ [ 0, 0 ], [ 15, 0 ], [ 8, 12 ] ]), 20)).toBeUndefined();
        expect(recognizeTriangle(triangle, 20)).toBeDefined();
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

describe("ellipse recognition", () => {
    /**
     * Flat triples of a stroke around an ellipse centered on (300, 200) and turned by `angle`
     * degrees, over `sweep` degrees, with a radius that `wobble` changes three times around.
     */
    const ring = (radiusX: number, radiusY: number, angle = 0, wobble = 0, sweep = 360) => {
        const cos = Math.cos(angle * Math.PI / 180);
        const sin = Math.sin(angle * Math.PI / 180);
        const points: number[] = [];
        for (let degrees = 0; degrees <= sweep; degrees += 5) {
            const turn = degrees * Math.PI / 180;
            const x = (radiusX + wobble * Math.sin(3 * turn)) * Math.cos(turn);
            const y = (radiusY + wobble * Math.sin(3 * turn)) * Math.sin(turn);
            points.push(300 + x * cos - y * sin, 200 + x * sin + y * cos, 0.5);
        }
        return points;
    };
    const rounded = (ellipse: Ellipse | undefined) => ellipse && Object.values(ellipse).map(Math.round);

    it("takes a stroke around an ellipse as that ellipse, or as a circle when nearly round", () => {
        expect(rounded(recognizeEllipse(ring(80, 80), 20))).toEqual([ 300, 200, 80, 80, 0 ]);
        expect(rounded(recognizeEllipse(ring(120, 60), 20))).toEqual([ 300, 200, 120, 60, 0 ]);

        // A lumpy ring that is nine tenths as high as wide is a circle of the mean radius.
        const lumpy = recognizeEllipse(ring(80, 72, 30, 6), 20);
        expect(lumpy?.radiusX).toBe(lumpy?.radiusY);
        expect(lumpy?.radiusX).toBeGreaterThan(72);
        expect(lumpy?.radiusX).toBeLessThan(84);
        expect(lumpy?.angle).toBe(0);

        // A circle drawn with a pen runs past its start, inside the loop, which leaves the fit alone.
        const { points } = parseInkDocument(JSON.stringify({ version: 1, strokes: [ { w: 3, p: PEN_CIRCLE } ] })).strokes[0];
        expect(rounded(recognizeEllipse(points, 20))).toEqual([ 582, 255, 33, 27, -23 ]);

        // Drawn almost level or almost upright, an ellipse lies along the axes.
        expect(rounded(recognizeEllipse(ring(120, 60, 10), 20))).toEqual([ 300, 200, 120, 60, 0 ]);
        expect(rounded(recognizeEllipse(ring(120, 60, 80), 20))).toEqual([ 300, 200, 60, 120, 0 ]);
        expect(rounded(recognizeEllipse(ring(120, 60, 40), 20))).toEqual([ 300, 200, 120, 60, 40 ]);
    });

    it("leaves a stroke that is not an ellipse as it is", () => {
        const square = [ [ 0, 0 ], [ 100, 0 ], [ 100, 100 ], [ 0, 100 ] ];
        const triangle = [ [ 0, 0 ], [ 200, 0 ], [ 100, 150 ] ];
        for (const corners of [ square, triangle ]) {
            const points: number[] = [];
            for (const [ index, [ fromX, fromY ] ] of corners.entries()) {
                const [ toX, toY ] = corners[(index + 1) % corners.length];
                for (let step = 0; step <= 10; step++) {
                    points.push(fromX + (toX - fromX) * step / 10, fromY + (toY - fromY) * step / 10, 0.5);
                }
            }
            expect(recognizeEllipse(points, 20)).toBeUndefined();
        }
        // Three quarters of a circle, a circle drawn twice around and a small one.
        expect(recognizeEllipse(ring(80, 80, 0, 0, 270), 20)).toBeUndefined();
        expect(recognizeEllipse(ring(80, 80, 0, 0, 720), 20)).toBeUndefined();
        expect(recognizeEllipse(ring(8, 8), 20)).toBeUndefined();

        // A stroke of more points than a drawn shape has is not compared point by point.
        const dense = (count: number) => Array.from({ length: count + 1 }, (_, index) => {
            const turn = 2 * Math.PI * index / count;
            return [ 300 + 80 * Math.cos(turn), 200 + 80 * Math.sin(turn), 0.5 ];
        }).flat();
        expect(recognizeEllipse(dense(3000), 20)).toBeDefined();
        expect(recognizeEllipse(dense(5000), 20)).toBeUndefined();
    });

    it("runs a stroke of one pressure around an ellipse, on it once smoothed", () => {
        const points = ellipseToPoints({ centerX: 300, centerY: 200, radiusX: 120, radiusY: 60, angle: 0 }, 0.4);
        expect(points.slice(0, 3)).toEqual([ 420, 200, 0.4 ]);
        expect(points.slice(-3).map((value) => Math.round(value * 10) / 10)).toEqual([ 420, 200, 0.4 ]);
        expect(points.length / 3).toBeLessThan(120);

        const smoothed = buildStrokePoints({ size: 4, simulatePressure: false, points });
        for (const { point: [ x, y ], pressure } of smoothed) {
            expect(pressure).toBe(0.4);
            expect(Math.abs(Math.hypot((x - 300) / 120, (y - 200) / 60) - 1)).toBeLessThan(0.01);
        }

        // A small circle keeps enough points to stay round, and a rectangle is tried first.
        expect(ellipseToPoints({ centerX: 0, centerY: 0, radiusX: 10, radiusY: 10, angle: 0 }, 0.5).length / 3).toBe(25);
        expect(shapeToPoints(ring(80, 80), 20, 0.5)?.length).toBe(85 * 3);
        expect(shapeToPoints(ring(80, 80, 0, 0, 180), 20, 0.5)).toBeUndefined();
    });
});

describe("arrow recognition", () => {
    /** Flat triples of a stroke along the segments between `vertices`, with a point every 4 units. */
    const path = (...vertices: number[][]) => {
        const points = [ vertices[0][0], vertices[0][1], 0.5 ];
        for (const [ index, [ toX, toY ] ] of vertices.entries()) {
            if (!index) continue;
            const [ fromX, fromY ] = vertices[index - 1];
            const steps = Math.ceil(Math.hypot(toX - fromX, toY - fromY) / 4);
            for (let step = 1; step <= steps; step++) {
                points.push(fromX + (toX - fromX) * step / steps, fromY + (toY - fromY) * step / steps, 0.5);
            }
        }
        return points;
    };
    const rounded = (arrow: Arrow | undefined) => arrow && Object.values(arrow).map(Math.round);
    const start = [ 300, 100 ];
    const tip = [ 100, 100 ];

    it("takes a shaft and two barbs drawn from the tip as an arrow with even barbs", () => {
        // Barbs of 50 at 37 degrees and of 32 at 18 degrees give barbs of 41 at 28 degrees.
        const drawn = path(start, tip, [ 140, 70 ], tip, [ 130, 110 ]);
        expect(rounded(recognizeArrow(drawn, 20))).toEqual([ 300, 100, 100, 100, 41, 28 ]);

        // An arrow drawn with a pen comes back to its tip further out than it first got there.
        const { points } = parseInkDocument(JSON.stringify({ version: 1, strokes: [ { w: 3, p: PEN_ARROW } ] })).strokes[0];
        expect(rounded(recognizeArrow(points, 20))).toEqual([ 318, 215, 178, 218, 44, 27 ]);
    });

    it("leaves a stroke that is not an arrow as it is", () => {
        // A shaft alone, with one barb, and with both barbs on one side.
        expect(recognizeArrow(path(start, tip), 20)).toBeUndefined();
        expect(recognizeArrow(path(start, tip, [ 140, 70 ]), 20)).toBeUndefined();
        expect(recognizeArrow(path(start, tip, [ 140, 70 ], tip, [ 130, 85 ]), 20)).toBeUndefined();
        // A bent shaft, barbs across the shaft, barbs as long as the shaft and a small arrow.
        expect(recognizeArrow(path(start, [ 200, 160 ], tip, [ 140, 70 ], tip, [ 130, 110 ]), 20)).toBeUndefined();
        expect(recognizeArrow(path(start, tip, [ 105, 60 ], tip, [ 105, 140 ]), 20)).toBeUndefined();
        expect(recognizeArrow(path(start, tip, [ 260, 40 ], tip, [ 260, 160 ]), 20)).toBeUndefined();
        expect(recognizeArrow(path([ 115, 100 ], tip, [ 104, 97 ], tip, [ 104, 103 ]), 20)).toBeUndefined();
    });

    it("runs a stroke of one pressure along the shaft and both barbs, into the tip once smoothed", () => {
        const points = arrowToPoints({ fromX: 300, fromY: 100, toX: 100, toY: 100, barbLength: 40, barbAngle: 30 }, 0.4);
        expect(points.slice(0, 3)).toEqual([ 300, 100, 0.4 ]);
        expect(points.slice(-3).map((value) => Math.round(value * 10) / 10)).toEqual([ 134.6, 80, 0.4 ]);
        expect(points.length / 3).toBeLessThan(60);

        const smoothed = buildStrokePoints({ size: 3, simulatePressure: false, points });
        const nearest = (x: number, y: number) =>
            Math.min(...smoothed.map(({ point }) => Math.hypot(point[0] - x, point[1] - y)));
        expect(nearest(100, 100)).toBeLessThan(1);
        expect(nearest(134.6, 120)).toBeLessThan(1);
        expect(nearest(134.6, 80)).toBeLessThan(0.1);
        // A pen arrow goes through the same door as the closed shapes.
        expect(shapeToPoints(path(start, tip, [ 140, 70 ], tip, [ 130, 110 ]), 20, 0.5)?.slice(0, 2)).toEqual(start);
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

/**
 * A circle drawn with a pen on a tablet, as the saved `p` of its stroke. The stroke runs 42 units
 * past its start, up to halfway to the center.
 */
const PEN_CIRCLE = [
    5902, 2288, 1, -8, -8, 2, 0, -8, 4, -8, 0, 78, -15, 0, 6, -24, 8, 3, -24, 0, 5, -23, 0, 4,
    -16, 8, 2, -24, 0, 3, -16, 8, 4, -23, 8, 1, -24, 8, 2, -16, 8, 3, -16, 8, 2, -16, 15, 2,
    -15, 8, 2, -24, 8, 1, -16, 16, 3, -8, 8, 2, -16, 16, 2, -15, 8, 2, -8, 15, 2, -16, 16, 1,
    -8, 16, 2, -8, 8, 1, 0, 16, 1, -8, 16, 2, 0, 15, 0, -8, 16, 0, 0, 16, 1, 0, 16, 0,
    0, 16, 0, 8, 15, 2, 0, 16, 0, 0, 16, 0, 0, 16, 2, 8, 16, 0, 0, 15, 1, 8, 16, 1,
    8, 16, 1, 8, 16, 1, 8, 16, 2, 8, 8, 1, 8, 7, 1, 7, 16, 2, 8, 8, 2, 8, 8, 0,
    8, 8, 2, 16, 8, 3, 16, 8, 1, 16, 8, 1, 15, 8, 1, 16, 0, 2, 16, 7, 1, 16, 0, 0,
    16, 0, 0, 23, 0, 0, 24, 0, 2, 24, 0, 0, 23, -7, 0, 24, -8, -2, 24, 0, 1, 23, -8, 0,
    24, -8, -1, 24, -8, 0, 24, -8, 2, 23, -16, -2, 24, -8, 0, 24, -15, 2, 16, -16, 0, 15, -24, -1,
    8, -16, 1, 16, -16, 0, 8, -15, 0, 8, -16, 0, 8, -24, 0, 8, -16, 0, 8, -23, 1, 0, -8, -1,
    7, -24, 0, 0, -16, 0, 0, -16, 0, 0, -15, 1, 0, -16, 0, 0, -16, 1, 0, -16, 2, -7, -16, 1,
    0, -15, 2, -8, -8, 3, -8, -16, 2, -8, -16, 1, -8, -8, 3, -8, -16, 1, -16, -8, 1, -8, -15, 2,
    -23, -16, 1, -16, -16, 2, -16, -8, 2, -24, -16, 0, -15, -8, 2, -16, -8, 2, -24, -7, 1, -16, -16, 2,
    -24, -8, 1, -15, 0, 1, -24, -8, 2, -16, -8, 0, -24, 0, 2, -23, -8, 1, -16, 0, 0, -24, -8, 1,
    -23, 0, 1, -24, 0, 1, -16, 0, 1, -16, 0, 2, -23, 0, 2, -16, 0, 0, -16, 0, 2, -24, 0, 0,
    -8, 0, 2, -8, 0, 0, -15, 0, 0, -8, 0, 0, -16, 0, 0, -8, 8, 1, -8, 0, -1, -8, 0, 2,
    -8, 0, 1, -8, 8, 0, -8, 0, -176, 0, 8, -28
];

/**
 * An arrow drawn with a pen on a tablet, as the saved `p` of its stroke: the shaft, a barb out and
 * back to the tip, and the other barb.
 */
const PEN_ARROW = [
    3176, 2146, 3, 0, 8, 51, -8, 0, 1, 0, 8, 2, -8, 8, 4, -16, 0, 1, -15, 0, 2, -16, -8, 2,
    -24, 0, 2, -24, 0, 1, -23, 0, 3, -16, 0, 4, -24, -8, 2, -24, 0, 3, -23, 0, 2, -24, 0, 2,
    -24, -8, 2, -23, 0, 2, -32, 0, 1, -24, -8, 2, -23, 0, 1, -32, 0, 1, -24, 0, 1, -31, 0, 1,
    -32, 0, 1, -24, 0, 1, -31, 0, 0, -32, 0, 1, -39, 0, 1, -40, 0, 1, -47, 0, 1, -40, 0, 1,
    -39, 0, 1, -40, 0, 1, -39, 0, 1, -48, 0, 2, -31, 0, 0, -32, 0, 1, -32, 0, 0, -31, 0, 1,
    -24, 8, 1, -32, 0, 1, -15, 0, 0, -16, 0, 0, -24, 8, 0, -16, 0, 1, -15, 0, -1, -16, 0, 1,
    -8, 0, 0, -8, 0, 0, -16, 0, 0, -8, 0, 0, -8, 8, 0, -8, 0, 0, -7, 0, 0, -8, 0, 0,
    -16, 0, -1, -8, 0, 0, -8, 8, 1, -8, 0, -1, -16, 0, 0, -8, 0, 0, -15, 0, 0, -8, 0, 1,
    -8, 0, -1, -8, 0, 0, -8, 0, 1, -8, 7, -1, -8, 0, 1, -8, 0, 0, 8, 0, 15, 8, 0, -1,
    8, -7, 0, 8, 0, 1, 8, 0, 0, 8, -8, -1, 8, -8, 0, 15, -8, 0, 8, -8, 0, 16, -8, 0,
    8, -8, 0, 8, -8, 0, 16, -8, -1, 16, -8, 0, 7, -7, 1, 16, -16, -1, 8, -8, 0, 16, -8, 0,
    8, -8, 0, 8, -8, 0, 8, 0, 0, 8, -8, -1, 7, -8, 1, 8, -8, 1, 8, -8, -1, 8, 0, 1,
    8, 0, -1, 0, -7, 0, 8, 0, 1, 8, -8, -1, 8, -8, 1, 8, 0, 1, 8, 0, -1, 0, -8, 0,
    7, 0, 0, 8, 0, 1, 8, 0, 0, 8, -8, 0, -8, 8, -4, -16, 8, 1, -7, 8, -1, -8, 8, 0,
    -8, 0, 0, -16, 7, 0, -8, 8, 0, -16, 8, 0, -8, 0, 0, -15, 8, 0, -16, 8, 0, -8, 8, 0,
    -16, 8, 0, -16, 8, 0, -8, 8, 0, -15, 8, 0, -16, 8, 1, -16, 7, -1, -8, 8, 1, -16, 8, 0,
    -8, 0, 0, -8, 8, 0, -15, 8, 0, -8, 0, 0, -8, 8, 1, -8, 0, -1, -8, 8, 1, -8, 8, -1,
    -8, 0, 0, -8, 8, 1, -8, 8, 0, -8, 0, -2, 0, 7, 0, 0, 8, 0, 0, 8, 0, 0, 8, 0,
    8, 8, 3, 8, 0, -1, 8, 8, 1, 8, 0, 0, 8, 0, 0, 8, 8, 0, 8, 0, 0, 8, 0, 0,
    8, 0, 0, 8, 8, 0, 15, 0, 0, 8, 0, 0, 8, 8, 0, 16, 0, 0, 16, 8, 0, 16, 0, 0,
    15, 7, -1, 24, 8, 0, 16, 8, 0, 16, 8, -1, 15, 8, 0, 16, 0, 1, 16, 8, -1, 16, 8, 0,
    16, 8, 1, 8, 8, -1, 7, 0, 0, 16, 8, 0, 8, 0, -1, 8, 0, 0, 8, 7, 1, 8, 0, -1,
    8, 0, 2, 8, 8, 1, 8, 0, 1, 8, 8, 0, 7, 0, 1, 8, 0, 9, 8, 0, 0, 16, 0, 0,
    8, 0, 0, 8, 0, -1, 8, 8, -98, 8, 0, -21
];
