import { customFontFamily, customFontNoteId } from "./custom_fonts.js";
import {
    MONOSPACE_FONT_FAMILY, type OptionNames, SYSTEM_MONOSPACE_FONT_STACK, SYSTEM_SANS_SERIF_FONT_STACK
} from "./options_interface.js";

/** The options {@link buildFontCss} reads. */
export const FONT_OPTION_NAMES = [
    "overrideThemeFonts",
    "mainFontFamily", "mainFontSize",
    "treeFontFamily", "treeFontSize",
    "detailFontFamily", "detailFontSize",
    "monospaceFontFamily", "monospaceFontSize"
] as const satisfies readonly OptionNames[];

export type FontOptions = Partial<Record<typeof FONT_OPTION_NAMES[number], string>>;

/**
 * The stylesheet that applies the user's font options over the theme's fonts, or an empty string
 * while `overrideThemeFonts` is off. `/bootstrap` sends it for the first render, and the client
 * builds it again when a font option changes.
 */
export function buildFontCss(options: FontOptions): string {
    if (options.overrideThemeFonts !== "true") {
        return "";
    }

    // `html:root` outranks the themes' `:root` and `html`, and `--main-font-size` must reach `<html>`.
    let style = "html:root {";
    style += getFontFamilies(options);
    style += getFontSizes(options);
    style += "}";
    return style;
}

const FAMILY_VARIABLES = [
    [ "mainFontFamily", "--main-font-family", SYSTEM_SANS_SERIF_FONT_STACK ],
    [ "treeFontFamily", "--tree-font-family", SYSTEM_SANS_SERIF_FONT_STACK ],
    [ "detailFontFamily", "--detail-font-family", SYSTEM_SANS_SERIF_FONT_STACK ],
    [ "monospaceFontFamily", "--monospace-font-family", SYSTEM_MONOSPACE_FONT_STACK ]
] as const;

const SIZE_VARIABLES = [
    [ "mainFontSize", "--main-font-size" ],
    [ "treeFontSize", "--tree-font-size" ],
    [ "detailFontSize", "--detail-font-size" ],
    [ "monospaceFontSize", "--monospace-font-size" ]
] as const;

/** Declares each family that does not follow the theme. */
function getFontFamilies(options: FontOptions) {
    let style = "";
    for (const [ optionName, variable, systemStack ] of FAMILY_VARIABLES) {
        const value = options[optionName];
        if (!value || value === "theme") {
            continue;
        }
        style += `${variable}: ${value === "system" ? systemStack : resolveFamily(value)};`;
    }
    return style;
}

/**
 * The family a font option names. One of the user's own fonts names the note holding it, and is
 * drawn under the family the client registers that note's file as; anything else already names a
 * family the browser resolves for itself.
 *
 * A reference the client would not register (one naming no note Trilium could have minted) is
 * left as it stands rather than built into a declaration.
 */
function resolveFamily(optionValue: string) {
    if (optionValue === "monospace") {
        return MONOSPACE_FONT_FAMILY;
    }

    const noteId = customFontNoteId(optionValue);
    return noteId ? `"${customFontFamily(noteId)}"` : optionValue;
}

function getFontSizes(options: FontOptions) {
    let style = "";
    for (const [ optionName, variable ] of SIZE_VARIABLES) {
        style += `${variable}: ${options[optionName]}%;`;
    }
    return style;
}
