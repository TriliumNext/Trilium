import { customFontFamily, customFontNoteId, SYSTEM_MONOSPACE_FONT_STACK, SYSTEM_SANS_SERIF_FONT_STACK, type OptionMap } from "@triliumnext/commons";
import type { Request, Response } from "express";

import optionService from "../../services/options.js";
import sqlInit from "../../services/sql_init.js";

function getFontCss(req: Request, res: Response) {
    res.setHeader("Content-Type", "text/css");

    if (!sqlInit.isDbInitialized() || !optionService.getOptionBool("overrideThemeFonts")) {
        res.send("");

        return;
    }

    const optionsMap = optionService.getOptionMap();

    // using body to be more specific than themes' :root
    let style = "body {";
    style += getFontFamily(optionsMap);
    style += getFontSize(optionsMap);
    style += "}";

    res.send(style);
}

function getFontFamily({ mainFontFamily, treeFontFamily, detailFontFamily, monospaceFontFamily }: OptionMap) {
    let style = "";

    // System override
    if (mainFontFamily === "system") {
        mainFontFamily = SYSTEM_SANS_SERIF_FONT_STACK;
    }

    if (treeFontFamily === "system") {
        treeFontFamily = SYSTEM_SANS_SERIF_FONT_STACK;
    }

    if (detailFontFamily === "system") {
        detailFontFamily = SYSTEM_SANS_SERIF_FONT_STACK;
    }

    if (monospaceFontFamily === "system") {
        monospaceFontFamily = SYSTEM_MONOSPACE_FONT_STACK;
    }

    // Apply the font override if not using theme fonts.
    if (mainFontFamily !== "theme") {
        style += `--main-font-family: ${resolveFamily(mainFontFamily)};`;
    }

    if (treeFontFamily !== "theme") {
        style += `--tree-font-family: ${resolveFamily(treeFontFamily)};`;
    }

    if (detailFontFamily !== "theme") {
        style += `--detail-font-family: ${resolveFamily(detailFontFamily)};`;
    }

    if (monospaceFontFamily !== "theme") {
        style += `--monospace-font-family: ${resolveFamily(monospaceFontFamily)};`;
    }

    return style;
}

/**
 * The family a font option names. One of the user's own fonts names the note holding it, and is
 * drawn under the family the client registers that note's file as; anything else already names a
 * family the browser resolves for itself.
 *
 * A reference the client would not register — one naming no note Trilium could have minted — is
 * left as it stands rather than built into a declaration.
 */
function resolveFamily(optionValue: string) {
    const noteId = customFontNoteId(optionValue);
    return noteId ? `"${customFontFamily(noteId)}"` : optionValue;
}

function getFontSize(optionsMap: OptionMap) {
    let style = "";
    style += `--main-font-size: ${optionsMap.mainFontSize}%;`;
    style += `--tree-font-size: ${optionsMap.treeFontSize}%;`;
    style += `--detail-font-size: ${optionsMap.detailFontSize}%;`;
    style += `--monospace-font-size: ${optionsMap.monospaceFontSize}%;`;

    return style;
}

export default {
    getFontCss
};
