import { describe, expect, it } from "vitest";

import { type Box, type ConnectionShape, layoutConnections, layoutLine } from "./geometry";

const boxA: Box = { x: 0, y: 0, width: 100, height: 40 };
const boxB: Box = { x: 300, y: 0, width: 100, height: 40 };

describe("relation map geometry", () => {
    it("runs a line between the facing borders, with an arrowhead at the target only", () => {
        const layout = layoutLine(boxA, boxB, { labelAt: [ 0.5 ] });

        expect(layout?.path).toBe("M 103 20 Q 200 20 297 20");
        expect(layout?.arrows).toHaveLength(1);
        expect(arrowTip(layout?.arrows[0])).toEqual({ x: 297, y: 20 });
        expect(layout?.labels).toEqual([ { x: 200, y: 20, angle: 0, side: "below" } ]);

        const both = layoutLine(boxA, boxB, { arrowAtSource: true });
        expect(both?.arrows.map(arrowTip)).toEqual([ { x: 297, y: 20 }, { x: 103, y: 20 } ]);
    });

    it("runs a line between nearby boxes of different sizes, across the gap between them", () => {
        const narrow: Box = { x: 0, y: 0, width: 150, height: 40 };
        const wide: Box = { x: 200, y: 0, width: 300, height: 40 };
        const tall: Box = { x: 200, y: -80, width: 300, height: 200 };

        for (const target of [ wide, tall ]) {
            const layout = layoutLine(narrow, target);
            expect(layout?.path).toBe("M 153 20 Q 175 20 197 20");
            expect(arrowTip(layout?.arrows[0])).toEqual({ x: 197, y: 20 });
        }
        expect(layoutLine(wide, narrow, { bend: 15 })).not.toBeNull();
    });

    it("turns a label along its line and keeps it upright", () => {
        const upward = layoutLine(boxB, { ...boxA, y: 300 }, { labelAt: [ 0.5 ] })?.labels[0];
        expect(upward?.angle).toBe(-45);
        expect(upward?.side).toBe("below");
    });

    it("draws a relation being created up to the pointer, and nothing from inside its own box", () => {
        expect(layoutLine(boxA, { x: 250, y: 20 })?.path).toBe("M 103 20 Q 176.5 20 250 20");
        expect(layoutLine(boxA, { x: 60, y: 30 })).toBeNull();
    });

    it("bows relations between the same two boxes apart, whichever way they run", () => {
        const layouts = layoutConnections([
            shape("ab", "a", "b"),
            shape("ba", "b", "a"),
            shape("single", "a", "c")
        ], new Map([ [ "a", boxA ], [ "b", boxB ], [ "c", { ...boxB, y: 300 } ] ]));

        const offset = (id: string) => (layouts.get(id)?.labels[0].y ?? 20) - 20;
        expect(offset("ab") * offset("ba")).toBeLessThan(0);
        expect(Math.abs(offset("ab") - offset("ba"))).toBeGreaterThan(20);
        expect([ layouts.get("ab")?.labels[0].side, layouts.get("ba")?.labels[0].side ].sort()).toEqual([ "above", "below" ]);
        expect(layouts.get("ab")?.labels[0].side).toBe(offset("ab") < 0 ? "above" : "below");
        expect(layouts.get("single")?.path).toMatch(/^M [\d.]+ [\d.]+ Q 200 170 /);
    });

    it("loops a relation to its own box around the top-right corner, each further loop wider", () => {
        const layouts = layoutConnections([
            { ...shape("first", "a", "a"), labelAt: [ 0.5 ] },
            shape("second", "a", "a")
        ], new Map([ [ "a", boxA ] ]));

        expect(layouts.get("first")?.path).toBe("M 82 0 A 18 18 0 1 1 100 18");
        expect(layouts.get("second")?.path).toBe("M 72 0 A 28 28 0 1 1 100 28");
        expect(arrowTip(layouts.get("first")?.arrows[0])).toEqual({ x: 100, y: 18 });
        const label = layouts.get("first")?.labels[0];
        expect([ label?.angle, label?.side ]).toEqual([ 0, "end" ]);
        expect([ label?.x, label?.y ].map((value) => Math.round(value ?? 0))).toEqual([ 113, -13 ]);
    });

    it("leaves out a relation whose box is not measured yet", () => {
        expect(layoutConnections([ shape("ab", "a", "b") ], new Map([ [ "a", boxA ] ])).size).toBe(0);
    });
});

function shape(id: string, sourceId: string, targetId: string): ConnectionShape {
    return { id, sourceId, targetId, arrowAtSource: false, labelAt: [ 0.5 ] };
}

/** The first point of an arrowhead outline, which is its tip. */
function arrowTip(points: string | undefined) {
    const [ x, y ] = (points ?? "").split(" ")[0].split(",").map(Number);
    return { x, y };
}
