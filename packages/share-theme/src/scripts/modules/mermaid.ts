export default async function setupMermaid() {
    const mermaidEls = document.querySelectorAll("#content pre code.language-mermaid");
    if (mermaidEls.length === 0) {
        return;
    }

    const mermaid = await loadMermaid();

    for (const codeBlock of mermaidEls) {
        const parentPre = codeBlock.parentElement;
        if (!parentPre) {
            continue;
        }

        const mermaidDiv = document.createElement("div");
        mermaidDiv.classList.add("mermaid");
        mermaidDiv.innerHTML = codeBlock.innerHTML;
        parentPre.replaceWith(mermaidDiv);
    }

    // Mermaid 12 made ELK the default layout, `neo` the default look and `redux-color` the default
    // theme. All three are pinned to the pre-12 values so a published diagram renders the same way
    // it does in the app; front matter still overrides them per diagram.
    mermaid.initialize({ theme: "default", layout: "dagre", look: "classic" });
    mermaid.init();
}

interface Mermaid {
    initialize(config: Record<string, unknown>): void;
    init(): void;
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
