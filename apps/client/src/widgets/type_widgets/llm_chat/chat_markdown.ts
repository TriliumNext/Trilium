import { CustomMarkdownRenderer, renderToHtml } from "@triliumnext/commons/src/lib/markdown_renderer";
import DOMPurify from "dompurify";
import type { Tokens } from "marked";

import { MESSAGE_JUMP_CLASS, QUOTE_SOURCE_HREF_PREFIX } from "./chat_quote.js";

/**
 * Renderer that decorates chat-specific markdown links:
 *  - `#root/...` note references get the `reference-link` class so ReadOnlyTextContent's
 *    applyReferenceLinks pass adds the note icon, color, and title (same shape as `[[noteId]]`).
 *  - `#mid-<id>` quote-source links become jump anchors (`chat-message-jump` + `data-message-id`)
 *    that {@link useChatMessageJumps} scrolls to. The id is validated so a hand-crafted link can't
 *    inject attributes.
 */
class ChatMarkdownRenderer extends CustomMarkdownRenderer {
    override link(token: Tokens.Link): string {
        const html = super.link(token);
        if (token.href.startsWith("#root/")) {
            return html.replace(/^<a\b/, '<a class="reference-link"');
        }
        if (token.href.startsWith(QUOTE_SOURCE_HREF_PREFIX)) {
            const id = token.href.slice(QUOTE_SOURCE_HREF_PREFIX.length);
            if (/^[A-Za-z0-9]+$/.test(id)) {
                return html.replace(/^<a\b/, `<a class="${MESSAGE_JUMP_CLASS}" data-message-id="${id}"`);
            }
        }
        return html;
    }
}

/**
 * Parse chat markdown to HTML using the shared rendering pipeline. The output is CKEditor's storage
 * form (math as `math-tex` spans, mermaid as `language-mermaid` code blocks, plain code blocks,
 * `reference-link` anchors), so it renders identically in the chat timeline and in a saved text note.
 */
export function renderMarkdown(markdown: string): string {
    return renderToHtml(markdown, "", {
        sanitize: (h) => DOMPurify.sanitize(h),
        wikiLink: { formatHref: (id) => `#root/${id}` },
        demoteH1: false,
        renderer: new ChatMarkdownRenderer({ async: false })
    });
}
