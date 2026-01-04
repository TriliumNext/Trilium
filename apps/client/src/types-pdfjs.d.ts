type HistoryData = {
    files: {
        fingerprint: string;
        page: number;
        zoom: string;
        scrollLeft: number;
        scrollTop: number;
        rotation: number;
        sidebarView: number;
    }[];
};

interface Window {
    /**
     * By default, pdf.js will try to store information about the opened PDFs such as zoom and scroll position in local storage.
     * The Trilium alternative is to use attachments stored at note level.
     * This variable represents the direct content used by the pdf.js viewer in its local storage key, but in plain JS object format.
     * The variable must be set early at startup, before pdf.js fully initializes.
     */
    TRILIUM_VIEW_HISTORY_STORE?: HistoryData;

    /**
     * If set to true, hides the pdf.js viewer default sidebar containing the outline, page navigation, etc.
     * This needs to be set early in the main method.
     */
    TRILIUM_HIDE_SIDEBAR?: boolean;

    TRILIUM_NOTE_ID: string;

    TRILIUM_NTX_ID: string | null | undefined;
}

interface PdfOutlineItem {
    title: string;
    level: number;
    dest: unknown;
    id: string;
    items: PdfOutlineItem[];
}

interface WithContext {
    ntxId: string;
    noteId: string | null | undefined;
}

interface PdfDocumentModifiedMessage extends WithContext {
    type: "pdfjs-viewer-document-modified";
    data: Uint8Array<ArrayBufferLike>;
}

interface PdfSaveViewHistoryMessage extends WithContext {
    type: "pdfjs-viewer-save-view-history";
    data: string;
}

interface PdfViewerTocMessage {
    type: "pdfjs-viewer-toc";
    data: PdfOutlineItem[];
}

interface PdfViewerActiveHeadingMessage {
    type: "pdfjs-viewer-active-heading";
    headingId: string;
}

interface PdfViewerPageInfoMessage {
    type: "pdfjs-viewer-page-info";
    totalPages: number;
    currentPage: number;
}

interface PdfViewerCurrentPageMessage {
    type: "pdfjs-viewer-current-page";
    currentPage: number;
}

interface PdfViewerThumbnailMessage {
    type: "pdfjs-viewer-thumbnail";
    pageNumber: number;
    dataUrl: string;
}

interface PdfAttachment {
    filename: string;
    size: number;
}

interface PdfViewerAttachmentsMessage {
    type: "pdfjs-viewer-attachments";
    attachments: PdfAttachment[];
    downloadAttachment?: (fileName: string) => void;
}

interface PdfLayer {
    id: string;
    name: string;
    visible: boolean;
}

interface PdfViewerLayersMessage {
    type: "pdfjs-viewer-layers";
    layers: PdfLayer[];
    toggleLayer?: (layerId: string, visible: boolean) => void;
}

type PdfMessageEvent = MessageEvent<
    PdfDocumentModifiedMessage
    | PdfSaveViewHistoryMessage
    | PdfViewerTocMessage
    | PdfViewerActiveHeadingMessage
    | PdfViewerPageInfoMessage
    | PdfViewerCurrentPageMessage
    | PdfViewerThumbnailMessage
    | PdfViewerAttachmentsMessage
    | PdfViewerLayersMessage
>;
