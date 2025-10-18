import {readCssVar} from "../utils/css-var";
import Color, { ColorInstance } from "color";

const registeredClasses = new Set<string>();

// Read the color lightness limits defined in the theme as CSS variables

const lightThemeColorMaxLightness = readCssVar(
                                        document.documentElement,
                                        "tree-item-light-theme-max-color-lightness"
                                    ).asNumber(70);

const darkThemeColorMinLightness = readCssVar(
                                        document.documentElement,
                                        "tree-item-dark-theme-min-color-lightness"
                                    ).asNumber(50);

function createClassForColor(color: string | null) {
    if (!color?.trim()) {
        return "";
    }

    const normalizedColorName = color.replace(/[^a-z0-9]/gi, "");

    if (!normalizedColorName.trim()) {
        return "";
    }

    const className = `color-${normalizedColorName}`;

    const adjustedColor = adjustColorLightness(color, lightThemeColorMaxLightness!, darkThemeColorMinLightness!);
    if (!adjustedColor) return "";

    if (!registeredClasses.has(className)) {
        $("head").append(`<style>
            .${className}, span.fancytree-active.${className} {
                --light-theme-custom-color: ${adjustedColor.lightThemeColor};
                --dark-theme-custom-color: ${adjustedColor.darkThemeColor}
            }
        </style>`);

        registeredClasses.add(className);
    }

    return className;
}

/** 
 * Returns a pair of colors — one optimized for light themes and the other for dark themes, derived
 * from the specified color to maintain sufficient contrast with each theme.
 * The adjustment is performed by limiting the color’s lightness in the CIELAB color space,
 * according to the lightThemeMaxLightness and darkThemeMinLightness parameters.
 */
function adjustColorLightness(color: string, lightThemeMaxLightness: number, darkThemeMinLightness: number) {
    let labColor: ColorInstance | undefined = undefined;

    try {
        // Parse the given color in the CIELAB color space
        labColor = Color(color).lab();
    } catch (ex) {
        console.error(`Failed to parse color: "${color}"`, ex);
        return;
    }

    const lightness = labColor.l();

    // For the light theme, limit the maximum lightness
    const lightThemeColor = labColor.l(Math.min(lightness, lightThemeMaxLightness)).hex();
    
    // For the dark theme, limit the minimum lightness
    const darkThemeColor = labColor.l(Math.max(lightness, darkThemeMinLightness)).hex();

    return {lightThemeColor, darkThemeColor};
}

export default {
    createClassForColor
};