/**
 * Serialize the AI chat reply input's CKEditor HTML into markdown for the LLM.
 *
 * The reply input enables autoformatting for block quotes, fenced code blocks, lists and links (see
 * `CHAT_INPUT_PLUGINS`); this turns the resulting elements into their markdown equivalents. Note
 * reference links keep their `#root/noteId` href so the model can feed them to note tools, and literal
 * text is passed through **unescaped**, so markdown a user types by hand survives too. Anything not
 * explicitly handled falls back to its text content, so unknown/pasted formatting degrades gracefully.
 */
export function editorHtmlToMarkdown(html: string): string {
    const container = document.createElement("div");
    container.innerHTML = html;
    return serializeChildren(container)
        .replace(/\n{3,}/g, "\n\n")
        .trim();
}

function serializeChildren(node: Node): string {
    return Array.from(node.childNodes).map(serializeNode).join("");
}

function serializeNode(node: Node): string {
    if (node.nodeType === Node.TEXT_NODE) {
        return node.textContent ?? "";
    }
    if (node.nodeType !== Node.ELEMENT_NODE) {
        return "";
    }

    const el = node as HTMLElement;
    switch (el.tagName.toLowerCase()) {
        // Two-space + newline = markdown hard line break, preserving Shift+Enter breaks.
        case "br":
            return "  \n";
        case "a": {
            const href = el.getAttribute("href") ?? "";
            const text = serializeChildren(el).trim();
            if (!href) return text;
            // A bare auto-linked URL (text === href) stays a plain URL rather than `[url](url)`.
            return text === href ? href : `[${text}](${href})`;
        }
        case "p":
            return `${serializeChildren(el)}\n\n`;
        case "blockquote": {
            const inner = serializeChildren(el).trim();
            // Keep each line's trailing `  ` hard break so multi-line quotes — and the trailing
            // "Show quote source" attribution — render on their own lines instead of collapsing.
            const quoted = inner.split("\n").map((line) => (line ? `> ${line}` : ">")).join("\n");
            return `${quoted}\n\n`;
        }
        case "pre":
            return serializeCodeBlock(el);
        case "ul":
            return `${serializeList(el, false, 0)}\n`;
        case "ol":
            return `${serializeList(el, true, 0)}\n`;
        default:
            // Inline wrappers (span, strong, em, …) — keep their text/children.
            return serializeChildren(el);
    }
}

/** A `<pre><code class="language-x">` block → a fenced code block, preserving the language and newlines. */
function serializeCodeBlock(pre: HTMLElement): string {
    const codeEl = pre.querySelector("code") ?? pre;
    const language = codeEl.className.match(/language-(\S+)/)?.[1] ?? "";
    // Code lines are separated by <br> in the data view; turn them back into real newlines.
    const clone = codeEl.cloneNode(true) as HTMLElement;
    clone.querySelectorAll("br").forEach((br) => br.replaceWith("\n"));
    const code = (clone.textContent ?? "").replace(/\n+$/, "");
    const fence = "```";
    return `${fence}${language}\n${code}\n${fence}\n\n`;
}

/** A `<ul>`/`<ol>` → markdown list markers, recursing into nested lists with two-space indentation. */
function serializeList(listEl: HTMLElement, ordered: boolean, depth: number): string {
    const indent = "  ".repeat(depth);
    let out = "";
    let index = 1;
    for (const item of Array.from(listEl.children)) {
        if (item.tagName.toLowerCase() !== "li") continue;
        const marker = ordered ? `${index++}.` : "-";

        let text = "";
        let nested = "";
        for (const child of Array.from(item.childNodes)) {
            const tag = child.nodeType === Node.ELEMENT_NODE ? (child as HTMLElement).tagName.toLowerCase() : "";
            if (tag === "ul" || tag === "ol") {
                nested += serializeList(child as HTMLElement, tag === "ol", depth + 1);
            } else {
                text += serializeNode(child);
            }
        }
        out += `${indent}${marker} ${text.trim()}\n${nested}`;
    }
    return out;
}
