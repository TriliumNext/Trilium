import type { MermaidConfig } from "mermaid";
import type { Mermaid } from "mermaid";

let elkLoaded = false;

export function getMermaidConfig(): MermaidConfig {
    const documentStyle = window.getComputedStyle(document.documentElement);
    const mermaidTheme = documentStyle.getPropertyValue("--mermaid-theme") as "default";

    return {
        theme: mermaidTheme.trim() as "default",
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
 * Determines whether the ELK extension of Mermaid.js needs to be loaded (which is a relatively large library), based on the
 * front-matter of the diagram and loads the library if needed.
 *
 * <p>
 * If the library has already been loaded or the diagram does not require it, the method will exit immediately.
 *
 * @param mermaidContent the plain text of the mermaid diagram, potentially including a frontmatter.
 */
export async function loadElkIfNeeded(mermaid: Mermaid, mermaidContent: string) {
    if (elkLoaded) {
        // Exit immediately since the ELK library is already loaded.
        return;
    }

    const parsedContent = await mermaid.parse(mermaidContent, {
        suppressErrors: true
    });
    if (parsedContent && parsedContent.config?.layout === "elk") {
        elkLoaded = true;
        mermaid.registerLayoutLoaders((await import("@mermaid-js/layout-elk")).default);
    }
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
