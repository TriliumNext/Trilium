import { describe, expect, it } from "vitest";

import { PANE_WIDTH, revealOffset } from "./utils";

/** A map 1200 × 800 at the origin of the page, with room for the pane beside the boxes. */
const MAP = { left: 0, top: 0, right: 1200, bottom: 800 };
/** Where the pane starts, in a left-to-right app: its width and the inset away from the right. */
const PANE_LEFT = MAP.right - 10 - PANE_WIDTH;

function box(left: number, top: number, width = 160, height = 50) {
    return { left, top, right: left + width, bottom: top + height };
}

describe("revealOffset", () => {
    it("leaves a box alone that already stands clear of the pane and the edges", () => {
        expect(revealOffset(box(100, 100), MAP, false)).toBeNull();
    });

    it("brings a box under the pane to the middle of what the pane leaves uncovered, horizontally only", () => {
        const offset = revealOffset(box(PANE_LEFT + 50, 300), MAP, false);
        const centre = (PANE_LEFT + 50 + 80) + (offset?.dx ?? 0);

        expect(offset?.dy).toBe(0);
        expect(centre).toBeCloseTo(PANE_LEFT / 2);
    });

    it("brings back a box off the top or down behind the foot toolbars", () => {
        expect(revealOffset(box(100, -40), MAP, false)?.dy).toBeGreaterThan(0);
        expect(revealOffset(box(100, MAP.bottom - 60), MAP, false)?.dy).toBeLessThan(0);
        expect(revealOffset(box(100, -40), MAP, false)?.dx).toBe(0);
    });

    it("keeps clear of the pane on the left in a right-to-left app", () => {
        expect(revealOffset(box(MAP.right - 200, 100), MAP, true)).toBeNull();
        expect(revealOffset(box(50, 100), MAP, true)?.dx).toBeGreaterThan(0);
    });

    it("only keeps the box on screen when the map is too narrow to leave room beside the pane", () => {
        const narrow = { ...MAP, right: PANE_WIDTH + 100 };

        expect(revealOffset(box(250, 100), narrow, false)).toBeNull();
        expect(revealOffset(box(-100, 100), narrow, false)?.dx).toBeGreaterThan(0);
    });
});
