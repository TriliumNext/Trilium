import { findTocFormatName, type TocHeading } from "@triliumnext/commons";

import type { ZipFailure } from "../utils/zip_records.js";
import type { TocFormat } from "./index.js";
import { describeOfficeFailure, isOfficeInputFailure } from "./office.js";

/**
 * The version of the reader of EPUB e-books, stored as `epub.reader` in a ToC cache. Bumped when
 * the reading of a book's table of contents, the placing of its markers or an upgrade of
 * `officeparser` changes the headings of a book, their levels or whether they are shown.
 */
export const EPUB_TOC_READER = 2;

/** An entry of an EPUB's table of contents. One that the preview does not show has no link. */
export interface EpubTocHeading extends TocHeading {
    isShown?: false;
}

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

/** The ToC pass refused a book, for a `reason` that the same bytes always meet. */
export class TocPassRefusal extends Error {
    constructor(readonly reason: TocPassRefusalReason) {
        super(`The ToC pass refused the book: ${reason}.`);
        this.name = "TocPassRefusal";
    }
}

/**
 * The entries of an EPUB's own table of contents, placed in the preview by the ToC pass of
 * `convertOfficeToHtml()`. An entry links to itself through `heading` when the preview shows it.
 * The pass, the reader and the marking are in `epub_pass.ts`, loaded when a book is read.
 */
export const epubTocFormat: TocFormat<EpubTocHeading> = {
    name: "epub",
    isFor: (type, mime) => findTocFormatName(type, mime) === "epub",
    // Exactly the properties of the current reader: anything else rebuilds the cache.
    isCurrent: ({ epub }) => typeof epub === "object" && epub !== null
        && Object.keys(epub).length === 1
        && (epub as Record<string, unknown>).reader === EPUB_TOC_READER,
    getLinkParams: ({ id, isShown }) => (isShown === false ? undefined : { heading: id }),
    parseHeadingFields: ({ isShown }) => {
        if (isShown === undefined) {
            return {};
        }
        return isShown === false ? { isShown } : null;
    },
    isPermanentFailure: (error) => isOfficeInputFailure(error) || error instanceof TocPassRefusal,
    describeFailure: (error) => (error instanceof TocPassRefusal
        ? error.reason
        : describeOfficeFailure(error)),
    async generator(content) {
        const { readEpubToc } = await import("./epub_pass.js");
        return readEpubToc(content);
    },
    async markPreview(html, source) {
        // A preview converted from the original bytes gets no mark, and loads nothing.
        if (source.tocPass?.status !== "marked") {
            return html;
        }
        const { markEpubPreview } = await import("./epub_pass.js");
        return markEpubPreview(html, source.tocPass.record, source);
    }
};
