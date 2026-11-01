/**
 * Color helpers shared by the OneNote importer's HTML converter (table-shading correction in
 * converter.ts) and its InkML renderer (theme-adaptive ink in inkml.ts). Both correct the same
 * OneNote quirk — colors exported for one canvas lightness rendered on the opposite one — by
 * reflecting a color's HSL lightness (L → 100 − L) while leaving hue and saturation untouched.
 */

import Color, { type ColorInstance } from "color";

/** Parses any CSS color (`#rgb`/`#rrggbb`, named, `rgb()`, …), or null if the value isn't one. */
export function parseColor(value: string): ColorInstance | null {
    try {
        return Color(value);
    } catch {
        return null;
    }
}

/** The `#rrggbb` hex of a color with its HSL lightness reflected (L → 100 − L), hue and saturation kept. */
export function reflectLightness(color: ColorInstance): string {
    return color.lightness(100 - color.lightness()).hex().toLowerCase();
}
