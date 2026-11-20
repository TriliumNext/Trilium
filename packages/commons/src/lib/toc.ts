import { DOCX_MIME, EPUB_MIME_TYPES, ODT_MIME } from "./office.js";
import { FNV1A_OFFSET_BASIS, fnv1aUpdate } from "./utils.js";

/** A heading of a document, as every table of contents of the app lists it. */
export interface TocHeading {
    /** Names the heading in its document. The same content gives the same id on every instance. */
    id: string;
    /** The plain text of the heading, never HTML. */
    title: string;
    /** The depth of the heading in the document, 1 for the top level. */
    level: number;
}

/** The content of a ToC cache attachment. A format keeps its own properties under its name. */
export interface TocCache<H extends TocHeading = TocHeading> {
    version: number;
    /** The `blobId` of the document that `headings` were read from. */
    targetBlobHash: string;
    headings: H[];
    [format: string]: unknown;
}

/** A heading as the ids are computed from it: its title and its level. */
export interface TocOutlineItem {
    title: string;
    level: number;
}

/** How the headings that ids are computed for were read. */
export interface TocReadOptions {
    /** Whether the reader stopped at `MAX_TOC_HEADINGS` before another heading with a title. */
    isCut?: boolean;
}

export const TOC_CACHE_VERSION = 1;
/** The title of the ToC cache of a note. The cache of an attachment adds the attachment id. */
export const TOC_CACHE_TITLE = "toc-cache.json";
/** The deepest level that the lists and the sidebar show. Ids and caches keep deeper ones. */
export const MAX_TOC_DEPTH = 32;
/** The most headings that a table of contents keeps. */
export const MAX_TOC_HEADINGS = 20_000;
/** The longest title of a heading, in UTF-16 code units. */
export const MAX_TOC_TITLE_LENGTH = 500;
/** Marks the element of a document preview where headings start: their ids, space-separated. */
export const TOC_HEADING_ATTRIBUTE = "data-toc-heading";
/** Marks the element of a document preview that holds a bookmark: its name. */
export const TOC_BOOKMARK_ATTRIBUTE = "data-toc-bookmark";

const BLOB_TAG_LENGTH = 10;
/** Joins the titles of a heading's path in its hash source. No normalized title holds it. */
const PATH_SEPARATOR = "\u0008";
/** The start of the second half of a hash: any fixed value other than `FNV1A_OFFSET_BASIS`. */
const SECOND_OFFSET_BASIS = 0x5bd1e995;
// eslint-disable-next-line no-control-regex
const CONTROL_CHARACTERS = /[\u0000-\u0008\u000e-\u001f\u007f]/g;
/** A hash, then for a bound heading an optional ordinal, the blob tag and `.p` when protected. */
const HEADING_ID = /^[0-9a-z]{14}(?:(?:\.[1-9][0-9]*)?\.([0-9A-Za-z]{10})(\.p)?)?$/;

/** The name of a ToC format, the key of its properties in a cache. */
export type TocFormatName = "pdf" | "docx" | "odt" | "epub";

/** The name of the ToC format of the documents of `type` and `mime`, if they have one. */
export function findTocFormatName(type: string, mime: string): TocFormatName | undefined {
    if (type !== "file") {
        return undefined;
    }
    if (mime === "application/pdf") {
        return "pdf";
    }
    if (mime === DOCX_MIME) {
        return "docx";
    }
    if (mime === ODT_MIME) {
        return "odt";
    }
    return (EPUB_MIME_TYPES as readonly string[]).includes(mime) ? "epub" : undefined;
}

/** The title of the ToC cache of a note, or of its attachment `attachmentId`. */
export function getTocCacheTitle(attachmentId?: string) {
    return attachmentId ? `${attachmentId}.${TOC_CACHE_TITLE}` : TOC_CACHE_TITLE;
}

/** The blob tag of `blobId`: the start of it that the ids of bound headings carry. */
export function getBlobTag(blobId: string) {
    return blobId.slice(0, BLOB_TAG_LENGTH);
}

/**
 * `title` as plain text in one line: without control characters, in NFC, with runs of white space
 * collapsed, trimmed, and cut to `MAX_TOC_TITLE_LENGTH`. A second pass changes nothing.
 */
export function normalizeTocTitle(title: string) {
    const normalized = title.replace(CONTROL_CHARACTERS, "").normalize("NFC")
        .replace(/\s+/g, " ").trim();
    if (normalized.length <= MAX_TOC_TITLE_LENGTH) {
        return normalized;
    }

    // The cut keeps a surrogate pair whole, and can leave a space or a mark to compose at the end.
    const lastCodeUnit = normalized.charCodeAt(MAX_TOC_TITLE_LENGTH - 1);
    const end = isHighSurrogate(lastCodeUnit) ? MAX_TOC_TITLE_LENGTH - 1 : MAX_TOC_TITLE_LENGTH;
    return normalized.slice(0, end).normalize("NFC").trim();
}

/**
 * The id of each heading of `headings`, a flat list in document order, read from the blob whose
 * blob tag is `blobTag`. `isProtected` tells whether that blob was hashed as protected.
 *
 * A heading is free when no heading on its path shares its title with a sibling and no other
 * heading has its hash: its id is the hash of its source. Any other heading is bound to the blob:
 * its id adds the blob tag, after an ordinal among the headings of the same hash if it has one.
 * In a table of contents that `isCut`, every heading is bound, since the headings past the cut
 * can share a title with it.
 */
export function assignHeadingIds(
    headings: TocOutlineItem[], blobTag: string, isProtected: boolean,
    { isCut = false }: TocReadOptions = {}
): string[] {
    const structure = readStructure(headings);
    const hashes = hashHeadings(headings, structure);
    const seenHashes = new Set<string>();
    const sharedHashes = new Set<string>();
    for (const hash of hashes) {
        (seenHashes.has(hash) ? sharedHashes : seenHashes).add(hash);
    }

    const suffix = isProtected ? `.${blobTag}.p` : `.${blobTag}`;
    const ordinals = new Map<string, number>();
    return hashes.map((hash, index) => {
        if (sharedHashes.has(hash)) {
            const ordinal = (ordinals.get(hash) ?? 0) + 1;
            ordinals.set(hash, ordinal);
            return `${hash}.${ordinal}${suffix}`;
        }
        return structure.isBoundByPath[index] || isCut ? `${hash}${suffix}` : hash;
    });
}

/**
 * The index of the heading that `id` names in `headings`, a flat list in document order, or `-1`
 * when it names none for sure. For a bound id, `isOwnTag` tells whether its blob tag, hashed as
 * protected or not, belongs to the bytes that `headings` were read from; a rejection counts as
 * `false`. `options` tell how `headings` were read, as for `assignHeadingIds()`.
 */
export async function findHeading(
    id: string,
    headings: TocOutlineItem[],
    isOwnTag: (blobTag: string, isProtected: boolean) => Promise<boolean>,
    options: TocReadOptions = {}
): Promise<number> {
    const match = HEADING_ID.exec(id);
    if (!match) {
        return -1;
    }

    const [ , blobTag, protectedSuffix ] = match;
    if (blobTag === undefined && options.isCut) {
        return -1;
    }
    const isProtected = protectedSuffix !== undefined;
    if (blobTag !== undefined && !await isOwnTag(blobTag, isProtected).catch(() => false)) {
        return -1;
    }
    return assignHeadingIds(headings, blobTag ?? "", isProtected, options).indexOf(id);
}

/**
 * The hash source of `headings[index]`: the titles from the top down to the heading joined by
 * U+0008, then `:` and its position among the siblings of its title. For specs and debugging.
 */
export function headingSource(headings: TocOutlineItem[], index: number) {
    const { parents, ordinals } = readStructure(headings);
    const titles: string[] = [];
    for (let current = index; current !== -1; current = parents[current]) {
        titles.unshift(headings[current].title);
    }
    return `${titles.join(PATH_SEPARATOR)}:${ordinals[index]}`;
}

/**
 * The items that each item of `items` nests under, the outermost first, by index. An item nests
 * under the closest earlier item of its group with a lower level. An item without a level nests
 * under nothing and closes nothing. Items with the same ancestors can share one array.
 */
export function getHeadingAncestors<T>(
    items: readonly T[],
    getLevel: (item: T) => number | undefined,
    getGroup?: (item: T) => unknown
): (readonly T[])[] {
    const result: (readonly T[])[] = [];
    // The items that the next item of each group can nest under, and their levels.
    const openByGroup = new Map<unknown, { items: readonly T[]; levels: readonly number[] }>();
    for (const item of items) {
        const level = getLevel(item);
        if (level === undefined) {
            result.push([]);
            continue;
        }

        const group = getGroup?.(item);
        const open = openByGroup.get(group) ?? { items: [], levels: [] };
        let depth = open.levels.length;
        while (depth > 0 && open.levels[depth - 1] >= level) {
            depth--;
        }
        const ancestors = depth === open.items.length ? open.items : open.items.slice(0, depth);
        result.push(ancestors);
        openByGroup.set(group, {
            items: [ ...ancestors, item ],
            levels: [ ...open.levels.slice(0, depth), level ]
        });
    }
    return result;
}

/** The hash of a source that `headingSource()` gives: 14 characters of `[0-9a-z]`. */
export function hashHeadingSource(source: string) {
    return formatHash(updateHash(INITIAL_STATE, source));
}

type HashState = readonly [ number, number ];

const INITIAL_STATE: HashState = [ FNV1A_OFFSET_BASIS, SECOND_OFFSET_BASIS ];

interface OutlineStructure {
    /** The index of the parent of each heading, `-1` at the top level. */
    parents: number[];
    /** The position of each heading among the siblings of its title, from 1. */
    ordinals: number[];
    /** Whether a heading, or one of its ancestors, shares its title with a sibling. */
    isBoundByPath: boolean[];
}

function readStructure(headings: TocOutlineItem[]): OutlineStructure {
    const parents: number[] = [];
    const ordinals: number[] = [];
    // The number of children of each title, by the index of their parent.
    const titleCounts = new Map<number, Map<string, number>>();
    // The titles that siblings share, as `parent:title`.
    const sharedTitles = new Set<string>();
    const open: number[] = [];
    for (const [ index, { title, level } ] of headings.entries()) {
        while (open.length > 0 && headings[open[open.length - 1]].level >= level) {
            open.pop();
        }
        const parent = open.length > 0 ? open[open.length - 1] : -1;
        const counts = titleCounts.get(parent) ?? new Map<string, number>();
        titleCounts.set(parent, counts);
        const ordinal = (counts.get(title) ?? 0) + 1;
        counts.set(title, ordinal);
        if (ordinal > 1) {
            sharedTitles.add(`${parent}:${title}`);
        }
        parents.push(parent);
        ordinals.push(ordinal);
        open.push(index);
    }

    const isBoundByPath: boolean[] = [];
    for (const [ index, { title } ] of headings.entries()) {
        const parent = parents[index];
        const isTitleShared = sharedTitles.has(`${parent}:${title}`);
        isBoundByPath.push(isTitleShared || (parent !== -1 && isBoundByPath[parent]));
    }
    return { parents, ordinals, isBoundByPath };
}

/** The hash of each heading's source, each continued from the state of its parent's path. */
function hashHeadings(headings: TocOutlineItem[], { parents, ordinals }: OutlineStructure) {
    const pathStates: HashState[] = [];
    return headings.map(({ title }, index) => {
        const parent = parents[index];
        const pathState = parent === -1
            ? updateHash(INITIAL_STATE, title)
            : updateHash(updateHash(pathStates[parent], PATH_SEPARATOR), title);
        pathStates.push(pathState);
        return formatHash(updateHash(pathState, `:${ordinals[index]}`));
    });
}

function updateHash([ first, second ]: HashState, value: string): HashState {
    return [ fnv1aUpdate(first, value), fnv1aUpdate(second, value) ];
}

function formatHash([ first, second ]: HashState) {
    return first.toString(36).padStart(7, "0") + second.toString(36).padStart(7, "0");
}

function isHighSurrogate(codeUnit: number) {
    return codeUnit >= 0xd800 && codeUnit <= 0xdbff;
}
