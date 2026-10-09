import { getMermaidConfig, type MermaidTheme, parseMermaidTheme } from "@triliumnext/commons/src/lib/mermaid_config.js";

/**
 * Draws the Mermaid diagrams on the page: code blocks in a text note, and Mermaid notes, whose saved
 * image stays in place until Mermaid has loaded.
 */
export default async function setupMermaid() {
    const placeholders = findPlaceholders();
    if (placeholders.length === 0) {
        return;
    }

    const mermaid = await loadMermaid();

    const diagrams: Diagram[] = [];
    for (const { placeholder, source } of placeholders) {
        const element = document.createElement("div");
        element.classList.add("mermaid");
        placeholder.replaceWith(element);
        diagrams.push({ element, source });
    }

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
    element: HTMLElement;
    source: string;
}

/** The elements a drawn diagram replaces, each with the source it is drawn from. */
function findPlaceholders() {
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

    return placeholders;
}

interface Mermaid {
    initialize(config: Record<string, unknown>): void;
    run(options: { nodes: HTMLElement[] }): Promise<void>;
}

/** Draws every diagram from its source, replacing what an earlier render left in the element. */
async function renderDiagrams(mermaid: Mermaid, diagrams: Diagram[], theme: MermaidTheme) {
    mermaid.initialize({ ...getMermaidConfig(theme), startOnLoad: false });
    for (const { element, source } of diagrams) {
        element.removeAttribute("data-processed");
        element.textContent = source;
    }
    await mermaid.run({ nodes: diagrams.map((diagram) => diagram.element) });
}

function readMermaidTheme() {
    return parseMermaidTheme(getComputedStyle(document.documentElement).getPropertyValue("--mermaid-theme"));
}

/**
 * Imports the client's mermaid, which the server, the standalone build and the share-theme export
 * each place at `client/` next to this script, described by `share_mermaid.json`.
 */
export async function loadMermaid(): Promise<Mermaid> {
    const manifestUrl = new URL("client/share_mermaid.json", import.meta.url);
    const response = await fetch(manifestUrl);
    if (!response.ok) {
        throw new Error(`Failed to load ${manifestUrl.href}: HTTP ${response.status}.`);
    }

    const { entry } = await response.json() as { entry: string };
    const module = await import(new URL(entry, manifestUrl).href) as { default: Mermaid };
    return module.default;
}
