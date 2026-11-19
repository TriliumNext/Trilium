import { EPUB_MIME_TYPES } from "@triliumnext/commons";

import { convertOfficeToHtml, MAX_OFFICE_PREVIEW_BYTES } from "../office_preview.js";
import { decodeUtf8, encodeUtf8 } from "../utils/binary.js";
import {
    byteSourceOf, readEntryContent, readZipIndex, rewriteZip, type ZipRecord, ZipRecordError
} from "../utils/zip_records.js";
import {
    EPUB_TOC_READER, type TocPassDestination, type TocPassEntry, type TocPassOutcome,
    type TocPassRecord, TocPassRefusal
} from "./epub.js";
import { readBookToc } from "./epub_package.js";
import { getHeadingIds, type GeneratedToc, type TocPreviewSource } from "./index.js";
import { isOfficeInputFailure } from "./office.js";
import { indexElementIds, spliceInsertions, writePreviewMarks } from "./preview_marks.js";
import { readTokens, VOID_ELEMENTS } from "./xml.js";

/** The most bytes that the pass inflates from a book: package, table of contents and chapters. */
const MAX_EPUB_PASS_TEXT_BYTES = 128 * 1024 * 1024;

/** The parts of a table whose marker goes into their first cell. */
const TABLE_PARTS = new Set([ "tr", "thead", "tbody", "tfoot" ]);
/** The start of every marker prefix: `trilium_toc_`, then `trilium_toc2_` and so on. */
const MARKER_STEM = "trilium_toc";
/** The forms of the ids that `officeparser` writes itself. */
const CONVERTER_ID = /^(?:footnote-|html-quote-|sheet-)/;
/** The empty anchor that `officeparser` writes for a block's second id, before the block. */
const CONVERTER_ANCHOR = /<a id="[^"]*" name="[^"]*"><\/a>/y;
/** A run of the converter's anchors and the start tag of the element that they stand for. */
const ANCHOR_RUN = /(?:<a id="[^"]*" name="[^"]*"><\/a>\s*)+<([a-zA-Z][a-zA-Z0-9]*)(?=[\s/>])/y;
/** A run of start tags and the white space between them. */
const START_TAG_RUN = /(?:\s*<[a-zA-Z][^>]*>)*/y;
const strictUtf8 = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true });

/**
 * Runs the ToC pass on `bytes`, an EPUB, and converts the marked archive with `convert`. Answers
 * the HTML only for the outcome `marked`. A marked archive that `officeparser` refuses as input is
 * `refused`, since the same bytes always give the same archive.
 */
export async function convertMarkedEpub(
    bytes: Uint8Array, convert: (bytes: Uint8Array) => Promise<string>
): Promise<{ outcome: TocPassOutcome; html?: string }> {
    const outcome = await runTocPass(bytes);
    if (outcome.status !== "marked") {
        return { outcome };
    }
    try {
        return { outcome, html: await convert(outcome.bytes) };
    } catch (error) {
        if (isOfficeInputFailure(error)) {
            return { outcome: { status: "refused", reason: "REWRITE" } };
        }
        throw error;
    }
}

/**
 * Places an empty anchor, a marker, at each place that an entry of the table of contents of
 * `bytes`, an EPUB, names, and writes the archive again with them. Every other entry of the archive
 * is copied as it is. The text that the pass inflates and the markers it adds stay within
 * `budget` bytes. Throws for a failure that another run might not meet.
 */
export async function runTocPass(
    bytes: Uint8Array, budget = MAX_EPUB_PASS_TEXT_BYTES
): Promise<TocPassOutcome> {
    try {
        return await placeMarkers(bytes, budget);
    } catch (error) {
        if (error instanceof TocPassRefusal || error instanceof ZipRecordError) {
            return { status: "refused", reason: error.reason };
        }
        throw error;
    }
}

/**
 * The table of contents of the EPUB `content`, as the ToC cache keeps it: the authored outline,
 * with the entries that the preview does not show marked `isShown: false`.
 */
export async function readEpubToc(content: Uint8Array | string): Promise<GeneratedToc> {
    let outcome: TocPassOutcome | undefined;
    const html = await convertOfficeToHtml(content, EPUB_MIME_TYPES[0], {
        onTocPass: (passed) => {
            outcome = passed;
        }
    });
    const properties = { reader: EPUB_TOC_READER };
    switch (outcome?.status) {
        case "marked": {
            const { entries, isCut } = outcome.record;
            const landings = findLandings(html, outcome.record);
            return {
                headings: entries.map(({ title, level }, index) => (landings[index] === undefined
                    ? { title, level, isShown: false }
                    : { title, level })),
                isCut,
                properties
            };
        }
        case "refused":
            throw new TocPassRefusal(outcome.reason);
        case "failed":
            throw outcome.error;
        default:
            return { headings: [], properties };
    }
}

/**
 * `html`, the preview of an EPUB converted from the archive that the pass of `record` marked, with
 * the ids of the entries that land on each element written into its start tag, in the order of
 * the table of contents (`writePreviewMarks()`).
 */
export function markEpubPreview(
    html: string, record: TocPassRecord, { blobId, isProtected }: Omit<TocPreviewSource, "content">
) {
    const ids = getHeadingIds(record.entries, blobId, isProtected, record.isCut);
    return writePreviewMarks(html, findLandings(html, record).flatMap((at, index) =>
        (at === undefined ? [] : [ { at, id: ids[index] } ])));
}

/**
 * The landing of each entry of `record` in `html`: the offset of the end of the tag name of the
 * element it lands on, or `undefined` for an entry that is not shown.
 */
export function findLandings(html: string, record: TocPassRecord): (number | undefined)[] {
    const elements = indexElementIds(html, new Set(record.destinations.flatMap(
        ({ marker, bookId }) => (bookId === undefined ? [ marker ] : [ marker, bookId ]))));

    const found = record.destinations.map(({ marker, bookId }) => {
        const markerElement = elements.get(marker);
        const place = markerElement?.count === 1 ? resolveElement(html, markerElement) : undefined;
        const book = bookId === undefined ? undefined : elements.get(bookId);
        if (!place || book?.count !== 1) {
            return place;
        }
        const bookPlace = resolveElement(html, book);
        const isSame = bookPlace !== undefined && (bookPlace.tagOffset === place.tagOffset
            || opensBefore(html, place.tagOffset, bookPlace.tagOffset));
        return isSame ? place : undefined;
    });

    const { entries } = record;
    const own = entries.map(({ destination }) =>
        (destination === undefined || destination < 0
            ? undefined
            : found[destination]?.tagNameEnd));
    // Where each subtree ends: the first entry after it at its level or above.
    const subtreeEnds = new Array<number>(entries.length).fill(entries.length);
    const open: number[] = [];
    for (const [ index, { level } ] of entries.entries()) {
        let last = open.at(-1);
        while (last !== undefined && entries[last].level >= level) {
            subtreeEnds[last] = index;
            open.pop();
            last = open.at(-1);
        }
        open.push(index);
    }
    // From the last entry to the first: the first entry at or after each that lands on its own.
    const landings = new Array<number | undefined>(entries.length);
    let nextLanded = entries.length;
    for (let index = entries.length - 1; index >= 0; index--) {
        if (entries[index].destination === undefined) {
            landings[index] = nextLanded < subtreeEnds[index] ? own[nextLanded] : undefined;
        } else {
            landings[index] = own[index];
            if (own[index] !== undefined) {
                nextLanded = index;
            }
        }
    }
    return landings;
}

/** The archive of a book, and what remains of the budget of the text that the pass inflates. */
interface Book {
    bytes: Uint8Array;
    records: Map<string, ZipRecord>;
    remaining: number;
}

/** A start tag that a marker is placed at. */
interface TargetElement {
    name: string;
    start: number;
    end: number;
    isEmpty: boolean;
    /** The start of the outermost `<a>` around the element, the element included. */
    anchorStart?: number;
    /** For a part of a table, the end of the start tag of its first cell. */
    firstCellEnd?: number;
}

/** What the pass reads in a chapter. */
interface ChapterScan {
    text: string;
    /** The end of the start tag of `<body>`. */
    bodyEnd?: number;
    /** The first element whose `id` is a fragment, by fragment. */
    byId: Map<string, TargetElement>;
    /** The first `<a>` whose `name` is a fragment, by fragment. */
    byName: Map<string, TargetElement>;
    /** How many elements have each fragment as `id` or, on an `<a>`, as `name`. */
    counts: Map<string, number>;
    /** The ids and names that start with `MARKER_STEM`. */
    stemValues: string[];
}

async function placeMarkers(bytes: Uint8Array, budget: number): Promise<TocPassOutcome> {
    const { directory, records } = await readZipIndex(bytes);
    const book: Book = { bytes, records, remaining: budget };

    const toc = await readBookToc([ ...records.keys() ], async (path) => {
        const content = await readPart(book, path);
        return content && decodeUtf8(content);
    });
    if (!toc || toc.entries.length === 0) {
        return { status: "none" };
    }

    const fragments = new Set(toc.entries.flatMap(({ target }) =>
        (target ? [ target.fragment ] : [])));
    const chapters = new Map<string, ChapterScan>();
    for (const path of toc.chapters) {
        const content = await readPart(book, path);
        const text = content && decodeStrictly(content);
        if (text !== undefined) {
            chapters.set(path, scanChapter(text, fragments));
        }
    }

    const counts = new Map<string, number>();
    const stemValues: string[] = [];
    for (const scan of chapters.values()) {
        for (const [ value, count ] of scan.counts) {
            counts.set(value, (counts.get(value) ?? 0) + count);
        }
        stemValues.push(...scan.stemValues);
    }
    const prefix = choosePrefix(stemValues);

    const destinations: TocPassDestination[] = [];
    const destinationsByPlace = new Map<string, number>();
    const insertions = new Map<ZipRecord, { text: string; list: { at: number; text: string }[] }>();
    const entries = toc.entries.map(({ title, level, target }): TocPassEntry => {
        const record = target && records.get(target.path);
        if (!target || !record) {
            return { title, level };
        }
        const key = `${target.path}#${target.fragment}`;
        let destination = destinationsByPlace.get(key);
        if (destination === undefined) {
            const scan = chapters.get(target.path);
            destination = scan
                ? placeDestination(scan, target.fragment, counts, prefix, destinations,
                    (at, text) => {
                        const chapter = insertions.get(record) ?? { text: scan.text, list: [] };
                        chapter.list.push({ at, text });
                        insertions.set(record, chapter);
                    })
                : -1;
            destinationsByPlace.set(key, destination);
        }
        return { title, level, destination };
    });

    const markerLength = destinations.reduce((total, { marker }) =>
        total + toMarkerTag(marker).length, 0);
    if (markerLength > book.remaining) {
        throw new TocPassRefusal("TEXT_TOO_LARGE");
    }
    const replacements = new Map(Array.from(insertions, ([ record, { text, list } ]) =>
        [ record, encodeUtf8(spliceInsertions(text, list)) ]));

    const marked = replacements.size > 0
        ? rewriteZip(bytes, directory, replacements, MAX_OFFICE_PREVIEW_BYTES)
        : bytes;
    return {
        status: "marked",
        bytes: marked,
        record: { prefix, entries, isCut: toc.isCut, destinations }
    };
}

/**
 * Places the marker of the destination `fragment` of the chapter `scan`, and answers its index, or
 * `-1` when the place has none: a part of a table without a cell, or a chapter without `<body>`.
 */
function placeDestination(
    scan: ChapterScan, fragment: string, counts: Map<string, number>, prefix: string,
    destinations: TocPassDestination[], insert: (at: number, text: string) => void
) {
    const target = fragment ? scan.byId.get(fragment) ?? scan.byName.get(fragment) : undefined;
    const at = target ? findMarkerOffset(target) : scan.bodyEnd;
    if (at === undefined) {
        return -1;
    }
    const marker = `${prefix}${destinations.length}`;
    const isOnlyGiver = target !== undefined && counts.get(fragment) === 1
        && !CONVERTER_ID.test(fragment);
    destinations.push(isOnlyGiver ? { marker, bookId: fragment } : { marker });
    insert(at, toMarkerTag(marker));
    return destinations.length - 1;
}

/**
 * Where the marker of `target` goes: before the outermost `<a>` around it, so that no link loses
 * its `href`; in the first cell of a part of a table, since the parser moves what sits between
 * cells out of the table; before an element without content, since a marker after it goes to the
 * next block; and right after the start tag of any other element.
 */
function findMarkerOffset(target: TargetElement) {
    if (target.anchorStart !== undefined) {
        return target.anchorStart;
    }
    if (TABLE_PARTS.has(target.name)) {
        return target.firstCellEnd;
    }
    return target.isEmpty ? target.start : target.end;
}

function toMarkerTag(marker: string) {
    return `<a id="${marker}"></a>`;
}

/** The first of `trilium_toc_`, `trilium_toc2_`, ... that none of `values` starts with. */
function choosePrefix(values: string[]) {
    for (let number = 1; ; number++) {
        const prefix = `${MARKER_STEM}${number === 1 ? "" : number}_`;
        if (!values.some((value) => value.startsWith(prefix))) {
            return prefix;
        }
    }
}

/**
 * Reads the tags of the chapter `text` once, with a stack of the open elements: where `<body>`
 * starts, the elements that `fragments` name, and how many elements have each fragment as `id` or,
 * on an `<a>`, as `name`.
 */
function scanChapter(text: string, fragments: Set<string>): ChapterScan {
    const scan: ChapterScan = {
        text, byId: new Map(), byName: new Map(), counts: new Map(), stemValues: []
    };
    const stack: { name: string; awaitsCell?: TargetElement }[] = [];
    const anchorStarts: number[] = [];
    let awaitingCells = 0;

    for (const token of readTokens(text, true)) {
        if (token.kind === "text") {
            continue;
        }
        if (token.kind === "end") {
            const index = stack.findLastIndex(({ name }) => name === token.name);
            for (const closed of index < 0 ? [] : stack.splice(index)) {
                awaitingCells -= closed.awaitsCell ? 1 : 0;
                if (closed.name === "a") {
                    anchorStarts.pop();
                }
            }
            continue;
        }

        const { name, start, end, attributes } = token;
        const isEmpty = token.isSelfClosing || VOID_ELEMENTS.has(name);
        if (name === "body" && scan.bodyEnd === undefined) {
            scan.bodyEnd = end;
        }
        if (awaitingCells > 0 && (name === "td" || name === "th")) {
            for (const open of stack) {
                if (open.awaitsCell) {
                    open.awaitsCell.firstCellEnd = end;
                    open.awaitsCell = undefined;
                    awaitingCells--;
                }
            }
        }

        const id = attributes.get("id");
        const anchorName = name === "a" ? attributes.get("name") : undefined;
        let target: TargetElement | undefined;
        for (const value of [ id, anchorName === id ? undefined : anchorName ]) {
            if (value === undefined || value === "") {
                continue;
            }
            if (value.startsWith(MARKER_STEM)) {
                scan.stemValues.push(value);
            }
            if (!fragments.has(value)) {
                continue;
            }
            scan.counts.set(value, (scan.counts.get(value) ?? 0) + 1);
            const targets = value === id ? scan.byId : scan.byName;
            if (!targets.has(value)) {
                target ??= {
                    name, start, end, isEmpty,
                    anchorStart: anchorStarts[0] ?? (name === "a" ? start : undefined)
                };
                targets.set(value, target);
            }
        }

        if (!isEmpty) {
            const awaitsCell = target && TABLE_PARTS.has(name) ? target : undefined;
            awaitingCells += awaitsCell ? 1 : 0;
            stack.push({ name, awaitsCell });
            if (name === "a") {
                anchorStarts.push(start);
            }
        }
    }
    return scan;
}

/**
 * The bytes of the part `path` of `book`, or `undefined` when the archive has none. Refuses a part
 * whose declared size passes what remains of the budget, before anything is inflated.
 */
async function readPart(book: Book, path: string) {
    const record = book.records.get(path);
    if (!record) {
        return undefined;
    }
    if (record.uncompressedSize > book.remaining) {
        throw new TocPassRefusal("TEXT_TOO_LARGE");
    }
    book.remaining -= record.uncompressedSize;
    return await readEntryContent(byteSourceOf(book.bytes), record);
}

/**
 * `content` as text when it is UTF-8 that encodes back to the same bytes, else `undefined`: a
 * chapter in another encoding gets no marker.
 */
function decodeStrictly(content: Uint8Array) {
    try {
        const text = strictUtf8.decode(content);
        return text.includes("\0") ? undefined : text;
    } catch {
        return undefined;
    }
}

/**
 * The element of the preview that the element `{ tagName, tagOffset }` stands for: itself, or for
 * one of the converter's empty anchors, the element whose start tag follows the run of them.
 */
function resolveElement(
    html: string, { tagName, tagOffset }: { tagName: string; tagOffset: number }
) {
    CONVERTER_ANCHOR.lastIndex = tagOffset;
    if (tagName.toLowerCase() !== "a" || !CONVERTER_ANCHOR.test(html)) {
        return { tagOffset, tagNameEnd: tagOffset + 1 + tagName.length };
    }
    ANCHOR_RUN.lastIndex = tagOffset;
    const match = ANCHOR_RUN.exec(html);
    if (!match) {
        return undefined;
    }
    const tagNameEnd = match.index + match[0].length;
    return { tagOffset: tagNameEnd - match[1].length - 1, tagNameEnd };
}

/**
 * Whether the start tag at `from` opens before the start tag at `to` with nothing but start tags
 * and white space between them, as the wrapper of an image opens before the `<img>`.
 */
function opensBefore(html: string, from: number, to: number) {
    if (to < from) {
        return false;
    }
    START_TAG_RUN.lastIndex = from;
    START_TAG_RUN.exec(html);
    return to < START_TAG_RUN.lastIndex;
}
