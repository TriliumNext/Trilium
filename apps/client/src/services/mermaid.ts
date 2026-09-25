import type { MermaidConfig } from "mermaid";

export function getMermaidConfig(): MermaidConfig {
    const documentStyle = window.getComputedStyle(document.documentElement);
    const mermaidTheme = documentStyle.getPropertyValue("--mermaid-theme") as "default";

    return {
        theme: mermaidTheme.trim() as "default",
        // Mermaid 12 made ELK the default layout and `neo` the default look. Both are pinned to the
        // pre-12 values so diagrams already stored in notes keep rendering as they were written;
        // front matter still overrides either one per diagram.
        layout: "dagre",
        look: "classic",
        securityLevel: "antiscript",
        flowchart: { useMaxWidth: false },
        sequence: { useMaxWidth: false },
        gantt: { useMaxWidth: false },
        class: { useMaxWidth: false },
        state: { useMaxWidth: false },
        pie: { useMaxWidth: true },
        journey: { useMaxWidth: false },
        gitGraph: { useMaxWidth: false }
    };
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
