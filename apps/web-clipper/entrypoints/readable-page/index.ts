import Defuddle from "defuddle";

import { descriptionLabels, getImages, getPageLocationOrigin, type PageVariant, type ReadablePage } from "@/utils";

/**
 * Registers `triliumReadPage()` in the tab, which reads the page with Defuddle, as an article or as a
 * whole. `extractPage()` injects it into the tab only when a page is read, so Defuddle does not load
 * with the content script on every page, then calls it with the reading it needs.
 */
export default defineUnlistedScript(() => {
    globalThis.triliumReadPage = readPage;
});

/**
 * Keeps all of `<body>`: Defuddle still removes hidden elements, makes links absolute and converts
 * embeds, but none of what it scores as clutter, which on a page without an article is the content.
 */
const WHOLE_PAGE_OPTIONS = {
    contentSelector: "body",
    removeLowScoring: false,
    removeExactSelectors: false,
    removePartialSelectors: false,
    removeContentPatterns: false,
    removeSmallImages: false
};

/** The page as `variant` reads it, or `undefined` when that reading shows nothing. */
function readPage(variant: PageVariant): ReadablePage | undefined {
    // `parse()` works on a copy of the document and reads styles and image sizes from the page,
    // so it is given the live document.
    const options = variant === "wholePage" ? WHOLE_PAGE_OPTIONS : {};
    const result = new Defuddle(document, { url: location.href, ...options }).parse();

    // A document of its own loads none of the page's images and runs none of its code.
    const body = new DOMParser().parseFromString(result.content, "text/html").body;
    if (!body.textContent.trim() && !body.querySelector("img")) {
        return undefined;
    }

    const images = getImages(body);
    return {
        title: result.title,
        content: body.innerHTML,
        images,
        pageUrl: getPageLocationOrigin() + location.pathname + location.search,
        clipType: "page",
        labels: pageLabels(result)
    };
}

function pageLabels(article: { author: string, published: string }) {
    const labels = descriptionLabels();
    const author = article.author.replace(/\s+/g, " ").trim();
    if (author) {
        labels['pageAuthor'] = author;
    }
    const publishedDate = isoDate(metaContent("article:published_time") || article.published);
    if (publishedDate) {
        labels['publishedDate'] = publishedDate;
    }
    const modifiedDate = isoDate(metaContent("article:modified_time"));
    if (modifiedDate) {
        labels['modifiedDate'] = modifiedDate;
    }
    return labels;
}

function metaContent(property: string) {
    return document.querySelector(`meta[property='${property}']`)?.getAttribute("content") ?? undefined;
}

/**
 * The `YYYY-MM-DD` that `value` starts with, or `undefined` when it does not start with one. The day
 * is the one the page states: converting a timestamp to UTC can move it to the day before or after.
 */
function isoDate(value: string | undefined) {
    return /^\d{4}-\d{2}-\d{2}/.exec(value?.trim() ?? "")?.[0];
}
