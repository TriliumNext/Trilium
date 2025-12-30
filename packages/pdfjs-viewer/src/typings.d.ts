import type { PDFDocumentProxy } from "pdfjs-dist";

declare global {
    /**
     * @source https://github.com/mozilla/pdf.js/blob/master/web/view_history.js
     */
    interface ViewHistory {
        database: {
            files?: {
                fingerprint: string;
            }[];
        },
        _writeToStorage: () => Promise<void>;
        _readFromStorage: () => Promise<string>;
    }

    interface Window {
        PDFViewerApplication?: {
            initializedPromise: Promise<void>;
            pdfDocument: PDFDocumentProxy;
            eventBus: {
                on(event: string, listener: (...args: any[]) => void): void;
                dispatch(event: string, data?: any): void;
            };
            store: ViewHistory;
        };
    }
}
