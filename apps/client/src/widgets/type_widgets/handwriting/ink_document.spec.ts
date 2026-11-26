import { getStroke } from "perfect-freehand";
import { describe, expect, it } from "vitest";

import {
    AUTO_COLOR, buildStrokePoints, createStroke, getStrokeOutline, outlineStrokePoints,
    parseInkDocument, serializeInkDocument, StrokeBuilder, strokeHitsSegment, StrokeIndex
} from "./ink_document";

function distanceToPolygon(x: number, y: number, polygon: number[][]) {
    let closest = Infinity;
    for (const [ index, [ ax, ay ] ] of polygon.entries()) {
        const [ bx, by ] = polygon[(index + 1) % polygon.length];
        const dx = bx - ax;
        const dy = by - ay;
        const lengthSquared = dx * dx + dy * dy;
        const t = lengthSquared ? Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / lengthSquared)) : 0;
        closest = Math.min(closest, Math.hypot(ax + t * dx - x, ay + t * dy - y));
    }
    return closest;
}

/** A wavy line of `count` raw points with a varying pressure, as a pen draws it. */
function wavyPoints(count: number) {
    const points: number[] = [];
    for (let i = 0; i < count; i++) {
        points.push(i * 1.7, Math.sin(i / 4) * 20 + (i % 3) * 0.4, 0.3 + 0.5 * Math.abs(Math.sin(i / 9)));
    }
    return points;
}

function makeStroke(points: number[], order = 0) {
    return createStroke({
        tool: "pen", color: AUTO_COLOR, size: 4, simulatePressure: false, points, order
    });
}

describe("ink document", () => {
    it("round-trips strokes through the delta-encoded format", () => {
        const pen = makeStroke([ 10, 20, 0.5, 12.34, 25.67, 1, -3.2, 8, 0 ], 1);
        const highlighter = createStroke({
            tool: "highlighter", color: "#ff0000", size: 15, simulatePressure: true,
            points: [ 0, 0, 0.5, 100, 0, 0.5 ], order: 0
        });

        const content = serializeInkDocument("grid", [ pen, highlighter ]);
        const raw = JSON.parse(content);
        expect(raw.strokes[0]).toEqual({ t: "h", c: "#ff0000", w: 15, s: 1, p: [ 0, 0, 128, 1000, 0, 0 ] });
        expect(raw.strokes[1].p).toEqual([ 100, 200, 128, 23, 57, 127, -155, -177, -255 ]);

        const doc = parseInkDocument(content);
        expect(doc.paper).toBe("grid");
        expect(doc.strokes.map((stroke) => [ stroke.tool, stroke.order ])).toEqual([
            [ "highlighter", 0 ], [ "pen", 1 ]
        ]);
        const [ x, y, pressure ] = doc.strokes[1].points.slice(3, 6);
        expect([ x, y ]).toEqual([ 12.3, 25.7 ]);
        expect(pressure).toBe(1);
        expect(doc.strokes[1].bounds).toEqual({ minX: -7.2, minY: 4, maxX: 16.3, maxY: 29.7 });
    });

    it("joins the JSON that each stroke keeps from its first save", () => {
        const strokes = [ makeStroke([ 1, 2, 0.5, 3, 4, 0.5 ], 0), makeStroke([ 5, 6, 1 ], 1) ];
        const content = serializeInkDocument("dots", strokes);
        expect(content).toBe(JSON.stringify(JSON.parse(content)));
        expect(strokes[0].json).toBe(JSON.stringify(JSON.parse(content).strokes[0]));

        strokes[0].points[0] = 100;
        expect(serializeInkDocument("dots", strokes)).toBe(content);
    });

    it("saves the view rounded, and reads it back only when it is whole", () => {
        const content = serializeInkDocument("ruled", [], { x: 12.345, y: -6.789, zoom: 0.83333 });
        expect(parseInkDocument(content).view).toEqual({ x: 12.3, y: -6.8, zoom: 0.833 });
        expect(parseInkDocument(serializeInkDocument("ruled", [])).view).toBeUndefined();
        for (const view of [ { x: 1, y: 2 }, { x: 1, y: "2", zoom: 1 }, { x: 1, y: 2, zoom: 0 }, [] ]) {
            expect(parseInkDocument(JSON.stringify({ strokes: [], view })).view).toBeUndefined();
        }
    });

    it("falls back to an empty ruled page for missing or broken content", () => {
        for (const content of [ "", null, "{", "{}", JSON.stringify({ strokes: [ { p: [ 1 ] } ] }) ]) {
            expect(parseInkDocument(content)).toEqual({ paper: "ruled", strokes: [] });
        }
        expect(parseInkDocument(JSON.stringify({ paper: "plaid", strokes: [] })).paper).toBe("ruled");
    });

    it("outlines a pen stroke as perfect-freehand does, built all at once or point by point", () => {
        const stroke = makeStroke(wavyPoints(300));
        const raw: number[][] = [];
        for (let i = 0; i < stroke.points.length; i += 3) {
            raw.push(stroke.points.slice(i, i + 3));
        }
        const expected = getStroke(raw, {
            size: 4, thinning: 0.6, smoothing: 0.5, streamline: 0.35, simulatePressure: false, last: true
        });
        expect(getStrokeOutline(stroke)).toEqual(expected);

        const builder = new StrokeBuilder(stroke);
        for (let i = 0; i + 5 < stroke.points.length; i += 3) {
            builder.add(stroke.points[i], stroke.points[i + 1], stroke.points[i + 2]);
        }
        const finished = buildStrokePoints(stroke);
        expect(builder.points).toEqual(finished.slice(0, -1));

        const before = builder.points.length;
        const preview = builder.preview(stroke.points.slice(-3));
        expect(builder.points).toHaveLength(before);
        expect(preview).toHaveLength(1);
        expect(preview[0].point).not.toEqual(finished[finished.length - 1].point);
    });

    it("gives a run of stroke points the width it has in the whole stroke", () => {
        for (const simulatePressure of [ false, true ]) {
            const stroke = createStroke({
                tool: "pen", color: AUTO_COLOR, size: 4, simulatePressure, points: wavyPoints(200), order: 0
            });
            const points = buildStrokePoints(stroke);
            const whole = outlineStrokePoints(stroke, points);
            const run = outlineStrokePoints(stroke, points.slice(100));
            const [ startX, startY ] = points[100].point;
            const [ endX, endY ] = points[points.length - 1].point;

            // Away from the round caps at both ends of the run, its outline lies on the whole one.
            const sides = run.filter(([ x, y ]) =>
                Math.hypot(x - startX, y - startY) > 8 && Math.hypot(x - endX, y - endY) > 8);
            expect(sides.length).toBeGreaterThan(50);
            for (const [ x, y ] of sides) {
                expect(distanceToPolygon(x, y, whole)).toBeLessThan(0.05);
            }
        }
    });

    it("hits a stroke only where the eraser reaches its centerline", () => {
        const stroke = makeStroke([ 0, 0, 0.5, 100, 0, 0.5 ]);
        expect(strokeHitsSegment(stroke, 50, -20, 50, 20, 1)).toBe(true);
        expect(strokeHitsSegment(stroke, 50, 5, 60, 5, 4)).toBe(true);
        expect(strokeHitsSegment(stroke, 50, 7, 60, 7, 4)).toBe(false);
        expect(strokeHitsSegment(stroke, 110, -20, 110, 20, 4)).toBe(false);

        const dot = makeStroke([ 10, 10, 0.5 ]);
        expect(strokeHitsSegment(dot, 0, 10, 20, 10, 1)).toBe(true);
        expect(strokeHitsSegment(dot, 0, 20, 20, 20, 1)).toBe(false);
    });

    it("finds strokes by area in drawing order and forgets removed ones", () => {
        const far = makeStroke([ 5000, 5000, 0.5, 5010, 5010, 0.5 ], 0);
        const late = makeStroke([ 0, 0, 0.5, 600, 0, 0.5 ], 2);
        const early = makeStroke([ 10, 10, 0.5, 20, 20, 0.5 ], 1);
        const index = new StrokeIndex();
        for (const stroke of [ far, late, early ]) {
            index.add(stroke);
        }

        const area = { minX: -10, minY: -10, maxX: 50, maxY: 50 };
        expect(index.query(area)).toEqual([ early, late ]);
        expect(index.query({ minX: 590, minY: -10, maxX: 700, maxY: 10 })).toEqual([ late ]);

        index.remove(late);
        expect(index.query(area)).toEqual([ early ]);
    });
});
