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

/**
 * A single reusable signature as stored by pdf.js' `SignatureStorage` (`web/signature_storage.js`):
 * a human-readable description plus the compressed outline data produced by `SignatureExtractor`.
 */
type PdfSignatureEntry = {
    description: string;
    signatureData: unknown;
};

/** The pdf.js reusable signature library, keyed by signature UUID. Mirrors `localStorage["pdfjs.signature"]`. */
type PdfSignatureStore = Record<string, PdfSignatureEntry>;

interface Window {
    /**
     * By default, pdf.js will try to store information about the opened PDFs such as zoom and scroll position in local storage.
     * The Trilium alternative is to use attachments stored at note level.
     * This variable represents the direct content used by the pdf.js viewer in its local storage key, but in plain JS object format.
     * The variable must be set early at startup, before pdf.js fully initializes.
     */
    TRILIUM_VIEW_HISTORY_STORE?: HistoryData;

    /**
     * The reusable signature library used by the pdf.js signature tool. pdf.js keeps this in
     * per-browser `localStorage`; Trilium instead injects it here (from a synced option) so signatures
     * follow the user across devices. Reads/writes of `localStorage["pdfjs.signature"]` are intercepted
     * in the viewer and routed through this global + a `pdfjs-viewer-save-signatures` message.
     * Must be set early at startup, before pdf.js fully initializes.
     */
    TRILIUM_SIGNATURES?: PdfSignatureStore;

    /**
     * If set to true, hides the pdf.js viewer default sidebar containing the outline, page navigation, etc.
     * This needs to be set early in the main method.
     */
    TRILIUM_HIDE_SIDEBAR?: boolean;

    TRILIUM_NOTE_ID: string;

    TRILIUM_NTX_ID: string | null | undefined;

    /**
     * The token of the navigation of the frame that loaded this viewer, from the `loadToken` URL
     * parameter. The messages of one load include it, so the parent tells loads apart.
     */
    TRILIUM_LOAD_TOKEN: string | null | undefined;
}

interface WithContext {
    ntxId: string;
    noteId: string | null | undefined;
}

/** A message of one load of the viewer. */
interface WithLoad extends WithContext {
    loadToken: string | null | undefined;
}

/** The viewer loaded its document. Posted by every viewer. */
interface PdfViewerDocumentLoadedMessage extends WithLoad {
    type: "pdfjs-viewer-document-loaded";
}

/** pdf.js could not load the document. Posted by every viewer. */
interface PdfViewerDocumentErrorMessage extends WithLoad {
    type: "pdfjs-viewer-document-error";
}

/**
 * Where the reading line is: on the page `pageNumber`, at `x`, `y` in its PDF user space. Posted
 * by a viewer addressed to a note or opened with `position=1`, as it changes.
 */
interface PdfViewerPositionMessage extends WithLoad {
    type: "pdfjs-viewer-position";
    pageNumber: number;
    x: number;
    y: number;
}

/** The effective rotation of every page, by page index: a multiple of 90. */
interface PdfViewerRotationsMessage extends WithLoad {
    type: "pdfjs-viewer-rotations";
    rotations: number[];
}

/** The effective rotation of one page, which pdf.js read after it posted the whole list. */
interface PdfViewerPageRotationMessage extends WithLoad {
    type: "pdfjs-viewer-page-rotation";
    pageNumber: number;
    rotation: number;
}

interface PdfDocumentModifiedMessage extends WithContext {
    type: "pdfjs-viewer-document-modified";
}

interface PdfDocumentBlobResultMessage extends WithContext {
    type: "pdfjs-viewer-blob";
    data: Uint8Array<ArrayBufferLike>;
}

interface PdfSaveViewHistoryMessage extends WithContext {
    type: "pdfjs-viewer-save-view-history";
    data: string;
}

interface PdfSaveSignaturesMessage extends WithContext {
    type: "pdfjs-viewer-save-signatures";
    /** JSON string of the full signature library, as written by pdf.js to `localStorage["pdfjs.signature"]`. */
    data: string;
}

/** The answer to `trilium-build-toc`: the table of contents that the viewer read, or a failure. */
type PdfViewerTocBuildMessage = WithContext & {
    type: "pdfjs-viewer-toc-build";
    /** The `requestId` of the request. */
    requestId: number;
} & ({ failed: true } | {
    failed?: undefined;
    /** The `blobId` of the bytes that the outline was read from. */
    blobId: string;
    headings: Record<string, unknown>[];
    /** Whether the viewer stopped reading at `MAX_TOC_HEADINGS`, before another entry. */
    isCut?: boolean;
    properties: Record<string, unknown>;
    elapsedMs: number;
});

interface PdfViewerPageInfoMessage extends WithLoad {
    type: "pdfjs-viewer-page-info";
    totalPages: number;
    currentPage: number;
}

interface PdfViewerCurrentPageMessage extends WithLoad {
    type: "pdfjs-viewer-current-page";
    currentPage: number;
}

interface PdfViewerThumbnailMessage extends WithLoad {
    type: "pdfjs-viewer-thumbnail";
    pageNumber: number;
    dataUrl: string;
}

interface PdfAttachment {
    /** Identifies the attachment within the document; filenames are not necessarily unique. */
    id: string;
    filename: string;
    size: number;
}

interface PdfViewerAttachmentsMessage extends WithLoad {
    type: "pdfjs-viewer-attachments";
    attachments: PdfAttachment[];
    downloadAttachment?: (id: string) => void;
}

interface PdfLayer {
    id: string;
    name: string;
    visible: boolean;
}

interface PdfViewerLayersMessage extends WithLoad {
    type: "pdfjs-viewer-layers";
    layers: PdfLayer[];
    toggleLayer?: (layerId: string, visible: boolean) => void;
}

interface PdfAnnotationInfo {
    id: string;
    type: string;
    contents: string;
    highlightedText: string;
    author: string;
    pageNumber: number;
    color: string | null;
    creationDate: string | null;
    modificationDate: string | null;
}

interface PdfViewerAnnotationsMessage extends WithLoad {
    type: "pdfjs-viewer-annotations";
    annotations: PdfAnnotationInfo[];
}

type PdfMessageEvent = MessageEvent<
    PdfDocumentModifiedMessage
    | PdfSaveViewHistoryMessage
    | PdfSaveSignaturesMessage
    | PdfViewerDocumentLoadedMessage
    | PdfViewerDocumentErrorMessage
    | PdfViewerPositionMessage
    | PdfViewerRotationsMessage
    | PdfViewerPageRotationMessage
    | PdfViewerPageInfoMessage
    | PdfViewerCurrentPageMessage
    | PdfViewerThumbnailMessage
    | PdfViewerAttachmentsMessage
    | PdfViewerLayersMessage
    | PdfViewerAnnotationsMessage
    | PdfDocumentBlobResultMessage
    | PdfViewerTocBuildMessage
>;
