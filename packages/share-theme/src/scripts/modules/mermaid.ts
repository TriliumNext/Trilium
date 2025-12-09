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

    mermaid.init();
}
