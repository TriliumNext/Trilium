import { demoteHeadings } from "@triliumnext/commons/src/lib/markdown_renderer.js";

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

export default {
    handleH1,
    extractHtmlTitle
};
