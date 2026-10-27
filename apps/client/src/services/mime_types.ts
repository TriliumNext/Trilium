import {
    type MimeType, MIME_TYPE_AUTO, MIME_TYPE_TRILIUM_LOG, MIME_TYPE_TRILIUM_SEARCH,
    normalizeMimeTypeForCKEditor, resolveEnabledMimeTypes
} from "@triliumnext/commons";

import { t } from "./i18n.js";
import options from "./options.js";

/** The MIME type of plain text, which is always enabled. */
export const PLAIN_TEXT_MIME = "text/plain";

// Titles that are descriptive names rather than language identifiers, so they get localized here
// (the shared MIME dict in commons has no access to the client's i18n).
const TRANSLATED_TITLES: Record<string, string> = {
    [MIME_TYPE_TRILIUM_LOG]: "code_mime_types.trilium_log",
    [MIME_TYPE_TRILIUM_SEARCH]: "code_mime_types.trilium_search_query"
};

let mimeTypes: MimeType[] | null = null;

function loadMimeTypes() {
    mimeTypes = resolveEnabledMimeTypes(options.getJson("codeNotesMimeTypes"));

    for (const mt of mimeTypes) {
        const titleKey = TRANSLATED_TITLES[mt.mime];
        if (titleKey) {
            mt.title = t(titleKey);
        }
    }
}

function getMimeTypes(): MimeType[] {
    if (mimeTypes === null) {
        loadMimeTypes();
    }

    return mimeTypes as MimeType[];
}

/** The enabled MIME types, in the order the code language lists show them. */
function getEnabledMimeTypes(): MimeType[] {
    return orderEnabledMimeTypes(
        getMimeTypes(),
        options.getJson("codeNotesMimeTypes"),
        options.is("codeNotesMimeTypesSortAlphabetically")
    );
}

/**
 * Returns the enabled entries of `mimeTypes` in display order. Plain text comes first, except in a
 * stored order that places it elsewhere.
 *
 * @param order the `codeNotesMimeTypes` option. Without it, the entries are sorted.
 * @param isSortedAlphabetically sorts the entries by title instead of following `order`.
 */
export function orderEnabledMimeTypes(
    mimeTypes: readonly MimeType[],
    order: readonly (string | null)[] | null | undefined,
    isSortedAlphabetically: boolean
): MimeType[] {
    const enabled = mimeTypes.filter((mimeType) => mimeType.enabled);
    const plainText = enabled.find((mimeType) => mimeType.mime === PLAIN_TEXT_MIME);

    let ordered: MimeType[];
    if (isSortedAlphabetically || !order) {
        ordered = enabled
            .filter((mimeType) => mimeType !== plainText)
            .sort((a, b) => a.title.localeCompare(b.title));
    } else {
        const byMime = new Map(enabled.map((mimeType) => [ mimeType.mime, mimeType ]));
        ordered = [ ...new Set(order) ].flatMap((mime) => (mime && byMime.get(mime)) || []);
    }

    if (plainText && !ordered.includes(plainText)) {
        ordered.unshift(plainText);
    }
    return ordered;
}

let mimeToHighlightJsMapping: Record<string, string> | null = null;

/**
 * Obtains the corresponding language tag for highlight.js for a given MIME type.
 *
 * The mapping is built the first time this method is built and then the results are cached for better performance.
 *
 * @param mimeType The MIME type of the code block, in the CKEditor-normalized format (e.g. `text-c-src` instead of `text/c-src`).
 * @returns the corresponding highlight.js tag, for example `c` for `text-c-src`.
 */
export function getHighlightJsNameForMime(mimeType: string) {
    if (!mimeToHighlightJsMapping) {
        const mimeTypes = getMimeTypes();
        mimeToHighlightJsMapping = {};
        for (const mimeType of mimeTypes) {
            // The mime stored by CKEditor is text-x-csrc instead of text/x-csrc so we keep this format for faster lookup.
            const normalizedMime = normalizeMimeTypeForCKEditor(mimeType.mime);
            if (mimeType.mdLanguageCode) {
                mimeToHighlightJsMapping[normalizedMime] = mimeType.mdLanguageCode;
            }
        }
    }

    return mimeToHighlightJsMapping[mimeType];
}

export default {
    MIME_TYPE_AUTO,
    getMimeTypes,
    getEnabledMimeTypes,
    loadMimeTypes,
    getHighlightJsNameForMime
};
