import clsx from "clsx";
import Color, { ColorInstance } from "color";

import {readCssVar} from "../utils/css-var";

const registeredClasses = new Set<string>();
const colorsWithHue = new Set<string>();

// Read the color lightness limits defined in the theme as CSS variables

const lightThemeColorMaxLightness = readCssVar(
    document.documentElement,
    "tree-item-light-theme-max-color-lightness"
).asNumber(70);

const darkThemeColorMinLightness = readCssVar(
    document.documentElement,
    "tree-item-dark-theme-min-color-lightness"
).asNumber(50);

function createClassForColor(colorString: string | null) {
    if (!colorString?.trim()) return "";

    const color = parseColor(colorString);
    if (!color) return "";

    const className = `color-${color.hex().substring(1)}`;

    if (!registeredClasses.has(className)) {
        const adjustedColor = adjustColorLightness(color, lightThemeColorMaxLightness!,
            darkThemeColorMinLightness!);
        const hue = getHue(color);

        $("head").append(`<style>
            .${className}, span.fancytree-active.${className} {
                --original-custom-color: ${color.hex()};
                --light-theme-custom-color: ${adjustedColor.lightThemeColor};
                --dark-theme-custom-color: ${adjustedColor.darkThemeColor};
                --custom-color-hue: ${hue ?? 'unset'};
            }
        </style>`);

        registeredClasses.add(className);
        if (hue !== undefined) {
            colorsWithHue.add(className);
        }
    }

    return clsx("use-note-color", className, colorsWithHue.has(className) && "with-hue");
}

function parseColor(color: string) {
    try {
        return Color(color.toLowerCase());
    } catch (ex) {
        console.error(ex);
    }
}

/**
 * Returns a pair of colors — one optimized for light themes and the other for dark themes, derived
 * from the specified color to maintain sufficient contrast with each theme.
 * The adjustment is performed by limiting the color’s lightness in the CIELAB color space,
 * according to the lightThemeMaxLightness and darkThemeMinLightness parameters.
 */
function adjustColorLightness(color: ColorInstance, lightThemeMaxLightness: number, darkThemeMinLightness: number) {
    const labColor = color.lab();
    const lightness = labColor.l();

    // For the light theme, limit the maximum lightness
    const lightThemeColor = labColor.l(Math.min(lightness, lightThemeMaxLightness)).hex();

    // For the dark theme, limit the minimum lightness
    const darkThemeColor = labColor.l(Math.max(lightness, darkThemeMinLightness)).hex();

    return {lightThemeColor, darkThemeColor};
}

/** Returns the hue of the specified color, or undefined if the color is grayscale. */
function getHue(color: ColorInstance) {
    const hslColor = color.hsl();
    if (hslColor.saturationl() > 0) {
        return hslColor.hue();
    }
}

export function getReadableTextColor(bgColor: string) {
    const colorInstance = parseColor(bgColor);
    return !colorInstance || colorInstance?.isLight() ? "#000" : "#fff";
}

export default {
    createClassForColor
};
