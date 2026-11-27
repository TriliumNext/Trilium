import { getStroke } from "perfect-freehand";
import { describe, expect, it } from "vitest";

import {
    AUTO_COLOR, buildStrokePoints, createImage, createStroke, getPageCount, getStrokeOutline, getVisiblePage,
    outlineStrokePoints, parseInkDocument, serializeInkDocument, serializeStroke, splitStroke, type Stroke, StrokeBuilder,
    strokeHitsSegment, StrokeIndex, trimPrediction
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
        expect(content).toContain(`{"t":"h","c":"#ff0000","w":15,"s":1,"p":[`);
        expect(raw.strokes[1]).toEqual({ w: 4, p: [ 100, 200, 128, 23, 57, 127, -155, -177, -255 ] });

        const doc = parseInkDocument(content);
        expect(doc.paper).toBe("grid");
        expect(doc.strokes.map((stroke) => [ stroke.tool, stroke.order ])).toEqual([
            [ "highlighter", 0 ], [ "pen", 1 ]
        ]);
        const [ x, y, pressure ] = doc.strokes[1].points.slice(3, 6);
        expect([ x, y ]).toEqual([ 12.3, 25.7 ]);
        expect(pressure).toBe(1);
        expect(doc.strokes[1].bounds).toEqual({ minX: -7.2, minY: 4, maxX: 16.3, maxY: 29.7 });
        expect(doc.strokes[1].color).toBe(AUTO_COLOR);
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

    it("keeps the layout, and opens a note saved before pages on a canvas without bounds", () => {
        const stroke = makeStroke([ 1, 2, 0.5 ]);
        expect(parseInkDocument(serializeInkDocument("ruled", [ stroke ], undefined, "infinite")).layout).toBe("infinite");
        expect(parseInkDocument(serializeInkDocument("ruled", [ stroke ])).layout).toBe("pages");

        const older = { version: 1, paper: "ruled", strokes: [ JSON.parse(serializeStroke(stroke)) ] };
        expect(parseInkDocument(JSON.stringify(older)).layout).toBe("infinite");
        expect(parseInkDocument(JSON.stringify({ ...older, strokes: [] })).layout).toBe("pages");
        expect(parseInkDocument(JSON.stringify({ ...older, layout: "scroll" })).layout).toBe("infinite");
    });

    it("saves the images in drawing order, and reads back only those of the note's attachments", () => {
        const url = "api/attachments/abc_123/image/exercise%201.png";
        const first = createImage({ url, x: 10.04, y: 20, width: 300.26, height: 150, order: 0 });
        const second = createImage({ url, x: 0, y: 2000, width: 50, height: 50, order: 1 });
        expect(serializeInkDocument("ruled", [], undefined, "pages")).not.toContain("images");

        const saved = serializeInkDocument("ruled", [], undefined, "pages", [ second, first ]);
        expect(JSON.parse(saved).images).toEqual([
            { url, x: 10, y: 20, w: 300.3, h: 150 },
            { url, x: 0, y: 2000, w: 50, h: 50 }
        ]);
        const images = parseInkDocument(saved).images ?? [];
        expect(images.map((image) => image.order)).toEqual([ 0, 1 ]);
        expect(images[0].bounds).toEqual({ minX: 10, minY: 20, maxX: 310.3, maxY: 170 });
        // The second image is on the second page, which shows a third one after it.
        expect(getPageCount(images)).toBe(3);

        const rect = { x: 0, y: 0, w: 10, h: 10 };
        const parsed = parseInkDocument(JSON.stringify({ version: 1, paper: "ruled", strokes: [], images: [
            { ...rect, url: "https://example.com/tracker.png" },
            { ...rect, url: "api/attachments/abc/image/a.png?x=1" },
            { ...rect, url: "api/attachments/abc/image/../../notes/a" },
            { ...rect, url, w: 0 },
            { ...rect, url, x: "1" },
            null,
            { ...rect, url }
        ] }));
        expect(parsed.images).toHaveLength(1);
        expect(parseInkDocument(JSON.stringify({ version: 1, strokes: [], images: "none" })).images).toEqual([]);
    });

    it("saves the PDF of the note, and reads back only one of the note's attachments", () => {
        const pdf = "api/attachments/abc_123/open";
        const saved = serializeInkDocument("ruled", [], undefined, "pages", [], pdf);
        expect(JSON.parse(saved).pdf).toBe(pdf);
        expect(parseInkDocument(saved).pdf).toBe(pdf);
        for (const other of [ "https://example.com/a.pdf", "api/attachments/abc/open?x=1", "api/notes/abc/open", 5 ]) {
            const parsed = parseInkDocument(JSON.stringify({ version: 1, paper: "ruled", strokes: [], pdf: other }));
            expect(parsed).not.toHaveProperty("pdf");
        }
    });

    it("falls back to an empty ruled page for missing or broken content", () => {
        for (const content of [ "", null, "{", "{}", JSON.stringify({ strokes: [ { p: [ 1 ] } ] }) ]) {
            expect(parseInkDocument(content)).toEqual({ paper: "ruled", layout: "pages", strokes: [], images: [] });
        }
        expect(parseInkDocument(JSON.stringify({ paper: "plaid", strokes: [] })).paper).toBe("ruled");
    });

    it("keeps the width of a saved stroke within the tools' range and drops strokes with bad points", () => {
        const strokes = [
            { w: 1e9, p: [ 0, 0, 128 ] },
            { w: -4, p: [ 0, 0, 128 ] },
            { w: "4", p: [ 0, 0, 128 ] },
            { w: 2, p: [ 0, 0, 128, "x", 1, 0 ] },
            { w: 2, p: [ 0, 0, 128, 1e308, 1e308, 0, 1e308, 1e308, 0 ] },
            { w: 2, p: [ 0, 0, null ] }
        ];
        const parsed = parseInkDocument(JSON.stringify({ version: 1, strokes })).strokes;
        expect(parsed.map((stroke) => stroke.size)).toEqual([ 60, 3, 3 ]);
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

    it("keeps the pressure sensitivity each stroke was drawn with", () => {
        const points = wavyPoints(100);
        const raw: number[][] = [];
        for (let i = 0; i < points.length; i += 3) raw.push(points.slice(i, i + 3));
        const outlineAt = (thinning: number) => getStroke(raw, {
            size: 4, thinning, smoothing: 0.5, streamline: 0.35, simulatePressure: false, last: true
        });
        const pen = (sensitivity?: number) => createStroke({
            tool: "pen", color: AUTO_COLOR, size: 4, simulatePressure: false, points, order: 0, sensitivity
        });

        // A stroke saves its own sensitivity, and its outline follows it.
        const soft = pen(20);
        expect(JSON.parse(serializeStroke(soft)).k).toBe(20);
        const [ parsed ] = parseInkDocument(serializeInkDocument("ruled", [ soft ])).strokes;
        expect(parsed.sensitivity).toBe(20);
        expect(getStrokeOutline(soft)).toEqual(outlineAt(0.2));
        expect(getStrokeOutline(pen(0))).toEqual(outlineAt(0));

        // The default is left out, and a stroke saved without one outlines as before the setting.
        expect(JSON.parse(serializeStroke(pen(60)))).not.toHaveProperty("k");
        const [ older ] = parseInkDocument(JSON.stringify({ strokes: [ { w: 4, p: [ 0, 0, 128, 10, 0, 255 ] } ] })).strokes;
        expect(older.sensitivity).toBeUndefined();
        expect(getStrokeOutline(pen())).toEqual(outlineAt(0.6));

        // A saved value out of range is brought back into it, and one that is not a number is dropped.
        const saved = [ 150, -5, "40" ].map((k) => ({ w: 4, k, p: [ 0, 0, 128 ] }));
        expect(parseInkDocument(JSON.stringify({ strokes: saved })).strokes.map((stroke) => stroke.sensitivity))
            .toEqual([ 100, 0, undefined ]);

        // The highlighter keeps its width whatever the pressure.
        const highlighter = createStroke({
            tool: "highlighter", color: AUTO_COLOR, size: 4, simulatePressure: false, points, order: 0, sensitivity: 90
        });
        expect(getStrokeOutline(highlighter)).toEqual(outlineAt(0));
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

    it("indexes a stroke that spans the world, and answers a query over all of it, without a cell each", () => {
        const wide = makeStroke([ -1e12, -1e12, 0.5, 1e12, 1e12, 0.5 ], 1);
        const small = makeStroke([ 10, 10, 0.5, 20, 20, 0.5 ], 0);
        const index = new StrokeIndex();
        index.add(wide);
        index.add(small);

        expect(index.query({ minX: 0, minY: 0, maxX: 50, maxY: 50 })).toEqual([ small, wide ]);
        expect(index.query({ minX: -Infinity, minY: -Infinity, maxX: Infinity, maxY: Infinity }))
            .toEqual([ small, wide ]);
        expect(index.query({ minX: 5000, minY: 5000, maxX: 5100, maxY: 5100 })).toEqual([ wide ]);

        index.remove(wide);
        expect(index.query({ minX: -1e9, minY: -1e9, maxX: 1e9, maxY: 1e9 })).toEqual([ small ]);
        index.clear();
        expect(index.query({ minX: 0, minY: 0, maxX: 50, maxY: 50 })).toEqual([]);
    });
});

describe("trimPrediction", () => {
    it("keeps predicted points that continue the last move, no farther than that move went", () => {
        // Moving right by 10: the prediction runs on in the same direction.
        expect(trimPrediction(0, 0, 10, 0, [ 14, 0, 0.5, 18, 1, 0.6 ])).toEqual([ 14, 0, 0.5, 18, 1, 0.6 ]);

        // The prediction overshoots: it stops at 10 past the pointer, along the last kept step.
        expect(trimPrediction(0, 0, 10, 0, [ 16, 0, 0.5, 30, 0, 0.5 ])).toEqual([ 16, 0, 0.5, 20, 0, 0.5 ]);

        // The prediction turns back against the move: nothing from there on is kept.
        expect(trimPrediction(0, 0, 10, 0, [ 12, 0, 0.5, 11, 3, 0.5, 15, 0, 0.5 ])).toEqual([ 12, 0, 0.5 ]);
        expect(trimPrediction(0, 0, 10, 0, [ 7, 0, 0.5 ])).toEqual([]);

        // A pointer that has stopped predicts nothing.
        expect(trimPrediction(10, 0, 10, 0, [ 14, 0, 0.5 ])).toEqual([]);
    });
});

describe("getVisiblePage", () => {
    it("picks the page that fills most of the view, the first of those that tie", () => {
        // Pages span 0-1123, 1147-2270 and 2294-3417.
        expect(getVisiblePage(-32, 500, 3)).toBe(0);
        expect(getVisiblePage(1000, 1600, 3)).toBe(1);
        expect(getVisiblePage(1100, 1300, 3)).toBe(1);
        // Zoomed out, the first page shown whole wins over the whole one below it.
        expect(getVisiblePage(1100, 4000, 3)).toBe(1);
        // Past either end of the pages, the nearest one.
        expect(getVisiblePage(-900, -100, 3)).toBe(0);
        expect(getVisiblePage(5000, 6000, 3)).toBe(2);
    });
});

describe("splitStroke", () => {
    /** A straight line along the x axis from 0 to `length`, with a raw point every `step`. */
    function linePoints(length: number, step: number, pressure: (x: number) => number) {
        const points: number[] = [];
        for (let x = 0; x <= length; x += step) points.push(x, 0, pressure(x));
        return points;
    }
    const xsOf = (stroke: Stroke) => stroke.points.filter((_, i) => i % 3 === 0);

    it("cuts out the ink the eraser covers, and keeps the pieces on either side", () => {
        // Without thinning, the ink reaches 2 from the centerline, so an eraser of 8 cuts 10 away.
        const stroke = createStroke({
            tool: "pen", color: "#e64d4d", size: 4, simulatePressure: false, sensitivity: 0, order: 7,
            points: linePoints(100, 10, (x) => x / 100)
        });

        const tapped = splitStroke(stroke, 55, 0, 55, 0, 8);
        expect(tapped?.map(xsOf)).toEqual([ [ 0, 10, 20, 30, 40, 45 ], [ 65, 70, 80, 90, 100 ] ]);
        const [ before, after ] = tapped ?? [];
        expect(before.points.at(-1)).toBeCloseTo(0.45);
        expect(after.points[2]).toBeCloseTo(0.65);
        expect(before.bounds.maxX).toBe(49);
        expect(after).toMatchObject({
            tool: "pen", color: "#e64d4d", size: 4, simulatePressure: false, sensitivity: 0, order: 7
        });

        // Across the stroke, and along it a little to one side.
        expect(splitStroke(stroke, 55, -30, 55, 30, 8)?.map(xsOf))
            .toEqual([ [ 0, 10, 20, 30, 40, 45 ], [ 65, 70, 80, 90, 100 ] ]);
        const dragged = splitStroke(stroke, 20, 5, 50, 5, 8)?.map(xsOf) ?? [];
        expect(dragged).toHaveLength(2);
        expect(dragged[0].slice(0, 2)).toEqual([ 0, 10 ]);
        expect(dragged[0][2]).toBeCloseTo(20 - Math.sqrt(75));
        expect(dragged[1][0]).toBeCloseTo(50 + Math.sqrt(75));
        expect(dragged[1].slice(1)).toEqual([ 60, 70, 80, 90, 100 ]);

        // The same eraser leaves the pieces it cut alone, as it does when it rests or moves back.
        expect(splitStroke(before, 55, 0, 55, 0, 8)).toBeUndefined();
        expect(splitStroke(after, 55, 0, 55, 0, 8)).toBeUndefined();
        for (const piece of splitStroke(stroke, 20, 5, 50, 5, 8) ?? []) {
            expect(splitStroke(piece, 20, 5, 50, 5, 8)).toBeUndefined();
        }

        // At an end, only one piece is left; over the whole stroke, none.
        expect(splitStroke(stroke, 0, 0, 0, 0, 8)?.map(xsOf)).toEqual([ [ 10, 20, 30, 40, 50, 60, 70, 80, 90, 100 ] ]);
        expect(splitStroke(stroke, -20, 0, 120, 0, 8)).toEqual([]);

        // Missing the ink leaves the stroke as it is.
        expect(splitStroke(stroke, 55, 10.1, 55, 10.1, 8)).toBeUndefined();
        expect(splitStroke(stroke, 55, 9.9, 55, 9.9, 8)).toHaveLength(2);

        const dot = createStroke({ ...stroke, points: [ 5, 5, 0.5 ] });
        expect(splitStroke(dot, 12, 5, 12, 5, 8)).toEqual([]);
        expect(splitStroke(dot, 20, 5, 20, 5, 8)).toBeUndefined();
    });

    it("ends each piece where its round end meets the eraser, however hard the pen pressed", () => {
        // At full pressure and sensitivity, the ink reaches 6 from the centerline, not 3.
        const stroke = createStroke({
            tool: "pen", color: AUTO_COLOR, size: 6, simulatePressure: false, sensitivity: 100, order: 0,
            points: wavyPoints(80).map((value, i) => i % 3 === 2 ? 1 : value)
        });
        const [ eraserX, eraserY ] = [ stroke.points[120], stroke.points[121] ];
        const pieces = splitStroke(stroke, eraserX, eraserY, eraserX, eraserY, 8) ?? [];
        expect(pieces).toHaveLength(2);
        for (const piece of pieces) {
            const closest = Math.min(...getStrokeOutline(piece).map(([ x, y ]) => Math.hypot(x - eraserX, y - eraserY)));
            expect(closest).toBeGreaterThan(7.9);
            expect(closest).toBeLessThan(8.5);
        }
    });

    it("keeps the width of a stroke that follows the speed", () => {
        // A slow stroke grows from the starting pressure of 0.5 over its first hundred points.
        const stroke = createStroke({
            tool: "pen", color: AUTO_COLOR, size: 4, simulatePressure: true, order: 0,
            points: linePoints(150, 0.5, () => 0.5)
        });
        const pieces = splitStroke(stroke, 100, 0, 100, 0, 8) ?? [];
        expect(pieces).toHaveLength(2);
        expect(pieces[1].simulatePressure).toBe(false);

        const original = getStrokeOutline(stroke);
        for (const [ piece, x ] of [ [ pieces[0], 50 ], [ pieces[1], 125 ] ] as const) {
            expect(distanceToPolygon(x, 0, getStrokeOutline(piece))).toBeCloseTo(distanceToPolygon(x, 0, original), 2);
        }
    });
});
