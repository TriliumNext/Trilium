/**
 * Where an icon pack draws its glyphs, as fractions of the em.
 *
 * A browser takes the box it centres a glyph in from the font's platform metrics, which carry
 * padding the pack never drew in: Boxicons 3 declares 300 units per em and a Windows ascent of 327,
 * so each of its icons sits about 4.5% of the em below the middle of its container. Declaring the
 * pack's own box through `ascent-override` and `descent-override` removes that, and pins the result
 * across platforms that read different metrics out of the same file.
 */
export interface IconFontMetrics {
    /** The `ascent-override` value. */
    ascent: number;
    /** The `descent-override` value. */
    descent: number;
}

/** Below this many inked glyphs the middle of the set says too little to override anything by. */
const MIN_MEASURED_GLYPHS = 8;

/** The largest override that can be meant seriously, as a fraction of the em. */
const MAX_OVERRIDE = 2;

/**
 * The metrics of a pack, worked out from where it draws.
 *
 * The middle of the ink is taken over the whole pack rather than per glyph: individual icons are
 * drawn off centre on purpose, and the median says where the box they share sits without following
 * any of them.
 *
 * @param unitsPerEm the font's own unit scale.
 * @param inkCentres the vertical middle of each glyph's ink, in font units above the baseline.
 * @returns the metrics, or `null` where the font says too little to correct.
 */
export function measureIconFont(unitsPerEm: number, inkCentres: number[]): IconFontMetrics | null {
    if (!(unitsPerEm > 0) || inkCentres.length < MIN_MEASURED_GLYPHS) {
        return null;
    }

    const middle = median(inkCentres) / unitsPerEm;
    const ascent = 0.5 + middle;
    const descent = 0.5 - middle;
    if (!isOverride(ascent) || !isOverride(descent)) {
        return null;
    }

    return { ascent: roundFraction(ascent), descent: roundFraction(descent) };
}

/**
 * The `@font-face` descriptors a pack's metrics stand for, one per line, or nothing where it
 * declares none.
 *
 * A pack's manifest is written by whoever made it, so a value that is not a usable number is
 * dropped rather than passed on to the stylesheet.
 */
export function iconFontFaceOverrides(metrics: IconFontMetrics | undefined): string[] {
    const ascent = overridePercentage(metrics?.ascent);
    const descent = overridePercentage(metrics?.descent);
    if (ascent === null || descent === null) {
        return [];
    }

    return [
        `ascent-override: ${ascent}%;`,
        `descent-override: ${descent}%;`,
        "line-gap-override: 0%;"
    ];
}

/** Whether a computed override is a number a `@font-face` can carry. */
function isOverride(value: number) {
    return Number.isFinite(value) && value >= 0 && value <= MAX_OVERRIDE;
}

/** One override as a percentage, or `null` where the manifest's value cannot be used. */
function overridePercentage(value: number | undefined) {
    if (typeof value !== "number" || !isOverride(value)) {
        return null;
    }

    return Number((value * 100).toFixed(2));
}

/** Six decimals of the em, which is finer than any screen resolves. */
function roundFraction(value: number) {
    return Number(value.toFixed(6));
}

function median(values: number[]) {
    const sorted = [ ...values ].sort((first, second) => first - second);
    const middle = Math.floor(sorted.length / 2);

    return sorted.length % 2 === 0
        ? (sorted[middle - 1] + sorted[middle]) / 2
        : sorted[middle];
}
