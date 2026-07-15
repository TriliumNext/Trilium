import { normalizeMimeTypeForCKEditor, type MimeType, MIME_TYPE_AUTO, MIME_TYPE_TRILIUM_LOG, MIME_TYPES_DICT } from "@triliumnext/commons";
import { t } from "./i18n.js";
import options from "./options.js";

// Titles that are descriptive names rather than language identifiers, so they get localized here
// (the shared MIME dict in commons has no access to the client's i18n).
const TRANSLATED_TITLES: Record<string, string> = {
    [MIME_TYPE_TRILIUM_LOG]: "code_mime_types.trilium_log"
};

let mimeTypes: MimeType[] | null = null;

function loadMimeTypes() {
    mimeTypes = JSON.parse(JSON.stringify(MIME_TYPES_DICT)) as MimeType[]; // clone

    const enabledMimeTypes = options.getJson("codeNotesMimeTypes") || MIME_TYPES_DICT.filter((mt) => mt.default).map((mt) => mt.mime);

    for (const mt of mimeTypes) {
        mt.enabled = enabledMimeTypes.includes(mt.mime) || mt.mime === "text/plain"; // text/plain is always enabled

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
    loadMimeTypes,
    getHighlightJsNameForMime
};
