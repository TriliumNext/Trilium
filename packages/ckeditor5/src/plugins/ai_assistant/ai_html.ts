/**
 * Pure HTML helpers for the AI assistant: making a streamed model response safe to show in the
 * preview element, and undoing the models' habit of wrapping HTML output in markdown fences.
 *
 * The commit path (Replace / Insert below) does not rely on this — it goes through the editor's
 * data pipeline, where the schema drops anything the editor cannot represent. Sanitizing here
 * only protects the raw `innerHTML` preview.
 */

const DISALLOWED_ELEMENTS = ["script", "style", "iframe", "object", "embed", "link", "meta", "form"];

/**
 * Strips active content from an HTML string so it can be assigned to the preview's `innerHTML`:
 * script-like elements, `on*` event attributes, and `javascript:` URLs.
 */
export function sanitizeAiHtml(html: string): string {
    const doc = new DOMParser().parseFromString(html, "text/html");

    for (const element of doc.querySelectorAll(DISALLOWED_ELEMENTS.join(","))) {
        element.remove();
    }

    for (const element of doc.body.querySelectorAll("*")) {
        for (const attribute of Array.from(element.attributes)) {
            const name = attribute.name.toLowerCase();
            const isEventHandler = name.startsWith("on");
            const isScriptUrl = (name === "href" || name === "src")
                && attribute.value.trim().toLowerCase().startsWith("javascript:");
            if (isEventHandler || isScriptUrl) {
                element.removeAttribute(attribute.name);
            }
        }
    }

    return doc.body.innerHTML;
}

/**
 * Removes a leading markdown code fence (```html or ```) and, when present, the matching closing
 * fence. Models add these despite instructions not to; the stripper is applied to the cumulative
 * stream, so it must also handle a fence whose closing half has not arrived yet.
 */
export function stripMarkdownFences(cumulative: string): string {
    const opening = /^\s*```[a-z]*\s*\n?/i.exec(cumulative);
    if (!opening) {
        return cumulative;
    }

    let body = cumulative.slice(opening[0].length);
    const closingIndex = body.lastIndexOf("```");
    if (closingIndex !== -1 && body.slice(closingIndex + 3).trim() === "") {
        body = body.slice(0, closingIndex);
    }
    return body;
}
