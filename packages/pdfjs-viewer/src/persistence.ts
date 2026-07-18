/** pdf.js' localStorage key for the reusable signature library (`web/signature_storage.js`). */
const SIGNATURE_STORAGE_KEY = "pdfjs.signature";

export default function interceptViewHistory(customOptions?: object) {
    // We need to monkey-patch the localStorage used by PDF.js to store view history.
    // Other attempts to intercept the history saving/loading (like overriding methods on PDFViewerApplication) have failed.
    const originalSetItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key: string, value: string) {
        if (key === "pdfjs.history") {
            saveHistory(value);
            return;
        }

        if (key === SIGNATURE_STORAGE_KEY) {
            saveSignatures(value);
            return;
        }

        return originalSetItem.call(this, key, value);
    }

    const originalGetItem = Storage.prototype.getItem;
    Storage.prototype.getItem = function (key: string) {
        if (key === "pdfjs.preferences") {
            return JSON.stringify(customOptions);
        }

        if (key === "pdfjs.history") {
            return JSON.stringify(window.TRILIUM_VIEW_HISTORY_STORE || {});
        }

        if (key === SIGNATURE_STORAGE_KEY) {
            return JSON.stringify(window.TRILIUM_SIGNATURES || {});
        }

        return originalGetItem.call(this, key);
    }
}

let saveTimeout: number | null = null;

function saveHistory(value: string) {
    if (saveTimeout) {
        clearTimeout(saveTimeout);
    }
    saveTimeout = window.setTimeout(() => {
        // Parse the history and remove entries that are not relevant.
        const history = JSON.parse(value);
        const fingerprint = window.PDFViewerApplication?.pdfDocument?.fingerprints?.[0];
        if (fingerprint) {
            history.files = history.files.filter((file: any) => file.fingerprint === fingerprint);
        }

        window.parent.postMessage({
            type: "pdfjs-viewer-save-view-history",
            data: JSON.stringify(history),
            ntxId: window.TRILIUM_NTX_ID,
            noteId: window.TRILIUM_NOTE_ID
        } satisfies PdfSaveViewHistoryMessage, window.location.origin);
        saveTimeout = null;
    }, 2_000);
}

/**
 * Persists the reusable signature library. pdf.js writes the library to `localStorage` on every
 * add/remove; we mirror it into the injected `TRILIUM_SIGNATURES` global (so in-session reads stay
 * consistent) and forward it to the parent, which stores it in the synced `pdfSignatures` option.
 * These are discrete user actions, so — unlike view history — no debounce is needed.
 */
function saveSignatures(value: string) {
    try {
        window.TRILIUM_SIGNATURES = JSON.parse(value);
    } catch {
        // Malformed payload should never reach here (pdf.js always serializes valid JSON). If it
        // somehow does, abort rather than forward it — persisting broken JSON into the synced
        // option would make `getJson` fall back to `{}` and silently wipe every saved signature.
        return;
    }

    window.parent.postMessage({
        type: "pdfjs-viewer-save-signatures",
        data: value,
        ntxId: window.TRILIUM_NTX_ID,
        noteId: window.TRILIUM_NOTE_ID
    } satisfies PdfSaveSignaturesMessage, window.location.origin);
}
