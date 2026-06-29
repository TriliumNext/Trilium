/**
 * Resolves OneNote page-to-page hyperlinks against the notes created by an import.
 *
 * OneNote stores an internal link as an `onenote:` anchor carrying the target's identity in a
 * `page-id={GUID}` query parameter, e.g.
 *   `onenote:#Second%20page&section-id={…}&page-id={eb2c4f67-…}&end`
 * That GUID is NOT the Graph page `id` (a composite like `0-{guid}!{n}-{guid}`); the bridge between the
 * two is the page's own `links.oneNoteClientUrl`, which embeds the same `page-id={GUID}`. So the
 * importer builds a `page-id GUID → {noteId, title}` map from each imported page's client URL, then
 * rewrites every `onenote:` link whose target was imported into a Trilium internal link.
 *
 * When the link's text matches the target page's title, it becomes a Trilium *reference link* (a chip
 * that renders the live note title) and the redundant adjacent "Web view" https link OneNote emits
 * alongside it is dropped. Otherwise the original link text is kept on a plain internal link.
 *
 * The pure functions here (extractPageId, rewritePageLinks) carry no DB/Graph dependency, so the
 * two-pass resolution can be unit-tested with a plain resolver callback.
 */

import { HTMLElement, type Node, NodeType, parse, TextNode } from "node-html-parser";

const GUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";

/** A resolved import target: the note created for a OneNote page, plus that page's title. */
export interface LinkTarget {
    noteId: string;
    title: string;
}

/** Pulls the OneNote page-id GUID out of a link/URL, lowercased; null if there is none. */
export function extractPageId(url: string | null | undefined): string | null {
    const match = url?.match(new RegExp(`page-id=\\{?(${GUID})\\}?`, "i"));
    return match ? match[1].toLowerCase() : null;
}

/**
 * Rewrites the page's `onenote:` internal links: a link whose target page-id resolves (via `resolve`)
 * to an imported note becomes a Trilium internal link (`#root/{noteId}`). If the link text matches the
 * target's title it is rendered as a reference link and the adjacent redundant "Web view" link is
 * removed; otherwise the original text is preserved on a plain link. Links to pages outside the import
 * — and all non-`onenote:` links — are left untouched. Returns the input unchanged when nothing was
 * rewritten, so callers can cheaply detect a no-op.
 */
export function rewritePageLinks(html: string, resolve: (pageId: string) => LinkTarget | null): string {
    const root = parse(html);
    let changed = false;

    for (const anchor of root.querySelectorAll("a")) {
        const href = anchor.getAttribute("href") ?? "";
        if (!href.startsWith("onenote:")) {
            continue;
        }
        const pageId = extractPageId(href);
        const target = pageId ? resolve(pageId) : null;
        if (!pageId || !target) {
            continue;
        }

        anchor.setAttribute("href", `#root/${target.noteId}`);
        if (textMatchesTitle(anchor.textContent, target.title)) {
            anchor.setAttribute("class", "reference-link");
            dropRedundantWebViewLink(anchor, pageId);
        }
        changed = true;
    }

    return changed ? root.toString() : html;
}

function textMatchesTitle(text: string, title: string): boolean {
    return text.trim().toLowerCase() === title.trim().toLowerCase();
}

/**
 * Removes the "Web view" https link OneNote emits right after an internal link to the same page (it
 * carries the same page-id GUID), along with the `(…)` wrapper text around it, so what's left reads as
 * a single clean reference link rather than "Link ()".
 */
function dropRedundantWebViewLink(internalAnchor: HTMLElement, pageId: string) {
    const web = internalAnchor.nextElementSibling;
    if (!web || web.rawTagName?.toLowerCase() !== "a") {
        return;
    }
    const webHref = web.getAttribute("href") ?? "";
    // The web link is the same page's counterpart when its URL embeds the page-id GUID; guard against
    // accidentally matching an already-rewritten internal link.
    if (webHref.startsWith("#root/") || !containsGuid(webHref, pageId)) {
        return;
    }

    const before = internalAnchor.nextSibling;
    const after = web.nextSibling;
    web.remove();

    // Strip the surrounding "( … )" if the web link sat inside parentheses (the common OneNote shape).
    if (isText(before) && isText(after) && /\(\s*$/.test(before.rawText) && /^\s*\)/.test(after.rawText)) {
        before.rawText = before.rawText.replace(/\s*\(\s*$/, "");
        after.rawText = after.rawText.replace(/^\s*\)/, "");
    }
}

function containsGuid(url: string, guid: string): boolean {
    return url.toLowerCase().includes(guid.toLowerCase());
}

function isText(node: Node | null | undefined): node is TextNode {
    return node?.nodeType === NodeType.TEXT_NODE;
}
