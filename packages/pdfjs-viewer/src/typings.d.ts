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

    interface PdfJsDestination {

    }

    interface Window {
        PDFViewerApplication?: {
            initializedPromise: Promise<void>;
            pdfDocument: PDFDocumentProxy;
            pdfViewer: {
                currentPageNumber: number;
                optionalContentConfigPromise: {
                    setVisibility(groupId: string, visible: boolean);
                    getGroup(groupId: string): {
                        name: string;
                        usage: {};
                    };
                    getOrder(): {}[]
                };
                getPageView(pageIndex: number): {
                    div: HTMLDivElement;
                };
                container: HTMLElement;
            };
            pdfLinkService: {
                goToDestination(dest: PdfJsDestination);
            };
            eventBus: {
                on(event: string, listener: (...args: any[]) => void): void;
                dispatch(event: string, data?: any): void;
            };
            store: ViewHistory;
        };
    }
}
