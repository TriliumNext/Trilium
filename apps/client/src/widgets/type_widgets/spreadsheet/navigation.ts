import { Direction } from "@univerjs/core";
import type { FUniver } from "@univerjs/presets";
import { type MutableRef, useEffect } from "preact/hooks";

// Univer's plain arrow-key navigation (the "sheet.command.move-selection" command) is
// cyclic: pressing Up on the first row wraps the selection to the last row, Down on the
// last row wraps back to the first, and Left/Right wrap across columns the same way. That
// differs from Excel and Google Sheets, where arrow keys clamp at the edge, and it is
// disorienting because the wrapped-to row is usually far off-screen. Ctrl+Arrow uses a
// different code path (findNextGapRange) that already clamps, so only the plain arrows
// need fixing.
const MOVE_SELECTION_COMMAND_ID = "sheet.command.move-selection";

export type NavigationDirection = "up" | "down" | "left" | "right";

export interface SelectionBounds {
    /** Top row of the current selection (0-based). */
    startRow: number;
    /** Bottom row of the current selection (0-based, inclusive). */
    endRow: number;
    /** Leftmost column of the current selection (0-based). */
    startColumn: number;
    /** Rightmost column of the current selection (0-based, inclusive). */
    endColumn: number;
    /** Total number of rows in the sheet. */
    maxRows: number;
    /** Total number of columns in the sheet. */
    maxColumns: number;
}

/**
 * Returns whether an arrow-key move in `direction` would step past the sheet's edge — which
 * is exactly when Univer wraps the selection to the opposite side. The caller cancels such
 * moves so the selection clamps at the edge instead. Mirrors the boundary check Univer's
 * `findNextRange` performs (boundary = the full sheet), keyed off the selection edge that
 * the move travels from: the top row for Up, the bottom row for Down, and likewise for
 * Left/Right across columns.
 */
export function isOutOfBoundsMove(direction: NavigationDirection, bounds: SelectionBounds): boolean {
    switch (direction) {
        case "up":
            return bounds.startRow <= 0;
        case "down":
            return bounds.endRow >= bounds.maxRows - 1;
        case "left":
            return bounds.startColumn <= 0;
        case "right":
            return bounds.endColumn >= bounds.maxColumns - 1;
    }
}

/**
 * Cancels cyclic arrow-key navigation so the selection clamps at the sheet edge (Excel /
 * Google Sheets behaviour) instead of wrapping to the opposite side. Hooks Univer's
 * before-command event and aborts the move command when the selection already sits against
 * the boundary in the travel direction.
 */
export default function useClampEdgeNavigation(apiRef: MutableRef<FUniver | undefined>) {
    useEffect(() => {
        const univerAPI = apiRef.current;
        if (!univerAPI) return;

        const disposable = univerAPI.addEvent(univerAPI.Event.BeforeCommandExecute, (event) => {
            if (event.id !== MOVE_SELECTION_COMMAND_ID) return;

            const params = event.params as { direction?: Direction; extra?: string } | undefined;
            // Leave the formula-editor range selector (and any other special mode that tags
            // itself via `extra`) untouched — this fix only targets plain cell navigation.
            if (params?.extra) return;

            const direction = params?.direction === undefined ? undefined : toNavigationDirection(params.direction);
            if (!direction) return;

            const worksheet = univerAPI.getActiveWorkbook()?.getActiveSheet();
            const range = worksheet?.getActiveRange();
            if (!worksheet || !range) return;

            const atEdge = isOutOfBoundsMove(direction, {
                startRow: range.getRow(),
                endRow: range.getLastRow(),
                startColumn: range.getColumn(),
                endColumn: range.getLastColumn(),
                maxRows: worksheet.getMaxRows(),
                maxColumns: worksheet.getMaxColumns()
            });

            if (atEdge) {
                event.cancel = true;
            }
        });
        return () => disposable.dispose();
    }, [ apiRef ]);
}

export function toNavigationDirection(direction: Direction): NavigationDirection | undefined {
    switch (direction) {
        case Direction.UP:
            return "up";
        case Direction.DOWN:
            return "down";
        case Direction.LEFT:
            return "left";
        case Direction.RIGHT:
            return "right";
        default:
            return undefined;
    }
}
