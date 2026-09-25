export default async function setupMermaid() {
    const mermaidEls = document.querySelectorAll("#content pre code.language-mermaid");
    if (mermaidEls.length === 0) {
        return;
    }

    const mermaid = (await import("mermaid")).default;

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
