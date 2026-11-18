import {
    DOCX_MIME, EPUB_MIME_TYPES, ODT_MIME, OFFICE_PREVIEW_TOO_LARGE_MESSAGE, type ReferenceTarget,
    type TocHeading
} from "@triliumnext/commons";

import { ValidationError } from "../../errors.js";
import { convertOfficeToHtml } from "../office_preview.js";
import type { TocPassRefusalReason } from "./epub.js";
import type { GeneratedToc, TocFormat } from "./index.js";

/**
 * The versions of the readers of Word and OpenDocument text documents, stored as `docx.reader` and
 * `odt.reader` in a ToC cache. Bumped when an upgrade of `officeparser` changes the headings or
 * bookmarks that the preview of the format shows, or their text. Version 2 reads bookmarks.
 */
export const DOCX_TOC_READER = 2;
export const ODT_TOC_READER = 2;
/**
 * The version of the reader of EPUB e-books, stored as `epub.reader` in a ToC cache. Bumped when
 * the reading of a book's table of contents, the placing of its markers or an upgrade of
 * `officeparser` changes the headings of a book or whether they are shown.
 */
export const EPUB_TOC_READER = 1;

/** An entry of an EPUB's table of contents. One that the preview does not show has no link. */
export interface EpubTocHeading extends TocHeading {
    isShown?: false;
}

/** The ToC pass refused a book, for a `reason` that the same bytes always meet. */
export class TocPassRefusal extends Error {
    constructor(readonly reason: TocPassRefusalReason) {
        super(`The ToC pass refused the book: ${reason}.`);
        this.name = "TocPassRefusal";
    }
}

/**
 * The codes of `officeparser` that say that the bytes cannot be read, with the limits that the
 * library sets: reading the same bytes again fails the same way. Codes about the call or the run,
 * such as `INVALID_INPUT` or `OPERATION_ABORTED`, are not among them.
 */
export const OFFICE_INPUT_FAILURES = new Set([
    "IMPROPER_BUFFERS", "EXTENSION_UNSUPPORTED", "FILE_CORRUPTED", "ZIP_TRUNCATED",
    "ZIP_NO_ENTRIES_FOUND", "ZIP_ENTRY_INVALID_SIZE", "ZIP_ENTRY_COUNT_LIMIT_EXCEEDED",
    "ZIP_SIZE_LIMIT_EXCEEDED", "XML_ELEMENT_LIMIT_EXCEEDED", "REQUIRED_PART_MISSING",
    "MAX_NESTING_DEPTH_EXCEEDED", "OUTPUT_TOO_LARGE", "PASSWORD_REQUIRED", "PASSWORD_INCORRECT",
    "DOCUMENT_DECRYPTION_FAILED"
]);

export const docxTocFormat = createOfficeTocFormat("docx", [ DOCX_MIME ], DOCX_TOC_READER);
export const odtTocFormat = createOfficeTocFormat("odt", [ ODT_MIME ], ODT_TOC_READER);

/**
 * The entries of an EPUB's own table of contents, placed in the preview by the ToC pass of
 * `convertOfficeToHtml()`. An entry links to itself through `heading` when the preview shows it.
 */
export const epubTocFormat: TocFormat<EpubTocHeading> = {
    ...createOfficeTocFormat("epub", EPUB_MIME_TYPES, EPUB_TOC_READER),
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
        const { readEpubToc } = await import("./epub.js");
        return readEpubToc(content);
    },
    async markPreview(html, source) {
        // A preview converted from the original bytes gets no mark, and loads nothing.
        if (source.tocPass?.status !== "marked") {
            return html;
        }
        const { markEpubPreview } = await import("./epub.js");
        return markEpubPreview(html, source.tocPass.record, source);
    }
};

/**
 * Whether `error` says that the document can never be read: an error of `officeparser` whose code
 * is one of `OFFICE_INPUT_FAILURES`, or the refusal of a file too large to preview.
 */
export function isOfficeInputFailure(error: unknown) {
    const code = getOfficeIssueCode(error);
    if (code !== undefined) {
        return OFFICE_INPUT_FAILURES.has(code);
    }
    return error instanceof ValidationError
        && error.message.startsWith(OFFICE_PREVIEW_TOO_LARGE_MESSAGE);
}

/** The `officeIssue.code` of an error of `officeparser`, if it has one. */
export function getOfficeIssueCode(error: unknown): string | undefined {
    if (typeof error !== "object" || error === null || !("officeIssue" in error)) {
        return undefined;
    }
    const { officeIssue } = error;
    return typeof officeIssue === "object" && officeIssue !== null && "code" in officeIssue
        && typeof officeIssue.code === "string"
        ? officeIssue.code
        : undefined;
}

/**
 * The headings of the office documents of `mimes`, read from their preview, and their bookmarks.
 * A heading links to itself through `heading`, a bookmark through `bookmark`. The generator and
 * the marking read the first MIME type; every one of them converts to the same preview.
 */
function createOfficeTocFormat(
    name: "docx" | "odt" | "epub", mimes: readonly string[], reader: number
): TocFormat {
    const [ mime ] = mimes;
    return {
        name,
        isFor: (type, documentMime) => type === "file" && mimes.includes(documentMime),
        isCurrent: (cache) => !!readProperties(cache[name], reader),
        getLinkParams: ({ id }) => ({ heading: id }),
        getOtherTargets(cache) {
            const bookmarks = readProperties(cache[name], reader)?.bookmarks ?? [];
            // Sorted when listed: a sort in the cache would depend on the locale of its builder.
            return bookmarks.toSorted((a, b) => a.localeCompare(b))
                .map((bookmark): ReferenceTarget =>
                    ({ kind: "anchor", title: bookmark, params: { bookmark } }));
        },
        parseHeadingFields: () => ({}),
        isPermanentFailure: isOfficeInputFailure,
        describeFailure: describeOfficeFailure,
        generator: (content) => readOfficeToc(content, mime, reader),
        async markPreview(html, source) {
            const { markOfficePreview, readBookmarkNames } = await import("./office_headings.js");
            return markOfficePreview(html, source, await readBookmarkNames(source.content, mime));
        }
    };
}

/**
 * The headings and bookmarks of the office document `content` of `mime`, as its preview shows
 * them, with the bookmarks in document order.
 */
async function readOfficeToc(
    content: Uint8Array | string, mime: string, reader: number
): Promise<GeneratedToc> {
    const { readBookmarkNames, readPreviewBookmarks, readPreviewHeadings } =
        await import("./office_headings.js");
    const html = await convertOfficeToHtml(content, mime);
    const { headings, isCut } = readPreviewHeadings(html);
    const bookmarks = readPreviewBookmarks(html, await readBookmarkNames(content, mime));
    return {
        headings: headings.map(({ title, level }) => ({ title, level })),
        isCut,
        properties: { reader, bookmarks: bookmarks.map(({ name }) => name) }
    };
}

/**
 * What the log names for a failure to read an office document: the code of an error of
 * `officeparser`, else the error's name. The message can quote the file.
 */
function describeOfficeFailure(error: unknown) {
    return getOfficeIssueCode(error) ?? (error instanceof Error ? error.name : String(error));
}

/** The properties of an office format in a cache, when they are exactly those of `reader`. */
function readProperties(properties: unknown, reader: number) {
    if (typeof properties !== "object" || properties === null) {
        return null;
    }
    const { bookmarks, ...rest } = properties as Record<string, unknown>;
    const isExact = Object.keys(rest).length === 1 && rest.reader === reader
        && Array.isArray(bookmarks) && bookmarks.every((bookmark) => typeof bookmark === "string");
    return isExact ? { bookmarks: bookmarks as string[] } : null;
}
