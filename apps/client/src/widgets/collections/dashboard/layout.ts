import type { GridStack } from "gridstack";

export interface DashboardWidgetLayout {
    x: number;
    y: number;
    w: number;
    h: number;
}

export type WidgetLayouts = Record<string, DashboardWidgetLayout>;

export const GRID_COLUMNS = 12;
export const DEFAULT_WIDGET_SIZE = { w: 4, h: 3 };

/** Translate a drop event's viewport coordinates into a grid cell, or null when auto-positioning
 *  is preferable (the grid is in collapsed single-column mode or has no measurable geometry yet). */
export function computeDropCell(grid: GridStack, container: HTMLElement, e: { clientX: number; clientY: number }): Pick<DashboardWidgetLayout, "x" | "y"> | null {
    if (grid.getColumn() !== GRID_COLUMNS) {
        return null;
    }
    const rect = container.getBoundingClientRect();
    const cellWidth = rect.width / GRID_COLUMNS;
    const cellHeight = grid.getCellHeight();
    if (!cellWidth || !cellHeight) {
        return null;
    }
    const x = Math.min(GRID_COLUMNS - DEFAULT_WIDGET_SIZE.w, Math.max(0, Math.floor((e.clientX - rect.left) / cellWidth)));
    const y = Math.max(0, Math.floor((e.clientY - rect.top) / cellHeight));
    return { x, y };
}

/**
 * Merge the geometry of the widgets currently present in the grid (`present`) over the
 * previously-persisted layout (`previous`), producing the layout to persist next.
 *
 * A widget can be absent from `present` not only because it was removed from the dashboard, but
 * also because it was filtered out of view (e.g. archived notes hidden). To tell the two apart we
 * take `liveNoteIds` — the note IDs that are still children of the dashboard. A saved position is
 * retained only while its note is still a live child (so toggling a hidden widget back restores its
 * placement); the geometry of notes that are no longer children is pruned so the persisted layout
 * doesn't accumulate stale entries over repeated remove-and-add cycles.
 */
export function reconcilePersistedLayout(previous: WidgetLayouts, present: WidgetLayouts, liveNoteIds: Set<string>): WidgetLayouts {
    const result: WidgetLayouts = { ...present };
    for (const [ noteId, layout ] of Object.entries(previous)) {
        if (!(noteId in result) && liveNoteIds.has(noteId)) {
            result[noteId] = layout;
        }
    }
    return result;
}

/** Whether two layouts describe the same widgets in the same positions. */
export function sameLayout(a: WidgetLayouts, b: WidgetLayouts) {
    const aKeys = Object.keys(a);
    if (aKeys.length !== Object.keys(b).length) {
        return false;
    }
    return aKeys.every((key) => {
        const other = b[key];
        return other && a[key].x === other.x && a[key].y === other.y && a[key].w === other.w && a[key].h === other.h;
    });
}
