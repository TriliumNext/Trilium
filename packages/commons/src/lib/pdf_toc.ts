import { MAX_TOC_HEADINGS, normalizeTocTitle, type TocHeading } from "./toc.js";

/**
 * The version of the PDF outline reader and of its ids, stored as `pdf.reader` in a ToC cache.
 * Version 2 binds every heading of an outline cut at `MAX_TOC_HEADINGS`.
 */
export const PDF_TOC_READER = 2;

/** A heading of a PDF file: an entry of its outline. */
export interface PdfTocHeading extends TocHeading {
    /** The page that a link to the heading opens, 1 for the first. Absent when it leads nowhere. */
    page?: number;
    /** Where the heading starts on its page, in PDF user space; absent when the file gives none. */
    left?: number;
    top?: number;
}

/** The reading position that the PDF viewer reports, in the user space of its page. */
export interface PdfReadingPosition {
    pageNumber: number;
    x: number;
    y: number;
}

/** The part of a pdf.js document that {@link readPdfOutline} reads. */
export interface PdfOutlineSource {
    numPages: number;
    getOutline(): Promise<PdfOutlineEntry[] | null>;
    getDestination(name: string): Promise<unknown[] | null>;
    getPageIndex(ref: unknown): Promise<number>;
}

/** An entry of the outline that pdf.js reads from a PDF file. */
export interface PdfOutlineEntry {
    title: string;
    dest: string | unknown[] | null;
    items: PdfOutlineEntry[];
}

/** An entry of a PDF outline as read: a plain title, the level the file gives it, and its page. */
export interface PdfOutlineHeading {
    title: string;
    level: number;
    /** The page of the entry's own destination, within the document. */
    page?: number;
    /** The explicit destination of the entry, only with `page`. */
    dest?: unknown[];
    /** Where the entry's own destination starts on its page, only with `page`. */
    left?: number;
    top?: number;
    /** Without `page`: the page of the first entry below it that has one. */
    inheritedPage?: number;
}

/** The outline of a PDF file as read. */
export interface PdfOutline {
    headings: PdfOutlineHeading[];
    /** Whether the outline has entries past the `MAX_TOC_HEADINGS` that `headings` keep. */
    isCut: boolean;
}

/**
 * The entries of the outline of `pdf` in document order, at most `MAX_TOC_HEADINGS`, with the
 * levels the file gives them. An entry keeps its destination only when it resolves to a page of
 * the document.
 */
export async function readPdfOutline(pdf: PdfOutlineSource): Promise<PdfOutline> {
    const outline = await pdf.getOutline();
    const headings: PdfOutlineHeading[] = [];
    const stack: { entry: PdfOutlineEntry; level: number }[] = [];
    pushEntries(stack, outline ?? [], 1);
    let item = stack.pop();
    for (; item && headings.length < MAX_TOC_HEADINGS; item = stack.pop()) {
        const { entry, level } = item;
        const title = normalizeTocTitle(typeof entry.title === "string" ? entry.title : "");
        headings.push({ title, level, ...await resolveDestination(pdf, entry.dest) });
        pushEntries(stack, entry.items ?? [], level + 1);
    }

    inheritPages(headings);
    // The entry taken off the stack when the limit stopped the loop is past the cut.
    return { headings, isCut: item !== undefined };
}

/**
 * The headings of `outline` as a ToC cache stores them, without ids: each with the page that a
 * link to it opens, its own or the one it inherits, and the anchors of its own destination.
 */
export function toPdfTocHeadings(outline: PdfOutlineHeading[]): Omit<PdfTocHeading, "id">[] {
    return outline.map(({ title, level, page, inheritedPage, left, top }) => {
        if (page !== undefined) {
            return { title, level, page, ...anchorsOf(left, top) };
        }
        return inheritedPage === undefined
            ? { title, level }
            : { title, level, page: inheritedPage };
    });
}

/**
 * The id of the heading of `headings` at `position`: of those that start at or above it on the
 * screen, the nearest. `rotations` is the effective rotation of each page, a multiple of 90,
 * by page index. A heading without the anchor that runs down the screen starts at the top of its
 * page; one without a page is never active. Of several at one place, the last in document order.
 */
export function findActivePdfHeading(
    headings: PdfTocHeading[], position: PdfReadingPosition, rotations: readonly number[]
): string | null {
    const rotationOf = (pageNumber: number) => rotations[pageNumber - 1] ?? 0;
    const readingDepth = getPointDepth(rotationOf(position.pageNumber), position.x, position.y);
    let active: { page: number; depth: number; id: string } | null = null;
    for (const { id, page, left, top } of headings) {
        if (page === undefined || page > position.pageNumber) {
            continue;
        }
        const depth = getPointDepth(rotationOf(page), left, top);
        if (page === position.pageNumber && depth > readingDepth) {
            continue;
        }
        if (!active || page > active.page || (page === active.page && depth >= active.depth)) {
            active = { page, depth, id };
        }
    }
    return active?.id ?? null;
}

/** Pushes `entries` at `level` onto `stack`, so that the first one comes off first. */
function pushEntries(
    stack: { entry: PdfOutlineEntry; level: number }[], entries: PdfOutlineEntry[], level: number
) {
    for (let index = entries.length - 1; index >= 0; index--) {
        stack.push({ entry: entries[index], level });
    }
}

/**
 * How far down the screen the point `x`, `y` of a page turned by `rotation` is: the PDF axis that
 * runs down the screen, as in pdf.js' `PageViewport`. A missing coordinate is the top of the page.
 */
function getPointDepth(rotation: number, x: number | undefined, y: number | undefined) {
    switch (((rotation % 360) + 360) % 360) {
        case 90:
            return x ?? -Infinity;
        case 180:
            return y ?? -Infinity;
        case 270:
            return x === undefined ? -Infinity : -x;
        default:
            return y === undefined ? -Infinity : -y;
    }
}

/** The anchors that are finite numbers, as fields of a heading. */
function anchorsOf(left: unknown, top: unknown) {
    return {
        ...(isFiniteNumber(left) ? { left } : {}),
        ...(isFiniteNumber(top) ? { top } : {})
    };
}

function isFiniteNumber(value: unknown): value is number {
    return typeof value === "number" && Number.isFinite(value);
}

/** The page of `dest` and its explicit form, or nothing when it leads to no page of `pdf`. */
async function resolveDestination(pdf: PdfOutlineSource, dest: PdfOutlineEntry["dest"]) {
    try {
        const explicit = typeof dest === "string" ? await pdf.getDestination(dest) : dest;
        if (!Array.isArray(explicit)) {
            return {};
        }

        const [ target ] = explicit;
        const pageIndex = typeof target === "number"
            ? target
            : target !== null && typeof target === "object" ? await pdf.getPageIndex(target) : NaN;
        const page = pageIndex + 1;
        return Number.isInteger(page) && page >= 1 && page <= pdf.numPages
            ? { page, dest: explicit, ...readAnchors(explicit) }
            : {};
    } catch {
        // A reference that names no page.
        return {};
    }
}

/** Where the explicit destination `dest` starts on its page, from the arguments of its mode. */
function readAnchors(dest: unknown[]) {
    const mode = dest[1];
    const name = mode !== null && typeof mode === "object"
        ? (mode as { name?: unknown }).name
        : null;
    switch (name) {
        case "XYZ":
            return anchorsOf(dest[2], dest[3]);
        case "FitH":
        case "FitBH":
            return anchorsOf(undefined, dest[2]);
        case "FitV":
        case "FitBV":
            return anchorsOf(dest[2], undefined);
        case "FitR":
            return anchorsOf(dest[2], dest[5]);
        default:
            return {};
    }
}

/**
 * Gives each heading without a page the page of the first heading below it that has one, on the
 * levels of the file.
 */
function inheritPages(headings: PdfOutlineHeading[]) {
    // The headings without a page whose subtree is still open: ancestors of the next heading.
    const waiting: PdfOutlineHeading[] = [];
    for (const heading of headings) {
        while (waiting.length > 0 && waiting[waiting.length - 1].level >= heading.level) {
            waiting.pop();
        }
        if (heading.page === undefined) {
            waiting.push(heading);
            continue;
        }
        for (const ancestor of waiting) {
            ancestor.inheritedPage = heading.page;
        }
        waiting.length = 0;
    }
}
