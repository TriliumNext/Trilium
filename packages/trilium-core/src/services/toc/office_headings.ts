import {
    decodeHtmlEntities, DOCX_MIME, escapeHtml, MAX_TOC_HEADINGS, normalizeTocTitle, ODT_MIME
} from "@triliumnext/commons";
import { HTMLElement, type Node, parse, TextNode } from "node-html-parser";

import { decodeUtf8, wrapStringOrBuffer } from "../utils/binary.js";
import { getZipProvider } from "../zip_provider.js";
import { getHeadingIds, type TocPreviewSource } from "./index.js";

/** A heading of an office document's preview, as its table of contents reads it. */
export interface PreviewHeading {
    /** Normalized with `normalizeTocTitle()`, never empty. */
    title: string;
    /** The depth among the headings before it, 1 for the top level. */
    level: number;
    /** The offset in the HTML of the heading's start tag, `<h2`. */
    tagOffset: number;
}

/**
 * The start of a heading's start tag. `officeparser` escapes `<` and `>` in text and in attribute
 * values, so every match is a tag.
 */
const HEADING_START = /<h([1-6])(?=[\s>])/g;
/** The length of `<h2`, after which a heading's start tag takes an attribute. */
const TAG_NAME_END = 3;
/** A start tag with an `id`: its tag name and the escaped value of the id. */
const ELEMENT_ID = /<([a-zA-Z][a-zA-Z0-9]*)\b[^>]*?\sid="([^"]*)"/g;
/** The form of the ids that `officeparser` gives notes and their marks. */
const NOTE_ID = /^footnote-/;

/**
 * Where the bookmarks of a format are, by MIME type: the main part, the attribute that names a
 * bookmark, and the attributes that `officeparser` turns into ids too. In DOCX, only bookmarks
 * give ids. `w:anchor` and `text:ref-name` only point at a bookmark, so they are not among them.
 */
const BOOKMARK_SOURCES: Record<string, { part: string; bookmarks: RegExp; otherIds?: RegExp }> = {
    [DOCX_MIME]: {
        part: "word/document.xml",
        bookmarks: /<w:bookmarkStart\b[^>]*?\sw:name="([^"]*)"/g
    },
    [ODT_MIME]: {
        part: "content.xml",
        bookmarks: /<text:bookmark(?:-start)?\b[^>]*?\stext:name="([^"]*)"/g,
        otherIds: /\s(?:xml:id|text:id|table:name|draw:name)="([^"]*)"/g
    }
};

/**
 * The headings of `html`, the preview of an office document, in document order: every `h1` to
 * `h6` with a title, at most `MAX_TOC_HEADINGS`. `isCut` tells whether a heading with a title
 * follows the last one kept.
 */
export function readPreviewHeadings(html: string): { headings: PreviewHeading[]; isCut: boolean } {
    const headings: PreviewHeading[] = [];
    // The kept headings that can be the parent of the next one, by the number of their tag.
    const path: { tagLevel: number; level: number }[] = [];
    for (const match of html.matchAll(HEADING_START)) {
        const tagOffset = match.index;
        const tagLevel = Number(match[1]);
        const contentStart = html.indexOf(">", tagOffset) + 1;
        const contentEnd = html.indexOf(`</h${tagLevel}>`, contentStart);
        if (contentStart === 0 || contentEnd === -1) {
            continue;
        }

        const title = normalizeTocTitle(readTitle(html.slice(contentStart, contentEnd)));
        if (!title) {
            continue;
        }
        if (headings.length === MAX_TOC_HEADINGS) {
            return { headings, isCut: true };
        }

        while (path.length > 0 && path[path.length - 1].tagLevel >= tagLevel) {
            path.pop();
        }
        const level = (path.at(-1)?.level ?? 0) + 1;
        path.push({ tagLevel, level });
        headings.push({ title, level, tagOffset });
    }
    return { headings, isCut: false };
}

/** A bookmark of an office document, and the element of the preview that has its name as id. */
export interface PreviewBookmark {
    name: string;
    /** The offset in the HTML of the element's start tag. */
    tagOffset: number;
    /** The offset in the HTML of the end of the element's tag name. */
    tagNameEnd: number;
}

/**
 * The bookmarks of `names` that exactly one element of `html`, the preview of an office document,
 * has as its `id`, in the order of `names`. When two elements have the id, nothing tells which
 * one is the bookmark.
 */
export function readPreviewBookmarks(html: string, names: string[]): PreviewBookmark[] {
    const elements = new Map<string, { tagOffset: number; tagNameEnd: number; count: number }>();
    for (const match of html.matchAll(ELEMENT_ID)) {
        const id = decodeHtmlEntities(match[2]);
        const element = elements.get(id);
        if (element) {
            element.count++;
        } else {
            const tagNameEnd = match.index + 1 + match[1].length;
            elements.set(id, { tagOffset: match.index, tagNameEnd, count: 1 });
        }
    }

    const bookmarks: PreviewBookmark[] = [];
    for (const name of names) {
        const element = elements.get(name);
        if (element?.count === 1) {
            bookmarks.push({ name, tagOffset: element.tagOffset, tagNameEnd: element.tagNameEnd });
        }
    }
    return bookmarks;
}

/**
 * The names of the bookmarks of the office document `content` of `mime` that can be targets, in
 * document order: read from its main part, without the names that an editor makes itself (they
 * start with `_`), the names that another source of ids in the preview could give, and repeats.
 * A document whose main part cannot be read has none.
 */
export async function readBookmarkNames(content: Uint8Array | string, mime: string) {
    const source = BOOKMARK_SOURCES[mime];
    if (!source) {
        return [];
    }

    let xml = "";
    try {
        await getZipProvider().readZipFile(wrapStringOrBuffer(content),
            async ({ fileName }, readContent) => {
                if (fileName === source.part) {
                    xml = decodeUtf8(await readContent());
                }
            });
    } catch {
        return [];
    }

    const takenIds = new Set(source.otherIds
        ? Array.from(xml.matchAll(source.otherIds), (match) => decodeHtmlEntities(match[1]))
        : []);
    const names = new Set<string>();
    for (const match of xml.matchAll(source.bookmarks)) {
        const name = decodeHtmlEntities(match[1]);
        if (name && !name.startsWith("_") && !NOTE_ID.test(name) && !takenIds.has(name)) {
            names.add(name);
        }
    }
    return [ ...names ];
}

/**
 * `html`, the preview of an office document read from the blob of `source`, with the id of each
 * heading in its start tag as `data-toc-heading`, and the name of each of `bookmarkNames` that
 * `readPreviewBookmarks()` finds in the start tag of its element as `data-toc-bookmark`. Every
 * other byte stays as it is.
 */
export function markOfficePreview(
    html: string,
    { blobId, isProtected }: Omit<TocPreviewSource, "content">,
    bookmarkNames: string[] = []
) {
    const { headings, isCut } = readPreviewHeadings(html);
    const ids = getHeadingIds(headings, blobId, isProtected, isCut);
    const insertions = [
        ...headings.map(({ tagOffset }, index) =>
            ({ at: tagOffset + TAG_NAME_END, text: ` data-toc-heading="${ids[index]}"` })),
        ...readPreviewBookmarks(html, bookmarkNames).map(({ name, tagNameEnd }) =>
            ({ at: tagNameEnd, text: ` data-toc-bookmark="${escapeHtml(name)}"` }))
    ];
    // Stable: a heading's mark stays before the mark of its bookmark.
    insertions.sort((a, b) => a.at - b.at);

    const parts: string[] = [];
    let copied = 0;
    for (const { at, text } of insertions) {
        parts.push(html.slice(copied, at), text);
        copied = at;
    }
    parts.push(html.slice(copied));
    return parts.join("");
}

/**
 * The text of a heading's inner HTML as the preview shows it, without the marks of footnotes and
 * endnotes, and with a space for each line break.
 */
function readTitle(innerHtml: string) {
    const parts: string[] = [];
    const stack: Node[] = [ parse(innerHtml) ];
    while (stack.length > 0) {
        const node = stack.pop();
        if (node instanceof TextNode) {
            parts.push(node.text);
        } else if (node instanceof HTMLElement) {
            if (node.tagName === "BR") {
                parts.push(" ");
            } else if (!(node.tagName === "SUP" && node.hasAttribute("data-footnote-ref"))) {
                stack.push(...node.childNodes.toReversed());
            }
        }
    }
    return parts.join("");
}
