import { TableWalker } from "ckeditor5";
import type { ModelElement } from "ckeditor5";

export type TableAxis = "row" | "column";

/** An inclusive range of row or column indexes. */
export interface IndexRange {
    first: number;
    last: number;
}

export interface GroupMovePlan {
    source: IndexRange;
    target: IndexRange;
}

/**
 * Plans moving the selected rows or columns one span group forward (down/right) or backward
 * (up/left). Both ranges are expanded so that no merged cell sticks out of them, which makes
 * swapping the two blocks always grid-safe. Returns `null` when the move would leave the table.
 */
export function planGroupMove(
    table: ModelElement,
    axis: TableAxis,
    selected: IndexRange,
    isForward: boolean
): GroupMovePlan | null {
    const { crossed, count } = scanSpannedBoundaries(table, axis);
    const source = expandToGroup(selected, crossed, count);

    if (isForward) {
        if (source.last + 1 >= count) {
            return null;
        }
        const next = { first: source.last + 1, last: source.last + 1 };
        return { source, target: expandToGroup(next, crossed, count) };
    }

    if (source.first <= 0) {
        return null;
    }
    const previous = { first: source.first - 1, last: source.first - 1 };
    return { source, target: expandToGroup(previous, crossed, count) };
}

/**
 * Splits `range`, widened so that no merged cell sticks out of it, into span groups: the smallest
 * blocks of rows or columns that no merged cell crosses.
 */
export function splitIntoGroups(
    table: ModelElement,
    axis: TableAxis,
    range: IndexRange
): IndexRange[] {
    const { crossed, count } = scanSpannedBoundaries(table, axis);
    const { first, last } = expandToGroup(range, crossed, count);

    const groups: IndexRange[] = [];
    let groupFirst = first;
    for (let index = first + 1; index <= last; index++) {
        if (!crossed[index]) {
            groups.push({ first: groupFirst, last: index - 1 });
            groupFirst = index;
        }
    }
    groups.push({ first: groupFirst, last });
    return groups;
}

/**
 * Returns the `headingRows`/`headingColumns` value after applying `plan`. The heading band is
 * positional: entries moved out of the leading band lose heading status and entries moved into
 * it gain heading status, while the entries that did not move keep their role.
 */
export function adjustedHeadingCount(heading: number, plan: GroupMovePlan, isForward: boolean): number {
    if (heading <= 0) {
        return heading;
    }

    const { source, target } = plan;
    if (isForward && target.last >= heading) {
        return heading - Math.max(0, Math.min(source.last + 1, heading) - source.first);
    }
    if (!isForward && target.first < heading) {
        return heading + Math.max(0, source.last + 1 - Math.max(source.first, heading));
    }
    return heading;
}

/** Boundary `i` is crossed when a cell spans from before `i` to `i` or beyond. */
function scanSpannedBoundaries(table: ModelElement, axis: TableAxis) {
    const crossed: boolean[] = [];
    let count = 0;

    for (const slot of new TableWalker(table)) {
        const start = axis === "row" ? slot.row : slot.column;
        const span = axis === "row" ? slot.cellHeight : slot.cellWidth;
        for (let boundary = start + 1; boundary < start + span; boundary++) {
            crossed[boundary] = true;
        }
        count = Math.max(count, start + span);
    }

    return { crossed, count };
}

function expandToGroup(range: IndexRange, crossed: boolean[], count: number): IndexRange {
    let first = range.first;
    while (first > 0 && crossed[first]) {
        first--;
    }

    let last = range.last;
    while (last + 1 < count && crossed[last + 1]) {
        last++;
    }

    return { first, last };
}
