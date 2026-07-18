/**
 * Post-processes a Google Keep note's rich-text HTML (`textContentHtml` / a list item's `textHtml`) into
 * Trilium/CKEditor-friendly markup.
 *
 * Keep exports Google-Docs-style HTML: semantic block tags (`<h1>`, `<h2>`, `<p>`) whose every run of text
 * is a `<span>` carrying a large inline `style` (font, colour, and — the bits we care about — `font-weight`,
 * `font-style`, `text-decoration`). This module keeps the block structure but converts those styled spans
 * into `<strong>`/`<i>`/`<u>` and drops the inline-style noise. Heading-level demotion (Trilium reserves
 * `<h1>` for the note title) and final XSS sanitization are left to the sanitizer applied downstream.
 *
 * Only basic formatting (bold/italic/underline) is in scope; other inline styling (colour, font size, …)
 * is intentionally discarded.
 */

import { HTMLElement, parse } from "node-html-parser";

/** Converts a Keep block-level rich-text fragment (a note's `textContentHtml`), preserving block structure. */
export function convertKeepHtml(html: string): string {
    const root = parse(html);
    clean(root);
    return root.toString();
}

/**
 * Converts a Keep list item's `textHtml` to inline markup for a checklist label. Keep wraps each item's
 * text in a single block element (a `<p>`); unwrap it so the result sits directly inside the label, falling
 * back to the cleaned markup as-is when the shape is unexpected.
 */
export function convertKeepHtmlInline(html: string): string {
    const root = parse(html);
    clean(root);

    const elements = root.childNodes.filter((node): node is HTMLElement => node instanceof HTMLElement);
    return elements.length === 1 ? elements[0].innerHTML : root.toString();
}

/** Rewrites styled spans to semantic inline tags, then strips the leftover presentational attributes. */
function clean(root: HTMLElement) {
    convertStyledSpans(root);
    stripNoiseAttributes(root);
}

/**
 * Replaces each `<span>` with its content wrapped in the inline tags its style implies — `<strong>` for a
 * bold font weight, `<i>` for italic, `<u>` for underline — dropping the span (and its style) itself. A span
 * with no relevant styling is simply unwrapped. Processed in reverse document order so a nested span is
 * converted before the span that contains it.
 */
function convertStyledSpans(root: HTMLElement) {
    for (const span of [...root.querySelectorAll("span")].reverse()) {
        const style = span.getAttribute("style") ?? "";

        let inner = span.innerHTML;
        if (isUnderline(style)) {
            inner = `<u>${inner}</u>`;
        }
        if (isItalic(style)) {
            inner = `<i>${inner}</i>`;
        }
        if (isBold(style)) {
            inner = `<strong>${inner}</strong>`;
        }

        span.insertAdjacentHTML("beforebegin", inner);
        span.remove();
    }
}

/** Removes the presentational `style`/`dir` attributes Keep puts on every block, leaving clean semantic tags. */
function stripNoiseAttributes(root: HTMLElement) {
    for (const element of root.querySelectorAll("*")) {
        element.removeAttribute("style");
        element.removeAttribute("dir");
    }
}

function isBold(style: string): boolean {
    const weight = style.match(/font-weight:\s*(\d+)/);
    return weight ? Number(weight[1]) >= 600 : /font-weight:\s*bold/.test(style);
}

function isItalic(style: string): boolean {
    return /font-style:\s*italic/.test(style);
}

function isUnderline(style: string): boolean {
    // Keep also emits `text-decoration-skip-ink`/`-webkit-text-decoration-skip`; the `text-decoration:`
    // anchor (colon immediately after the property) matches only the real shorthand, not those.
    return /text-decoration:\s*[^;]*underline/.test(style);
}
