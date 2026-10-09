import { getMermaidConfig as getSharedMermaidConfig, parseMermaidTheme } from "@triliumnext/commons";
import type { MermaidConfig } from "mermaid";

export function getMermaidConfig(): MermaidConfig {
    const documentStyle = window.getComputedStyle(document.documentElement);
    return getSharedMermaidConfig(parseMermaidTheme(documentStyle.getPropertyValue("--mermaid-theme")));
}

/**
 * Processes the output of a Mermaid SVG render before it should be delivered to the user.
 *
 * <p>
 * Currently this fixes <br> to <br/> and replaces named HTML entities like &nbsp; with their
 * numeric equivalents, both of which would otherwise cause invalid XML when the SVG is saved
 * as an attachment.
 *
 * @param svg the Mermaid SVG to process.
 * @returns the processed SVG.
 */
export function postprocessMermaidSvg(svg: string) {
    return svg
        .replaceAll(/<br\s*>/ig, "<br/>")
        .replaceAll(/&nbsp;/g, "&#160;");
}
