import type { PDFDocumentLoadingTask, PDFDocumentProxy } from "pdfjs-dist";
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
                /** Settles once every page has been sized. */
                pagesPromise: Promise<void>;
                /** Works out the visible pages and records the scroll position. */
                update(): void;
                /** Puts `destArray` of the page at the top of the view, or the page itself. */
                scrollPageIntoView(params: {
                    pageNumber: number;
                    destArray?: unknown[] | null;
                }): void;
                /**
                 * pdf.js' own type, rather than a local restatement of it — the previous
                 * hand-written shape declared the config object directly and omitted the
                 * Promise that `layers.ts` awaits.
                 */
                optionalContentConfigPromise: Promise<OptionalContentConfig>;
                getPageView(pageIndex: number): {
                    div: HTMLDivElement;
                    viewport: {
                        /** Maps a point in PDF units to CSS pixels on the page. */
                        convertToViewportPoint(x: number, y: number): number[];
                    };
                } | undefined;
                container: HTMLElement;
            };
            pdfLinkService: {
                goToDestination(dest: PdfJsDestination);
            };
            eventBus: {
                on(event: string, listener: (...args: any[]) => void, options?: { once?: boolean }): void;
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
        /** The pdf.js library that the viewer loads. */
        pdfjsLib: {
            getDocument(src: { data: Uint8Array }): PDFDocumentLoadingTask;
        };
    }
}
