import {
    decodeHtmlEntities, escapeHtml, TOC_BOOKMARK_ATTRIBUTE, TOC_HEADING_ATTRIBUTE
} from "@triliumnext/commons";

/** An element of a document preview that has an id. */
export interface IdElement {
    tagName: string;
    /** The offset in the HTML of the element's start tag. */
    tagOffset: number;
    /** The offset in the HTML of the end of the element's tag name. */
    tagNameEnd: number;
    /** How many elements of the HTML have the id. */
    count: number;
}

/** A start tag with an `id`: its tag name and the escaped value of the id. */
const ELEMENT_ID = /<([a-zA-Z][a-zA-Z0-9]*)\b[^>]*?\sid="([^"]*)"/g;

/**
 * `html`, a document preview, with `TOC_HEADING_ATTRIBUTE` in the start tag of each element that a
 * heading of `headings` lands on, and `TOC_BOOKMARK_ATTRIBUTE` in the start tag of the element of
 * each of `bookmarks`. `at` is the offset of the end of the element's tag name. The headings that
 * land on one element share one attribute, their ids separated by spaces in the order of
 * `headings`, and it comes before the element's bookmark. Every other byte stays as it is.
 */
export function writePreviewMarks(
    html: string, headings: { at: number; id: string }[],
    bookmarks: { at: number; name: string }[] = []
) {
    const idsByElement = new Map<number, string[]>();
    for (const { at, id } of headings) {
        const ids = idsByElement.get(at);
        if (ids) {
            ids.push(id);
        } else {
            idsByElement.set(at, [ id ]);
        }
    }
    return spliceInsertions(html, [
        ...Array.from(idsByElement, ([ at, ids ]) =>
            ({ at, text: ` ${TOC_HEADING_ATTRIBUTE}="${ids.join(" ")}"` })),
        ...bookmarks.map(({ at, name }) =>
            ({ at, text: ` ${TOC_BOOKMARK_ATTRIBUTE}="${escapeHtml(name)}"` }))
    ]);
}

/**
 * The elements of `html`, a document preview, whose id is one of `ids`, by id: the first element
 * with each id, and how many elements have it.
 */
export function indexElementIds(html: string, ids: ReadonlySet<string>) {
    const elements = new Map<string, IdElement>();
    for (const match of html.matchAll(ELEMENT_ID)) {
        const id = decodeHtmlEntities(match[2]);
        if (!ids.has(id)) {
            continue;
        }
        const element = elements.get(id);
        if (element) {
            element.count++;
        } else {
            const tagName = match[1];
            const tagOffset = match.index;
            const tagNameEnd = tagOffset + 1 + tagName.length;
            elements.set(id, { tagName, tagOffset, tagNameEnd, count: 1 });
        }
    }
    return elements;
}

/**
 * `text` with each insertion's text at its offset `at`. Insertions at one offset keep their order
 * in `insertions`; every other character stays as it is.
 */
export function spliceInsertions(text: string, insertions: { at: number; text: string }[]) {
    const sorted = insertions.toSorted((a, b) => a.at - b.at);
    const parts: string[] = [];
    let copied = 0;
    for (const insertion of sorted) {
        parts.push(text.slice(copied, insertion.at), insertion.text);
        copied = insertion.at;
    }
    parts.push(text.slice(copied));
    return parts.join("");
}
