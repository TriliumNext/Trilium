import type { AttributeType } from "@triliumnext/commons";
import { demoteHeadings } from "@triliumnext/commons/src/lib/markdown_renderer.js";

import attributeService from "../attributes.js";
import { unescapeHtml } from "../utils";

function handleH1(content: string, title: string) {
    // Reserve <h1> for the note title and shift the content hierarchy to fit the
    // editor's <h2>–<h6> range (see #8383). Pass our own `unescapeHtml`, which —
    // unlike the markdown renderer's — only decodes the five basic HTML entities.
    return demoteHeadings(content, title, unescapeHtml);
}

function extractHtmlTitle(content: string): string | null {
    const titleMatch = content.match(/<title[^>]*>([^<]+)<\/title>/i);
    return titleMatch ? titleMatch[1].trim() : null;
}

/**
 * Returns the name an imported attribute is saved under. With Safe import on, a dangerous attribute (see
 * `isAttributeDangerous()`) is prefixed with `disabled:`, so it is kept but has no effect.
 */
export function importedAttributeName(type: AttributeType, name: string, safeImport: boolean | undefined): string {
    return safeImport && attributeService.isAttributeDangerous(type, name) ? `disabled:${name}` : name;
}

export default {
    handleH1,
    extractHtmlTitle
};
