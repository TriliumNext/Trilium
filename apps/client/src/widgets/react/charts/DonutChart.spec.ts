import { describe, expect, it } from "vitest";

import { computeDonutLayout } from "./DonutChart";

describe("computeDonutLayout", () => {
    it("distributes values proportionally, in order, shaving the gap off both ends", () => {
        const [ first, second ] = computeDonutLayout([ 75, 25 ], 100, 4);

        expect(first).toEqual({ length: 71, offset: 2 });
        expect(second).toEqual({ length: 21, offset: 77 });
    });

    it("keeps a lone segment a closed circle", () => {
        expect(computeDonutLayout([ 42 ], 100, 4)).toEqual([ { length: 100, offset: 0 } ]);
    });

    it("keeps slivers at their full span instead of vanishing into the gap", () => {
        const layout = computeDonutLayout([ 995, 5 ], 1000, 4);

        // 5 units ≤ twice the gap: drawn whole, no shaving.
        expect(layout[1]).toEqual({ length: 5, offset: 995 });
    });

    it("paints nothing for empty or negative values while spacing the rest correctly", () => {
        const layout = computeDonutLayout([ 50, 0, -3, 50 ], 100, 4);

        expect(layout[1]).toBeNull();
        expect(layout[2]).toBeNull();
        expect(layout[0]).toEqual({ length: 46, offset: 2 });
        expect(layout[3]).toEqual({ length: 46, offset: 52 });
    });

    it("returns only nulls when there is nothing to paint", () => {
        expect(computeDonutLayout([ 0, 0 ], 100, 4)).toEqual([ null, null ]);
        expect(computeDonutLayout([], 100, 4)).toEqual([]);
    });
});
