import { describe, expect, it } from "vitest";

import {
    AUTO_COLOR, createStroke, parseInkDocument, serializeInkDocument, strokeHitsSegment, StrokeIndex
} from "./ink_document";

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

    it("falls back to an empty ruled page for missing or broken content", () => {
        for (const content of [ "", null, "{", "{}", JSON.stringify({ strokes: [ { p: [ 1 ] } ] }) ]) {
            expect(parseInkDocument(content)).toEqual({ paper: "ruled", strokes: [] });
        }
        expect(parseInkDocument(JSON.stringify({ paper: "plaid", strokes: [] })).paper).toBe("ruled");
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
