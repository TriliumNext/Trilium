/**
 * A description read out of a page's own text, for a page that publishes none of itself.
 *
 * Plenty do not: a Wikipedia article carries `og:title` and `og:type` and nothing else, so a
 * preview of one showed a bare title where the page opens with a perfectly good sentence saying
 * what it is about. The card is worth more with that sentence than without it.
 *
 * Only ever a fallback. A description the site wrote for the purpose is what it wants shown, and is
 * always preferred to anything found here.
 */

/**
 * The part of a parsed document this reads.
 *
 * Described structurally rather than as node-html-parser's own `HTMLElement`, so that a caller is
 * not obliged to hold the very copy of the parser core resolves. A monorepo routinely ends up with
 * two, and two copies of the same parser are two nominally different types — which has nothing to
 * do with whether the tree can be read, and is not a constraint core has any business imposing on
 * the app that parsed the page.
 */
export interface PageElement {
    textContent: string;
    rawTagName?: string | null;
    parentNode: PageElement | null;
    querySelector(selector: string): PageElement | null;
    querySelectorAll(selector: string): PageElement[];
}

/** Below this a paragraph is a caption, a byline or a stray line of chrome rather than a summary. */
const MIN_LENGTH = 80;
/** What is kept. This ends up in the note's HTML, so it is bounded rather than left to the page. */
const MAX_LENGTH = 200;
/** Above this share of link text a paragraph is a row of navigation, whatever else it looks like. */
const MAX_LINK_SHARE = 0.5;

/**
 * Where a page's own writing tends to live. Tried in turn before the document at large, so that a
 * summary is taken from the article rather than from whatever prose the furniture around it holds.
 */
const CONTENT_SCOPES = [
    "article",
    "main",
    "[role=main]",
    // MediaWiki, which is the case this was written for.
    "#mw-content-text",
    "#content",
    ".post-content",
    ".entry-content"
];

/**
 * Elements whose text is never a description of the page: navigation, furniture, captions, and the
 * banners that sit above the content.
 *
 * Checked by walking up from each paragraph rather than by removing them, because this reads a
 * document that has already been parsed for the preview's other parts — stripping it here would
 * take the favicon and icon candidates with it.
 */
const IGNORED_ANCESTORS = new Set([
    "nav", "aside", "header", "footer", "form", "figure", "figcaption", "table", "script", "style", "noscript", "template"
]);

export function findPageDescription(document: PageElement): string | undefined {
    for (const scope of [ ...CONTENT_SCOPES.map((selector) => document.querySelector(selector)), document ]) {
        const summary = firstSummaryParagraph(scope);

        if (summary) {
            return summary;
        }
    }

    return undefined;
}

function firstSummaryParagraph(scope: PageElement | null): string | undefined {
    for (const paragraph of scope?.querySelectorAll("p") ?? []) {
        const text = collapseWhitespace(paragraph.textContent);

        if (text.length < MIN_LENGTH || hasIgnoredAncestor(paragraph) || isMostlyLinks(paragraph, text)) {
            continue;
        }

        return text.length > MAX_LENGTH ? `${text.slice(0, MAX_LENGTH).trimEnd()}…` : text;
    }

    return undefined;
}

function collapseWhitespace(text: string): string {
    return text.replace(/\s+/g, " ").trim();
}

function hasIgnoredAncestor(element: PageElement): boolean {
    for (let node = element.parentNode; node; node = node.parentNode) {
        if (IGNORED_ANCESTORS.has(node.rawTagName?.toLowerCase() ?? "")) {
            return true;
        }
    }

    return false;
}

/**
 * A cookie notice, a row of breadcrumbs or a footer of policy links can all be long enough to pass
 * for a summary. What they are not is prose: nearly every word in them is a link.
 */
function isMostlyLinks(paragraph: PageElement, text: string): boolean {
    const linked = paragraph.querySelectorAll("a")
        .reduce((total, anchor) => total + collapseWhitespace(anchor.textContent).length, 0);

    return linked > text.length * MAX_LINK_SHARE;
}
