export interface Line {
    fromX: number;
    fromY: number;
    toX: number;
    toY: number;
}

/** How far a stroke can stray from the line between its ends, as a share of that line's length. */
const LINE_DEVIATION = 0.1;
/** How much longer than the line between its ends the path of a stroke can be. */
const LINE_DETOUR = 1.25;

/**
 * Returns the line between the ends of a stroke that was drawn as a straight line, from its flat
 * `x, y, pressure` triples. A stroke shorter than `minLength`, one that bends away from the line
 * or one that runs back and forth along it is not a line.
 */
export function recognizeLine(points: number[], minLength: number): Line | undefined {
    if (points.length < 6) return undefined;
    const fromX = points[0];
    const fromY = points[1];
    const toX = points[points.length - 3];
    const toY = points[points.length - 2];
    const dx = toX - fromX;
    const dy = toY - fromY;
    const length = Math.hypot(dx, dy);
    if (length < minLength || length === 0) return undefined;

    let pathLength = 0;
    for (let i = 3; i + 2 < points.length; i += 3) {
        const deviation = Math.abs((points[i] - fromX) * dy - (points[i + 1] - fromY) * dx) / length;
        if (deviation > LINE_DEVIATION * length) return undefined;
        pathLength += Math.hypot(points[i] - points[i - 3], points[i + 1] - points[i - 2]);
    }
    if (pathLength > LINE_DETOUR * length) return undefined;
    return { fromX, fromY, toX, toY };
}

/**
 * Returns the flat `x, y, pressure` triples of a stroke along `line` at one pressure, so at one
 * width. The point in the middle keeps the stroke out of the outline of a two-point stroke, which
 * gives its middle a pressure of its own.
 */
export function lineToPoints({ fromX, fromY, toX, toY }: Line, pressure: number): number[] {
    return [
        fromX, fromY, pressure,
        (fromX + toX) / 2, (fromY + toY) / 2, pressure,
        toX, toY, pressure
    ];
}
