import { getMermaidConfig, type MermaidTheme, parseMermaidTheme } from "@triliumnext/commons/src/lib/mermaid_config.js";
import type { Mermaid } from "mermaid";

import type { ZoomPanLabels } from "./mermaid_zoom.js";

/**
 * Draws the Mermaid diagrams on the page: code blocks in a text note, and Mermaid notes. A code
 * block or a note's saved image stays in place until Mermaid has drawn its diagram, and a Mermaid
 * note's diagram then goes into a viewer that pans and zooms it.
 */
export default async function setupMermaid() {
    const diagrams = findDiagrams();
    if (diagrams.length === 0) {
        return;
    }

    const { default: mermaid } = await import("mermaid");

    let theme = readMermaidTheme();
    let rendering = renderDiagrams(mermaid, diagrams, theme);

    // The theme switch toggles a class on <html>, which changes `--mermaid-theme`.
    new MutationObserver(() => {
        const newTheme = readMermaidTheme();
        if (newTheme === theme) {
            return;
        }

        theme = newTheme;
        rendering = rendering.then(() => renderDiagrams(mermaid, diagrams, newTheme));
    }).observe(document.documentElement, { attributes: true, attributeFilter: [ "class" ] });

    await rendering;
}

interface Diagram {
    /** The element the first drawing replaces. */
    placeholder: Element;
    /** The element the drawings go into. */
    element: HTMLElement;
    source: string;
    /** The texts of the viewer a Mermaid note's diagram goes into. A code block has none. */
    labels?: ZoomPanLabels;
}

/** The diagrams on the page, each with the element its drawing replaces. */
function findDiagrams() {
    const placeholders: Omit<Diagram, "element">[] = [];

    for (const block of document.querySelectorAll("#content pre")) {
        const code = block.querySelector(":scope > code.language-mermaid");
        if (code) {
            placeholders.push({ placeholder: block, source: code.textContent });
        }
    }

    for (const note of document.querySelectorAll<HTMLElement>("#content .mermaid-note")) {
        const image = note.querySelector(":scope > .mermaid-note-image");
        const source = note.querySelector(".mermaid-note-source");
        if (image && source) {
            const labels = readLabels(note);
            placeholders.push({ placeholder: image, source: source.textContent, labels });
        }
    }

    return placeholders.map((placeholder): Diagram => {
        const element = document.createElement("div");
        element.classList.add("mermaid");
        return { ...placeholder, element };
    });
}

/** The texts `content_renderer.ts` gives a Mermaid note's viewer in its `data-*` attributes. */
function readLabels(note: HTMLElement): ZoomPanLabels {
    const { label = "", zoomIn = "", zoomOut = "", zoomReset = "" } = note.dataset;
    return { label, zoomIn, zoomOut, zoomReset };
}

let renderCount = 0;

/**
 * Draws every diagram from its source. A diagram Mermaid cannot draw keeps what the page showed
 * for it before: its placeholder, or its drawing in the previous theme.
 */
async function renderDiagrams(mermaid: Mermaid, diagrams: Diagram[], theme: MermaidTheme) {
    mermaid.initialize({ ...getMermaidConfig(theme), startOnLoad: false });
    for (const { placeholder, element, source, labels } of diagrams) {
        try {
            const { svg } = await mermaid.render(`share-mermaid-${renderCount++}`, source);
            element.innerHTML = svg;
        } catch (error) {
            console.error(error);
            continue;
        }

        if (placeholder.isConnected) {
            placeholder.replaceWith(element);
            if (labels) {
                await addZoomPan(element, labels);
            }
        }
    }
}

/**
 * Puts a drawn diagram in a viewer that pans and zooms it. Loaded on demand, so that only a page
 * with a Mermaid note loads it. A diagram whose viewer fails to load stays as it is.
 */
async function addZoomPan(element: HTMLElement, labels: ZoomPanLabels) {
    try {
        const { default: mountZoomPan } = await import("./mermaid_zoom.js");
        mountZoomPan(element, labels);
    } catch (error) {
        console.error(error);
    }
}

function readMermaidTheme() {
    return parseMermaidTheme(getComputedStyle(document.documentElement).getPropertyValue("--mermaid-theme"));
}
