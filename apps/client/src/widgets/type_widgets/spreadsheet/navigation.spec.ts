import { Direction } from "@univerjs/core";
import { describe, expect, it } from "vitest";

import { isOutOfBoundsMove, type SelectionBounds, toNavigationDirection } from "./navigation";

describe("isOutOfBoundsMove", () => {
    // A 10x10 sheet (rows/columns 0..9) with the selection on a single, interior cell.
    function boundsAt(row: number, column: number, overrides: Partial<SelectionBounds> = {}): SelectionBounds {
        return {
            startRow: row,
            endRow: row,
            startColumn: column,
            endColumn: column,
            maxRows: 10,
            maxColumns: 10,
            ...overrides
        };
    }

    it("clamps at each of the four edges (the reported wrap-around)", () => {
        expect(isOutOfBoundsMove("up", boundsAt(0, 3))).toBe(true);
        expect(isOutOfBoundsMove("down", boundsAt(9, 3))).toBe(true);
        expect(isOutOfBoundsMove("left", boundsAt(3, 0))).toBe(true);
        expect(isOutOfBoundsMove("right", boundsAt(3, 9))).toBe(true);
    });

    it("allows moves that stay within the sheet", () => {
        const interior = boundsAt(5, 5);
        expect(isOutOfBoundsMove("up", interior)).toBe(false);
        expect(isOutOfBoundsMove("down", interior)).toBe(false);
        expect(isOutOfBoundsMove("left", interior)).toBe(false);
        expect(isOutOfBoundsMove("right", interior)).toBe(false);
    });

    it("allows a move toward the opposite edge from the boundary", () => {
        // Sitting on the first row only blocks Up — Down/Left/Right must still move.
        expect(isOutOfBoundsMove("down", boundsAt(0, 3))).toBe(false);
        // Sitting in the last column only blocks Right.
        expect(isOutOfBoundsMove("left", boundsAt(3, 9))).toBe(false);
    });

    it("uses the leading edge of a multi-cell selection", () => {
        // A range spanning rows 0..2: Up is blocked (top row is 0) but Down is free
        // (bottom row 2 is not the last row).
        const topRange = boundsAt(0, 0, { endRow: 2, endColumn: 2 });
        expect(isOutOfBoundsMove("up", topRange)).toBe(true);
        expect(isOutOfBoundsMove("down", topRange)).toBe(false);

        // A range whose bottom row touches the last row blocks Down.
        const bottomRange = boundsAt(7, 0, { endRow: 9, endColumn: 2 });
        expect(isOutOfBoundsMove("down", bottomRange)).toBe(true);
        expect(isOutOfBoundsMove("up", bottomRange)).toBe(false);
    });
});

describe("toNavigationDirection", () => {
    it("maps each Univer arrow direction to its lowercase string", () => {
        expect(toNavigationDirection(Direction.UP)).toBe("up");
        expect(toNavigationDirection(Direction.DOWN)).toBe("down");
        expect(toNavigationDirection(Direction.LEFT)).toBe("left");
        expect(toNavigationDirection(Direction.RIGHT)).toBe("right");
    });

    it("returns undefined for any non-arrow direction", () => {
        // Univer's Direction enum carries non-arrow members (and future values); anything
        // outside the four arrows isn't a cell move, so it must not clamp.
        expect(toNavigationDirection(99 as Direction)).toBeUndefined();
    });
});
