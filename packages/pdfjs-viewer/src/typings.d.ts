import type { PDFDocumentProxy } from "pdfjs-dist";
import type { OptionalContentConfig } from "pdfjs-dist/types/src/display/optional_content_config";

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
                /**
                 * pdf.js' own type, rather than a local restatement of it — the previous
                 * hand-written shape declared the config object directly and omitted the
                 * Promise that `layers.ts` awaits.
                 */
                optionalContentConfigPromise: Promise<OptionalContentConfig>;
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
            findBar?: {
                open(): void;
                close(): void;
                toggle(): void;
            };
            store: ViewHistory;
        };
        PDFViewerApplicationOptions?: { set(name: string, value: any): void; }
    }
}
