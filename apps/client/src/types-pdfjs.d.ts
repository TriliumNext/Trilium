interface Window {
    /**
     * By default, pdf.js will try to store information about the opened PDFs such as zoom and scroll position in local storage.
     * The Trilium alternative is to use attachments stored at note level.
     * This variable represents the direct content used by the pdf.js viewer in its local storage key, but in plain JS object format.
     * The variable must be set early at startup, before pdf.js fully initializes.
     */
    TRILIUM_VIEW_HISTORY_STORE?: object;

    /**
     * If set to true, hides the pdf.js viewer default sidebar containing the outline, page navigation, etc.
     * This needs to be set early in the main method.
     */
    TRILIUM_HIDE_SIDEBAR?: boolean;
}
