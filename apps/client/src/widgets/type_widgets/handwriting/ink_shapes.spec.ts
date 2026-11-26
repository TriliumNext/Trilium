import { describe, expect, it } from "vitest";

import { lineToPoints, recognizeLine } from "./ink_shapes";

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
