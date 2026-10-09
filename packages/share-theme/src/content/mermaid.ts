import { getMermaidConfig, type MermaidTheme, parseMermaidTheme } from "@triliumnext/commons/src/lib/mermaid_config.js";
import type { Mermaid } from "mermaid";

/**
 * Draws the Mermaid diagrams on the page: code blocks in a text note, and Mermaid notes. A code
 * block or a note's saved image stays in place until Mermaid has drawn its diagram.
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
}

/** The diagrams on the page, each with the element its drawing replaces. */
function findDiagrams() {
    const placeholders: { placeholder: Element; source: string }[] = [];

    for (const block of document.querySelectorAll("#content pre")) {
        const code = block.querySelector(":scope > code.language-mermaid");
        if (code) {
            placeholders.push({ placeholder: block, source: code.textContent });
        }
    }

    for (const note of document.querySelectorAll("#content .mermaid-note")) {
        const image = note.querySelector(":scope > .mermaid-note-image");
        const source = note.querySelector(".mermaid-note-source");
        if (image && source) {
            placeholders.push({ placeholder: image, source: source.textContent });
        }
    }

    return placeholders.map(({ placeholder, source }): Diagram => {
        const element = document.createElement("div");
        element.classList.add("mermaid");
        return { placeholder, element, source };
    });
}

let renderCount = 0;

/**
 * Draws every diagram from its source. A diagram Mermaid cannot draw keeps what the page showed
 * for it before: its placeholder, or its drawing in the previous theme.
 */
async function renderDiagrams(mermaid: Mermaid, diagrams: Diagram[], theme: MermaidTheme) {
    mermaid.initialize({ ...getMermaidConfig(theme), startOnLoad: false });
    for (const { placeholder, element, source } of diagrams) {
        try {
            const { svg } = await mermaid.render(`share-mermaid-${renderCount++}`, source);
            element.innerHTML = svg;
        } catch (error) {
            console.error(error);
            continue;
        }

        if (placeholder.isConnected) {
            placeholder.replaceWith(element);
        }
    }
}

function readMermaidTheme() {
    return parseMermaidTheme(getComputedStyle(document.documentElement).getPropertyValue("--mermaid-theme"));
}
