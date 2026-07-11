import type { GridStack } from "gridstack";
import { describe, expect, it } from "vitest";

import { computeDropCell, DEFAULT_WIDGET_SIZE, GRID_COLUMNS, reconcilePersistedLayout, sameLayout, WidgetLayouts } from "./layout";

/** Minimal GridStack stand-in exposing only what computeDropCell reads. */
function fakeGrid({ columns = GRID_COLUMNS, cellHeight = 80 }: { columns?: number; cellHeight?: number } = {}) {
    return { getColumn: () => columns, getCellHeight: () => cellHeight } as unknown as GridStack;
}

/** Container whose rect is a 1200×600 box at the origin → cells are 100px wide. */
function fakeContainer(rect: Partial<DOMRect> = {}) {
    const full = { left: 0, top: 0, width: 1200, height: 600, ...rect } as DOMRect;
    return { getBoundingClientRect: () => full } as HTMLElement;
}

describe("computeDropCell", () => {
    it("maps a drop position to the grid cell under the cursor", () => {
        // 1200px / 12 columns = 100px per column; cellHeight 80px.
        const cell = computeDropCell(fakeGrid(), fakeContainer(), { clientX: 250, clientY: 170 });
        expect(cell).toEqual({ x: 2, y: 2 });
    });

    it("accounts for the container's offset on screen", () => {
        const cell = computeDropCell(fakeGrid(), fakeContainer({ left: 100, top: 50 }), { clientX: 350, clientY: 210 });
        // (350-100)/100 = 2.5 → 2; (210-50)/80 = 2 → 2
        expect(cell).toEqual({ x: 2, y: 2 });
    });

    it("clamps x so a default-width widget never overflows the grid", () => {
        const cell = computeDropCell(fakeGrid(), fakeContainer(), { clientX: 1190, clientY: 0 });
        expect(cell?.x).toBe(GRID_COLUMNS - DEFAULT_WIDGET_SIZE.w);
    });

    it("clamps negative coordinates (dropped above/left of the grid) to zero", () => {
        const cell = computeDropCell(fakeGrid(), fakeContainer({ left: 100, top: 100 }), { clientX: 20, clientY: 20 });
        expect(cell).toEqual({ x: 0, y: 0 });
    });

    it("returns null in collapsed single-column mode so the caller auto-positions", () => {
        expect(computeDropCell(fakeGrid({ columns: 1 }), fakeContainer(), { clientX: 100, clientY: 100 })).toBeNull();
    });

    it("returns null when the grid has no measurable geometry yet", () => {
        expect(computeDropCell(fakeGrid({ cellHeight: 0 }), fakeContainer(), { clientX: 100, clientY: 100 })).toBeNull();
        expect(computeDropCell(fakeGrid(), fakeContainer({ width: 0 }), { clientX: 100, clientY: 100 })).toBeNull();
    });
});

describe("reconcilePersistedLayout", () => {
    const archived = { x: 5, y: 3, w: 4, h: 3 };
    const normal = { x: 0, y: 0, w: 4, h: 3 };

    it("retains a widget's saved position while it is filtered out of the grid (archived hidden → shown)", () => {
        // Archived notes shown: both widgets live in the grid and are persisted together.
        const shown: WidgetLayouts = { archived, normal };

        // Archived notes hidden: only the normal widget remains in the grid. Persisting the layout
        // now must not drop the archived widget's geometry just because it is no longer rendered —
        // it is still a child of the dashboard, so re-showing it should restore its placement
        // instead of auto-positioning it.
        const afterHide = reconcilePersistedLayout(shown, { normal }, new Set([ "archived", "normal" ]));
        expect(afterHide).toEqual({ archived, normal });
    });

    it("applies position changes and additions coming from the grid", () => {
        const previous: WidgetLayouts = { a: normal };
        const next = reconcilePersistedLayout(previous, { a: { ...normal, x: 6 }, b: archived }, new Set([ "a", "b" ]));
        // Moved widgets win over their previous geometry, and brand-new widgets are included.
        expect(next).toEqual({ a: { ...normal, x: 6 }, b: archived });
    });

    it("prunes the saved position of a widget whose note is no longer a child of the dashboard", () => {
        // `removed` is absent from the grid AND no longer a live child (its branch was deleted) —
        // its stale geometry must be dropped so the persisted layout doesn't grow unbounded.
        const previous: WidgetLayouts = { normal, removed: archived };
        const next = reconcilePersistedLayout(previous, { normal }, new Set([ "normal" ]));
        expect(next).toEqual({ normal });
    });

    it("keeps a hidden child but prunes a removed note in the same pass", () => {
        const previous: WidgetLayouts = { normal, hidden: archived, removed: { x: 8, y: 8, w: 1, h: 1 } };
        const next = reconcilePersistedLayout(previous, { normal }, new Set([ "normal", "hidden" ]));
        expect(next).toEqual({ normal, hidden: archived });
    });
});

describe("sameLayout", () => {
    const base: WidgetLayouts = { a: { x: 0, y: 0, w: 4, h: 3 }, b: { x: 4, y: 0, w: 2, h: 2 } };

    it("treats identical layouts (independent of key order) as equal", () => {
        expect(sameLayout(base, { b: { x: 4, y: 0, w: 2, h: 2 }, a: { x: 0, y: 0, w: 4, h: 3 } })).toBe(true);
    });

    it("treats two empty layouts as equal", () => {
        expect(sameLayout({}, {})).toBe(true);
    });

    it("differs when a widget is added or removed", () => {
        expect(sameLayout(base, { a: base.a })).toBe(false);
        expect(sameLayout(base, { ...base, c: { x: 0, y: 3, w: 1, h: 1 } })).toBe(false);
    });

    it("differs when any coordinate or size changes", () => {
        expect(sameLayout(base, { ...base, a: { ...base.a, x: 1 } })).toBe(false);
        expect(sameLayout(base, { ...base, a: { ...base.a, h: 5 } })).toBe(false);
    });

    it("differs when the same number of keys don't match (no shared key)", () => {
        expect(sameLayout({ a: base.a }, { z: base.a })).toBe(false);
    });
});
