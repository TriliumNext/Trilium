import {
    DOCX_MIME, findTocFormatName, ODT_MIME, OFFICE_PREVIEW_TOO_LARGE_MESSAGE, type ReferenceTarget
} from "@triliumnext/commons";

import { ValidationError } from "../../errors.js";
import { convertOfficeToHtml } from "../office_preview.js";
import type { GeneratedToc, TocFormat } from "./index.js";

/**
 * The versions of the readers of Word and OpenDocument text documents, stored as `docx.reader` and
 * `odt.reader` in a ToC cache. Bumped when an upgrade of `officeparser` changes the headings or
 * bookmarks that the preview of the format shows, or their text. Version 2 reads bookmarks.
 */
export const DOCX_TOC_READER = 2;
export const ODT_TOC_READER = 2;

/**
 * The codes of `officeparser` that say that the bytes cannot be read, with the limits that the
 * library sets: reading the same bytes again fails the same way. Codes about the call or the run,
 * such as `INVALID_INPUT` or `OPERATION_ABORTED`, are not among them.
 */
const OFFICE_INPUT_FAILURES = new Set([
    "IMPROPER_BUFFERS", "EXTENSION_UNSUPPORTED", "FILE_CORRUPTED", "ZIP_TRUNCATED",
    "ZIP_NO_ENTRIES_FOUND", "ZIP_ENTRY_INVALID_SIZE", "ZIP_ENTRY_COUNT_LIMIT_EXCEEDED",
    "ZIP_SIZE_LIMIT_EXCEEDED", "XML_ELEMENT_LIMIT_EXCEEDED", "REQUIRED_PART_MISSING",
    "MAX_NESTING_DEPTH_EXCEEDED", "OUTPUT_TOO_LARGE", "PASSWORD_REQUIRED", "PASSWORD_INCORRECT",
    "DOCUMENT_DECRYPTION_FAILED"
]);

export const docxTocFormat = createOfficeTocFormat("docx", DOCX_MIME, DOCX_TOC_READER);
export const odtTocFormat = createOfficeTocFormat("odt", ODT_MIME, ODT_TOC_READER);

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
 * What the log names for a failure to read an office document: the code of an error of
 * `officeparser`, else the error's name. The message can quote the file.
 */
export function describeOfficeFailure(error: unknown) {
    return getOfficeIssueCode(error) ?? (error instanceof Error ? error.name : String(error));
}

/**
 * The headings of the office documents of `mime`, read from their preview, and their bookmarks.
 * A heading links to itself through `heading`, a bookmark through `bookmark`.
 */
function createOfficeTocFormat(name: "docx" | "odt", mime: string, reader: number): TocFormat {
    return {
        name,
        isFor: (type, documentMime) => findTocFormatName(type, documentMime) === name,
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
