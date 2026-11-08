/** How long a copy button shows its check mark after copying, in milliseconds. */
const COPIED_DURATION = 1500;

/**
 * Adds a button to each code block of the content that copies its code, showing a check mark for
 * a moment. Mermaid blocks, which `setupMermaid()` replaces with diagrams, get none. Without
 * `navigator.clipboard`, which browsers expose only in secure contexts, no block gets one.
 */
export default function setupCodeCopy() {
    const content = document.getElementById("content");
    if (!content || !navigator.clipboard) {
        return;
    }

    const label = content.dataset.copyCodeLabel ?? "";
    for (const code of content.querySelectorAll<HTMLElement>("pre > code:not(.language-mermaid)")) {
        code.parentElement?.append(createCopyButton(code, label));
    }
}

function createCopyButton(code: HTMLElement, label: string) {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "copy-button";
    button.title = label;
    button.setAttribute("aria-label", label);

    const icon = document.createElement("span");
    icon.className = "tn-icon bx bx-copy";
    icon.setAttribute("aria-hidden", "true");
    button.append(icon);

    let resetTimer: ReturnType<typeof setTimeout> | undefined;
    const setCopied = (copied: boolean) => {
        button.classList.toggle("copied", copied);
        icon.classList.toggle("bx-copy", !copied);
        icon.classList.toggle("bx-check", copied);
    };

    button.addEventListener("click", () => {
        navigator.clipboard.writeText(code.textContent).then(() => {
            setCopied(true);
            clearTimeout(resetTimer);
            resetTimer = setTimeout(() => setCopied(false), COPIED_DURATION);
        }, () => undefined);
    });

    return button;
}
