import {
    decodeHtmlEntities, DOCX_MIME, MAX_TOC_HEADINGS, normalizeTocTitle, ODT_MIME
} from "@triliumnext/commons";
import { HTMLElement, type Node, parse } from "node-html-parser";

import { decodeUtf8, wrapStringOrBuffer } from "../utils/binary.js";
import { readZipPart } from "../utils/zip_records.js";
import { createLevelTracker, getHeadingIds, type TocPreviewSource } from "./index.js";
import { indexElementIds, writePreviewMarks } from "./preview_marks.js";

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
/** The form of the ids that `officeparser` gives notes and their marks. */
const NOTE_ID = /^footnote-/;
/**
 * The most bytes that the main part of a document can declare. Matches the `maxUncompressedBytes`
 * of `officeparser`, which refuses to preview a document whose parts inflate to more.
 */
const MAX_MAIN_PART_BYTES = 512 * 1024 * 1024;

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
 * `h6` with a title, at most `MAX_TOC_HEADINGS`, nested by the number of their tag. `isCut` tells
 * whether a heading with a title follows the last one kept.
 */
export function readPreviewHeadings(html: string): { headings: PreviewHeading[]; isCut: boolean } {
    const headings: PreviewHeading[] = [];
    const toLevel = createLevelTracker();
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
        headings.push({ title, level: toLevel(tagLevel), tagOffset });
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
    const elements = indexElementIds(html, new Set(names));
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
        const part = await readZipPart(
            wrapStringOrBuffer(content), source.part, MAX_MAIN_PART_BYTES);
        xml = part ? decodeUtf8(part) : "";
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
 * heading in its start tag, and the name of each of `bookmarkNames` that `readPreviewBookmarks()`
 * finds in the start tag of its element (`writePreviewMarks()`).
 */
export function markOfficePreview(
    html: string,
    { blobId, isProtected }: Omit<TocPreviewSource, "content">,
    bookmarkNames: string[] = []
) {
    const { headings, isCut } = readPreviewHeadings(html);
    const ids = getHeadingIds(headings, blobId, isProtected, isCut);
    return writePreviewMarks(html,
        headings.map(({ tagOffset }, index) => ({ at: tagOffset + TAG_NAME_END, id: ids[index] })),
        readPreviewBookmarks(html, bookmarkNames).map(({ name, tagNameEnd }) =>
            ({ at: tagNameEnd, name })));
}

/**
 * The text of a heading's inner HTML as the preview shows it, without the marks of footnotes and
 * endnotes, and with a space for each line break.
 */
function readTitle(innerHtml: string) {
    const parts: string[] = [];
    const stack: Node[] = [ parse(innerHtml) ];
    for (let node = stack.pop(); node; node = stack.pop()) {
        if (!(node instanceof HTMLElement)) {
            parts.push(node.text);
        } else if (node.tagName === "BR") {
            parts.push(" ");
        } else if (!(node.tagName === "SUP" && node.hasAttribute("data-footnote-ref"))) {
            stack.push(...node.childNodes.toReversed());
        }
    }
    return parts.join("");
}
