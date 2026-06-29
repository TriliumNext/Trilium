/**
 * Pure geometry/colour/amplitude helpers for the audio sound-bar visualizer.
 *
 * The visualizer draws a grid of square cells: each column is a frequency bar that lights up from the bottom,
 * and a cell's colour is a gradient between a "low" colour (bottom row) and a "high" colour (top row). The
 * canvas adapter ({@link ../AudioVisualizer}) owns the rAF loop, canvas and analyser; everything here is pure
 * and synchronous so it can be unit-tested without a DOM or the Web Audio API.
 */

export interface VisualizerGrid {
    /** Number of columns (frequency bars) that fit the width. */
    cols: number;
    /** Number of cell rows that fit the height. */
    rows: number;
    /** Left padding, in CSS pixels, that horizontally centres the grid in the available width. */
    offsetX: number;
}

/** Lay out a grid of `cellSize` squares separated by `gap`, as many as fit, centred horizontally. Rows are
 *  drawn bottom-up by the renderer, so any leftover height sits above the grid. */
export function computeGrid(width: number, height: number, cellSize: number, gap: number): VisualizerGrid {
    const stride = cellSize + gap;
    if (stride <= 0) {
        return { cols: 0, rows: 0, offsetX: 0 };
    }
    // n cells span n*cellSize + (n-1)*gap = n*stride - gap, which must fit the extent.
    const cols = Math.max(0, Math.floor((width + gap) / stride));
    const rows = Math.max(0, Math.floor((height + gap) / stride));
    const gridWidth = cols > 0 ? cols * stride - gap : 0;
    return { cols, rows, offsetX: Math.max(0, (width - gridWidth) / 2) };
}

/** Parse a CSS colour into [r, g, b]. Handles the `rgb()/rgba()` form that getComputedStyle returns, plus
 *  `#rgb`/`#rrggbb` for literal fallbacks. Unknown input yields black. */
export function parseRgb(color: string): [number, number, number] {
    const fn = color.match(/rgba?\(([^)]+)\)/i);
    if (fn) {
        const parts = fn[1].split(",").map((p) => parseFloat(p.trim()));
        return [ clampByte(parts[0]), clampByte(parts[1]), clampByte(parts[2]) ];
    }
    const hex = color.trim().replace(/^#/, "");
    if (hex.length === 3) {
        return [ parseHex(hex[0] + hex[0]), parseHex(hex[1] + hex[1]), parseHex(hex[2] + hex[2]) ];
    }
    if (hex.length >= 6) {
        return [ parseHex(hex.slice(0, 2)), parseHex(hex.slice(2, 4)), parseHex(hex.slice(4, 6)) ];
    }
    return [ 0, 0, 0 ];
}

/** Precompute one colour per row, interpolating from `lowColor` (row 0, bottom) to `highColor` (top row). The
 *  renderer reuses this so it never parses/interpolates colours per cell per frame. */
export function buildRowColors(lowColor: string, highColor: string, rows: number): string[] {
    if (rows <= 0) {
        return [];
    }
    const low = parseRgb(lowColor);
    const high = parseRgb(highColor);
    const colors = new Array<string>(rows);
    for (let r = 0; r < rows; r++) {
        const t = rows > 1 ? r / (rows - 1) : 0;
        const red = Math.round(low[0] + (high[0] - low[0]) * t);
        const green = Math.round(low[1] + (high[1] - low[1]) * t);
        const blue = Math.round(low[2] + (high[2] - low[2]) * t);
        colors[r] = `rgb(${red}, ${green}, ${blue})`;
    }
    return colors;
}

/**
 * Reduce a frequency spectrum to one 0..1 amplitude per column, writing into `out` (reused frame to frame). The
 * `[loFraction, hiFraction]` window selects the slice of the spectrum to spread across the bars — broad by
 * default rather than voice-specific. Each column takes the loudest bin in its slice so transients aren't
 * averaged away.
 */
export function computeColumnAmplitudes(freqData: Uint8Array, out: Float32Array, loFraction: number, hiFraction: number): Float32Array {
    const cols = out.length;
    const n = freqData.length;
    if (cols === 0 || n === 0) {
        out.fill(0);
        return out;
    }
    const lo = Math.max(0, Math.min(n - 1, Math.floor(n * loFraction)));
    const hi = Math.min(n, Math.max(lo + 1, Math.floor(n * hiFraction)));
    const span = hi - lo;
    for (let c = 0; c < cols; c++) {
        const start = lo + Math.floor((c / cols) * span);
        const end = Math.max(start + 1, lo + Math.floor(((c + 1) / cols) * span));
        let peak = 0;
        for (let i = start; i < end && i < n; i++) {
            if (freqData[i] > peak) peak = freqData[i];
        }
        out[c] = peak / 255;
    }
    return out;
}

/** Ease each displayed amplitude toward its target in place: a fast `rise` on attack, slower `fall` on release
 *  (VU-meter feel). `target` null means decay toward zero (paused). Snaps when within epsilon so a release
 *  actually reaches 0 (letting the render loop stop) instead of asymptoting forever. */
export function smoothAmplitudes(current: Float32Array, target: Float32Array | null, rise: number, fall: number): void {
    for (let c = 0; c < current.length; c++) {
        const t = target ? target[c] : 0;
        const cur = current[c];
        const next = cur + (t - cur) * (t > cur ? rise : fall);
        current[c] = Math.abs(t - next) < 0.001 ? t : next;
    }
}

/**
 * How "on" a cell is, 0..1, for a column's 0..1 amplitude — the fill level `amplitude*rows` minus the cell's
 * row index, clamped. Cells fully within the bar return 1, cells above it 0, and the single leading cell a
 * fraction. Drawn as the cell's alpha, this fades the leading cell between off and on as the bar's (eased)
 * height sweeps across it, instead of cells popping on/off.
 */
export function cellIntensity(amplitude: number, rows: number, row: number): number {
    const fill = amplitude * rows - row;
    return fill <= 0 ? 0 : fill >= 1 ? 1 : fill;
}

/** Resize a per-column buffer to `length`, preserving overlapping values so a resize doesn't reset the bars. */
export function resizePreserving(arr: Float32Array, length: number): Float32Array {
    if (arr.length === length) {
        return arr;
    }
    const next = new Float32Array(length);
    next.set(arr.subarray(0, Math.min(arr.length, length)));
    return next;
}

/** Whether any bar is still above the resting threshold — i.e. the render loop must keep animating the decay. */
export function hasMotion(current: Float32Array): boolean {
    for (let i = 0; i < current.length; i++) {
        if (current[i] > 0.001) {
            return true;
        }
    }
    return false;
}

function clampByte(value: number): number {
    if (!Number.isFinite(value)) {
        return 0;
    }
    return Math.max(0, Math.min(255, Math.round(value)));
}

function parseHex(pair: string): number {
    // Reject anything that isn't exactly two hex digits (e.g. "-c", which parseInt would read as -12).
    if (!/^[0-9a-f]{2}$/i.test(pair)) {
        return 0;
    }
    return parseInt(pair, 16);
}
