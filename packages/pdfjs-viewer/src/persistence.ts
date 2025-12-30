export default function interceptViewHistory(customOptions?: object) {
    // We need to monkey-patch the localStorage used by PDF.js to store view history.
    // Other attempts to intercept the history saving/loading (like overriding methods on PDFViewerApplication) have failed.
    const originalSetItem = Storage.prototype.setItem;
    Storage.prototype.setItem = function (key: string, value: string) {
        if (key === "pdfjs.history") {
            saveHistory(value);
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
            data: JSON.stringify(history)
        }, window.location.origin);
        saveTimeout = null;
    }, 2_000);
}
