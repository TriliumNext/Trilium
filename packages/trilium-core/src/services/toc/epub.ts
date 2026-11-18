import {
    decodeHtmlEntities, EPUB_MIME_TYPES, MAX_TOC_HEADINGS, normalizeTocTitle
} from "@triliumnext/commons";

import { convertOfficeToHtml, MAX_OFFICE_PREVIEW_BYTES } from "../office_preview.js";
import { decodeUtf8, encodeUtf8 } from "../utils/binary.js";
import {
    byteSourceOf, readCentralDirectory, readEntryContent, rewriteZip, type ZipFailure,
    type ZipRecord, ZipRecordError
} from "../utils/zip_records.js";
import { getHeadingIds, type GeneratedToc, type TocPreviewSource } from "./index.js";
import { EPUB_TOC_READER, isOfficeInputFailure, TocPassRefusal } from "./office.js";
import { spliceInsertions } from "./office_headings.js";

/** The most bytes that the pass inflates from a book: package, table of contents and chapters. */
export const MAX_EPUB_PASS_TEXT_BYTES = 128 * 1024 * 1024;

/** Why the pass refuses a book. The same bytes always meet the same refusal. */
export type TocPassRefusalReason = ZipFailure | "TEXT_TOO_LARGE" | "REWRITE";

/** What the ToC pass of `convertOfficeToHtml()` did with an EPUB. */
export type TocPassOutcome =
    /** Markers placed, and the marked archive `bytes` converted. */
    | { status: "marked"; bytes: Uint8Array; record: TocPassRecord }
    /** The book has no table of contents, or one without an entry. */
    | { status: "none" }
    | { status: "refused"; reason: TocPassRefusalReason }
    /** The pass failed for a reason that another run might not meet. */
    | { status: "failed"; error: unknown };

/** What the pass placed, which the marking of the preview reads instead of the book. */
export interface TocPassRecord {
    /** The start of every marker's id. */
    prefix: string;
    /** The authored outline: every entry of the table of contents with a title. */
    entries: TocPassEntry[];
    /** Whether the outline stopped at `MAX_TOC_HEADINGS` before another entry with a title. */
    isCut: boolean;
    destinations: TocPassDestination[];
}

export interface TocPassEntry {
    title: string;
    level: number;
    /**
     * The index of the entry's destination in `TocPassRecord.destinations`, or `-1` when its place
     * has no marker. Absent for an entry without a place of its own, which lands where the first
     * entry of its subtree that lands does.
     */
    destination?: number;
}

/** A place that entries name, and the marker placed there. */
export interface TocPassDestination {
    marker: string;
    /** The fragment of the place, when only the target can give it to the preview as an id. */
    bookId?: string;
}

/** An entry of a book's table of contents, as the book writes it. */
export interface BookTocEntry {
    title: string;
    level: number;
    /** The file and fragment that the entry names, percent-decoded. Absent for a `<span>` entry. */
    target?: { path: string; fragment: string };
}

/** The entries of a book's table of contents, and the chapters of its spine. */
export interface BookToc {
    entries: BookTocEntry[];
    isCut: boolean;
    /** The paths of the chapters of the spine, in order, each once. */
    chapters: string[];
}

/** The elements that have no content and no end tag in HTML. */
const VOID_ELEMENTS = new Set([
    "area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "source", "track",
    "wbr"
]);
/** The parts of a table whose marker goes into their first cell. */
const TABLE_PARTS = new Set([ "tr", "thead", "tbody", "tfoot" ]);
/** The namespace of `epub:type`. */
const OPS_NAMESPACE = "http://www.idpf.org/2007/ops";
/** The elements whose content is text up to their end tag. */
const RAW_TEXT_ENDS: Record<string, RegExp> = {
    script: /<\/script[\s>]/gi,
    style: /<\/style[\s>]/gi
};
/** The start of every marker prefix: `trilium_toc_`, then `trilium_toc2_` and so on. */
const MARKER_STEM = "trilium_toc";
/** The forms of the ids that `officeparser` writes itself. */
const CONVERTER_ID = /^(?:footnote-|html-quote-|sheet-)/;
/** A start tag with an `id` in the preview: its tag name and the escaped value of the id. */
const ELEMENT_ID = /<([a-zA-Z][a-zA-Z0-9]*)\b[^>]*?\sid="([^"]*)"/g;
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
    const properties = { reader: EPUB_TOC_READER, bookmarks: [] };
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
 * the ids of the entries that land on each element written into its start tag as one
 * `data-toc-heading`, separated by spaces, in the order of the table of contents.
 */
export function markEpubPreview(
    html: string, record: TocPassRecord, { blobId, isProtected }: Omit<TocPreviewSource, "content">
) {
    const ids = getHeadingIds(record.entries, blobId, isProtected, record.isCut);
    const marks = new Map<number, string[]>();
    for (const [ index, landing ] of findLandings(html, record).entries()) {
        if (landing !== undefined) {
            const landed = marks.get(landing);
            if (landed) {
                landed.push(ids[index]);
            } else {
                marks.set(landing, [ ids[index] ]);
            }
        }
    }
    return spliceInsertions(html, Array.from(marks,
        ([ at, landed ]) => ({ at, text: ` data-toc-heading="${landed.join(" ")}"` })));
}

/**
 * The entries of the table of contents of an EPUB, from its navigation document, else its NCX. A
 * book without either has none: `null`. `names` are the paths of the archive, and `read` answers
 * the text of one of them.
 */
export async function readBookToc(
    names: readonly string[], read: (path: string) => Promise<string | undefined>
): Promise<BookToc | null> {
    const containerPath = names.find((name) => /META-INF\/container\.xml$/i.test(name));
    const container = containerPath === undefined ? undefined : await read(containerPath);
    const fullPath = container === undefined
        ? undefined
        : findElement(parseXml(container, false), "rootfile")?.attributes.get("full-path");
    const packagePath = (fullPath !== undefined && names.includes(fullPath) ? fullPath : undefined)
        ?? names.find((name) => /\.opf$/i.test(name));
    const packageText = packagePath === undefined ? undefined : await read(packagePath);
    if (packagePath === undefined || packageText === undefined) {
        return null;
    }

    const opf = parseXml(packageText, false);
    const packageFolder = folderOf(packagePath);
    const manifest = new Map<string, { path: string; mediaType: string; properties: string[] }>();
    for (const item of findElements(opf, "item")) {
        const id = item.attributes.get("id");
        const href = item.attributes.get("href");
        if (id && href) {
            manifest.set(id, {
                path: resolvePath(packageFolder, decodePath(href.split("#")[0])),
                mediaType: item.attributes.get("media-type") ?? "",
                properties: splitTokens(item.attributes.get("properties"))
            });
        }
    }
    const chapters = new Set<string>();
    for (const itemref of findElements(opf, "itemref")) {
        const item = manifest.get(itemref.attributes.get("idref") ?? "");
        if (item && /html/i.test(item.mediaType)) {
            chapters.add(item.path);
        }
    }

    const items = [ ...manifest.values() ];
    let raw: RawEntry[] | null = null;
    const nav = items.find(({ properties }) => properties.includes("nav"));
    const navText = nav && await read(nav.path);
    if (nav && navText !== undefined) {
        raw = readNavEntries(navText, nav.path);
    }
    if (!raw) {
        const tocId = findElement(opf, "spine")?.attributes.get("toc");
        const ncx = (tocId ? manifest.get(tocId) : undefined)
            ?? items.find(({ mediaType }) => mediaType === "application/x-dtbncx+xml");
        const ncxText = ncx && await read(ncx.path);
        if (ncx && ncxText !== undefined) {
            raw = readNcxEntries(ncxText, ncx.path);
        }
    }
    return raw ? { ...toOutline(raw), chapters: [ ...chapters ] } : null;
}

/**
 * The landing of each entry of `record` in `html`: the offset of the end of the tag name of the
 * element it lands on, or `undefined` for an entry that is not shown.
 */
export function findLandings(html: string, record: TocPassRecord): (number | undefined)[] {
    const wanted = new Set(record.destinations.flatMap(({ marker, bookId }) =>
        (bookId === undefined ? [ marker ] : [ marker, bookId ])));
    const elements = new Map<string, { tagName: string; tagOffset: number; count: number }>();
    for (const match of html.matchAll(ELEMENT_ID)) {
        const id = decodeHtmlEntities(match[2]);
        if (!wanted.has(id)) {
            continue;
        }
        const element = elements.get(id);
        if (element) {
            element.count++;
        } else {
            elements.set(id, { tagName: match[1], tagOffset: match.index, count: 1 });
        }
    }

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

/** An entry as a table of contents nests it, before empty titles are left out. */
interface RawEntry {
    title: string;
    depth: number;
    target?: { path: string; fragment: string };
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
    const source = byteSourceOf(bytes);
    const directory = await readCentralDirectory(source);
    const records = new Map<string, ZipRecord>();
    for (const record of directory.records) {
        const name = decodeName(record);
        if (!records.has(name)) {
            records.set(name, record);
        }
    }
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

/** The name of an entry as `fflate` reads it: UTF-8 when flagged, else one character per byte. */
function decodeName(record: ZipRecord) {
    if (record.isUtf8Flagged) {
        return decodeUtf8(record.rawName);
    }
    let name = "";
    for (const byte of record.rawName) {
        name += String.fromCharCode(byte);
    }
    return name;
}

/** The entries of the `<nav>` typed `toc` of the navigation document `text` at `path`. */
function readNavEntries(text: string, path: string): RawEntry[] | null {
    const root = parseXml(text, true);
    const typeNames = readTypeAttributeNames(root);
    const nav = findElements(root, "nav").find((element) => typeNames.some((name) =>
        splitTokens(element.attributes.get(name)).includes("toc")));
    const list = nav && findElement(nav, "ol");
    if (!list) {
        return nav ? [] : null;
    }

    const entries: RawEntry[] = [];
    const stack = childElements(list, "li").toReversed().map((item) => ({ item, depth: 1 }));
    for (let next = stack.pop(); next; next = stack.pop()) {
        const { item, depth } = next;
        const label = item.children.find((child): child is XmlElement =>
            isElement(child) && (child.name === "a" || child.name === "span"));
        const href = label?.name === "a" ? label.attributes.get("href") : undefined;
        entries.push({
            title: label ? readLabel(label) : "",
            depth,
            target: href === undefined ? undefined : resolveTarget(path, href)
        });
        const sublist = childElements(item, "ol")[0];
        if (sublist) {
            stack.push(...childElements(sublist, "li").toReversed()
                .map((child) => ({ item: child, depth: depth + 1 })));
        }
    }
    return entries;
}

/**
 * The names of the `epub:type` attribute in `root`: with the prefix `epub`, which readers accept
 * undeclared, and with each prefix that an `xmlns:` attribute binds to `OPS_NAMESPACE`.
 */
function readTypeAttributeNames(root: XmlElement) {
    const names = [ "epub:type" ];
    for (const element of findElements(root)) {
        for (const [ name, value ] of element.attributes) {
            if (name.startsWith("xmlns:") && value === OPS_NAMESPACE) {
                names.push(`${name.slice("xmlns:".length)}:type`);
            }
        }
    }
    return names;
}

/** The entries of the `navMap` of the NCX `text` at `path`. */
function readNcxEntries(text: string, path: string): RawEntry[] {
    const navMap = findElement(parseXml(text, false), "navmap");
    if (!navMap) {
        return [];
    }

    const entries: RawEntry[] = [];
    const stack = childElements(navMap, "navpoint").toReversed()
        .map((point) => ({ point, depth: 1 }));
    for (let next = stack.pop(); next; next = stack.pop()) {
        const { point, depth } = next;
        const label = childElements(point, "navlabel")[0];
        const labelText = label && childElements(label, "text")[0];
        const src = childElements(point, "content")[0]?.attributes.get("src");
        entries.push({
            title: labelText ? normalizeTocTitle(readText(labelText)) : "",
            depth,
            target: src === undefined ? undefined : resolveTarget(path, src)
        });
        stack.push(...childElements(point, "navpoint").toReversed()
            .map((child) => ({ point: child, depth: depth + 1 })));
    }
    return entries;
}

/**
 * The authored outline of `raw`: every entry with a title, at the depth of its ancestors with a
 * title, so that the children of an entry without one move up to its level. Stops at
 * `MAX_TOC_HEADINGS`.
 */
function toOutline(raw: RawEntry[]): { entries: BookTocEntry[]; isCut: boolean } {
    const entries: BookTocEntry[] = [];
    const ancestors: { depth: number; isKept: boolean }[] = [];
    let keptAncestors = 0;
    for (const { title, depth, target } of raw) {
        while ((ancestors.at(-1)?.depth ?? -Infinity) >= depth) {
            keptAncestors -= ancestors.pop()?.isKept ? 1 : 0;
        }
        const isKept = title !== "";
        if (isKept) {
            if (entries.length === MAX_TOC_HEADINGS) {
                return { entries, isCut: true };
            }
            const level = keptAncestors + 1;
            entries.push(target ? { title, level, target } : { title, level });
        }
        ancestors.push({ depth, isKept });
        keptAncestors += isKept ? 1 : 0;
    }
    return { entries, isCut: false };
}

/**
 * The title of the label of a navigation entry: its text, with each image's `alt` and each MathML
 * formula's `alttext` in place, else its `title` attribute.
 */
function readLabel(label: XmlElement) {
    const parts: string[] = [];
    const stack: XmlNode[] = [ label ];
    for (let node = stack.pop(); node; node = stack.pop()) {
        const formula = isElement(node) && node.name === "math"
            ? node.attributes.get("alttext")
            : undefined;
        if (!isElement(node)) {
            parts.push(node.text);
        } else if (node.name === "img") {
            parts.push(node.attributes.get("alt") ?? "");
        } else if (formula !== undefined) {
            parts.push(formula);
        } else if (node.name === "br") {
            parts.push(" ");
        } else {
            stack.push(...node.children.toReversed());
        }
    }
    return normalizeTocTitle(parts.join(""))
        || normalizeTocTitle(label.attributes.get("title") ?? "");
}

/** The text of `element` and its descendants. */
function readText(element: XmlElement) {
    const parts: string[] = [];
    const stack: XmlNode[] = [ element ];
    for (let node = stack.pop(); node; node = stack.pop()) {
        if (isElement(node)) {
            stack.push(...node.children.toReversed());
        } else {
            parts.push(node.text);
        }
    }
    return parts.join("");
}

/** The file and fragment of the archive that `href`, written in the file `base`, names. */
function resolveTarget(base: string, href: string) {
    const hashIndex = href.indexOf("#");
    const file = hashIndex < 0 ? href : href.slice(0, hashIndex);
    const fragment = hashIndex < 0 ? "" : decodePath(href.slice(hashIndex + 1));
    const path = file === "" ? base : resolvePath(folderOf(base), decodePath(file));
    return { path, fragment };
}

/** `path` in `folder`, as `officeparser` resolves the paths of a book. */
function resolvePath(folder: string, path: string) {
    const resolved: string[] = [];
    for (const part of `${folder}${path}`.split("/")) {
        if (part === "..") {
            resolved.pop();
        } else if (part !== "." && part !== "") {
            resolved.push(part);
        }
    }
    return resolved.join("/");
}

/** The folder of the file `path`, with its trailing `/`, or `""` at the root. */
function folderOf(path: string) {
    return path.includes("/") ? path.slice(0, path.lastIndexOf("/") + 1) : "";
}

/** `href` with its percent-escapes decoded, or as written when they do not decode. */
function decodePath(href: string) {
    try {
        return decodeURIComponent(href);
    } catch {
        return href;
    }
}

function splitTokens(value: string | undefined) {
    return (value ?? "").split(/\s+/).filter(Boolean);
}

/** An element of a document that `parseXml()` read. */
interface XmlElement {
    /** The local name, in lower case. */
    name: string;
    /** By name in lower case, the values with entities decoded. */
    attributes: Map<string, string>;
    children: XmlNode[];
}

type XmlNode = XmlElement | { text: string };

function isElement(node: XmlNode): node is XmlElement {
    return "name" in node;
}

/**
 * The elements of `text`, an XML document or, when `isHtml`, an XHTML one, whose void elements
 * have no content even when they are not written self-closing.
 */
function parseXml(text: string, isHtml: boolean): XmlElement {
    const root: XmlElement = { name: "", attributes: new Map(), children: [] };
    const stack = [ root ];
    for (const token of readTokens(text, isHtml)) {
        const parent = stack[stack.length - 1];
        if (token.kind === "text") {
            const text = token.isCdata ? token.raw : decodeHtmlEntities(token.raw);
            parent.children.push({ text });
        } else if (token.kind === "start") {
            const element = { name: token.name, attributes: token.attributes, children: [] };
            parent.children.push(element);
            if (!token.isSelfClosing && !(isHtml && VOID_ELEMENTS.has(token.name))) {
                stack.push(element);
            }
        } else {
            const index = stack.findLastIndex(({ name }) => name === token.name);
            if (index > 0) {
                stack.length = index;
            }
        }
    }
    return root;
}

/** The descendants of `root` named `name`, or all of them, in document order. */
function findElements(root: XmlElement, name?: string) {
    const found: XmlElement[] = [];
    const stack = [ ...root.children ].reverse();
    while (stack.length > 0) {
        const node = stack.pop();
        if (node && isElement(node)) {
            if (name === undefined || node.name === name) {
                found.push(node);
            }
            stack.push(...node.children.toReversed());
        }
    }
    return found;
}

function findElement(root: XmlElement, name: string): XmlElement | undefined {
    return findElements(root, name)[0];
}

function childElements(parent: XmlElement, name: string) {
    return parent.children.filter((child): child is XmlElement =>
        isElement(child) && child.name === name);
}

type Token =
    | {
        kind: "start"; name: string; start: number; end: number; isSelfClosing: boolean;
        attributes: Map<string, string>;
    }
    | { kind: "end"; name: string; start: number; end: number }
    /** Text as written, entities included, or the content of a CDATA section. */
    | { kind: "text"; raw: string; isCdata: boolean };

/**
 * The tags and text of `text`, in order. Comments, processing instructions and declarations are
 * skipped; a CDATA section is text. In an XHTML document (`isHtml`), the content of `<script>`
 * and `<style>` is text up to their end tag. Names are local names in lower case.
 */
function* readTokens(text: string, isHtml: boolean): Generator<Token> {
    let at = 0;
    while (at < text.length) {
        const open = text.indexOf("<", at);
        if (open < 0) {
            yield { kind: "text", raw: text.slice(at), isCdata: false };
            return;
        }
        if (open > at) {
            yield { kind: "text", raw: text.slice(at, open), isCdata: false };
        }

        if (text.startsWith("<!--", open)) {
            at = skipPast(text, "-->", open + 4);
        } else if (text.startsWith("<![CDATA[", open)) {
            const end = text.indexOf("]]>", open + 9);
            const raw = text.slice(open + 9, end < 0 ? text.length : end);
            yield { kind: "text", raw, isCdata: true };
            at = end < 0 ? text.length : end + 3;
        } else if (text.startsWith("<?", open)) {
            at = skipPast(text, "?>", open + 2);
        } else if (text.startsWith("<!", open)) {
            at = skipPast(text, ">", open + 2);
        } else if (text[open + 1] === "/") {
            const end = skipPast(text, ">", open + 2);
            const name = localName(text.slice(open + 2, end - 1).trim().split(/\s/)[0]);
            yield { kind: "end", name, start: open, end };
            at = end;
        } else if (isLetter(text.charCodeAt(open + 1))) {
            const tag = readStartTag(text, open);
            yield tag;
            at = tag.end;
            const rawEnd = isHtml && !tag.isSelfClosing ? RAW_TEXT_ENDS[tag.name] : undefined;
            if (rawEnd) {
                rawEnd.lastIndex = at;
                const close = rawEnd.exec(text)?.index ?? text.length;
                yield { kind: "text", raw: text.slice(at, close), isCdata: true };
                at = close;
            }
        } else {
            yield { kind: "text", raw: "<", isCdata: false };
            at = open + 1;
        }
    }
}

/** The start tag at `open`, with its attributes, read up to its `>` outside quotes. */
function readStartTag(text: string, open: number): Extract<Token, { kind: "start" }> {
    let at = open + 1;
    while (at < text.length && !isNameEnd(text.charCodeAt(at))) {
        at++;
    }
    const name = localName(text.slice(open + 1, at));
    const attributes = new Map<string, string>();
    const skipSpace = () => {
        while (at < text.length && isSpace(text.charCodeAt(at))) {
            at++;
        }
    };
    while (at < text.length) {
        skipSpace();
        const code = text.charCodeAt(at);
        if (code === GREATER_THAN) {
            return {
                kind: "start", name, start: open, end: at + 1, isSelfClosing: false, attributes
            };
        }
        if (code === SLASH) {
            if (text.charCodeAt(at + 1) === GREATER_THAN) {
                return {
                    kind: "start", name, start: open, end: at + 2, isSelfClosing: true, attributes
                };
            }
            at++;
            continue;
        }

        const nameStart = at;
        while (at < text.length && !isNameEnd(text.charCodeAt(at))
            && text.charCodeAt(at) !== EQUALS) {
            at++;
        }
        const attributeName = text.slice(nameStart, at).toLowerCase();
        skipSpace();
        let value = "";
        if (text.charCodeAt(at) === EQUALS) {
            at++;
            skipSpace();
            const quote = text[at];
            if (quote === "\"" || quote === "'") {
                const close = text.indexOf(quote, at + 1);
                const valueEnd = close < 0 ? text.length : close;
                value = text.slice(at + 1, valueEnd);
                at = valueEnd + 1;
            } else {
                const valueStart = at;
                while (at < text.length && !isSpace(text.charCodeAt(at))
                    && text.charCodeAt(at) !== GREATER_THAN) {
                    at++;
                }
                value = text.slice(valueStart, at);
            }
        }
        if (attributeName && !attributes.has(attributeName)) {
            attributes.set(attributeName, decodeHtmlEntities(value));
        }
    }
    return { kind: "start", name, start: open, end: text.length, isSelfClosing: false, attributes };
}

const SLASH = 0x2f;
const EQUALS = 0x3d;
const GREATER_THAN = 0x3e;

/** Whether `code` is XML white space. */
function isSpace(code: number) {
    return code === 0x20 || code === 0x09 || code === 0x0a || code === 0x0d || code === 0x0c;
}

/** Whether `code` ends a tag or attribute name. */
function isNameEnd(code: number) {
    return isSpace(code) || code === SLASH || code === GREATER_THAN;
}

/** The offset after the first `terminator` at or after `from`, or the end of `text`. */
function skipPast(text: string, terminator: string, from: number) {
    const index = text.indexOf(terminator, from);
    return index < 0 ? text.length : index + terminator.length;
}

/** Whether `code` is an ASCII letter, which starts a tag name. */
function isLetter(code: number) {
    return (code >= 0x41 && code <= 0x5a) || (code >= 0x61 && code <= 0x7a);
}

/** `name` without its namespace prefix, in lower case. */
function localName(name: string) {
    return name.slice(name.indexOf(":") + 1).toLowerCase();
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
