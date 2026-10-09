import { getMermaidConfig, type MermaidTheme, parseMermaidTheme } from "@triliumnext/commons/src/lib/mermaid_config.js";

export default async function setupMermaid() {
    const codeBlocks = document.querySelectorAll("#content pre code.language-mermaid");
    if (codeBlocks.length === 0) {
        return;
    }

    const mermaid = await loadMermaid();

    const diagrams: Diagram[] = [];
    for (const codeBlock of codeBlocks) {
        const parentPre = codeBlock.parentElement;
        if (!parentPre) {
            continue;
        }

        const element = document.createElement("div");
        element.classList.add("mermaid");
        parentPre.replaceWith(element);
        diagrams.push({ element, source: codeBlock.textContent ?? "" });
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
