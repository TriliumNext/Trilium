import { RefObject } from "preact";
import { useCallback, useEffect, useRef } from "preact/hooks";

import appContext from "../../../components/app_context";
import type NoteContext from "../../../components/note_context";
import FBlob from "../../../entities/fblob";
import FNote from "../../../entities/fnote";
import server from "../../../services/server";
import { useViewModeConfig } from "../../collections/NoteList";
import { useTriliumOption, useTriliumOptionBool } from "../../react/hooks";

const VARIABLE_WHITELIST = new Set([
    "root-background",
    "main-background-color",
    "main-border-color",
    "main-text-color",
    "theme-style"
]);

export default function PdfPreview({ note, blob, componentId, noteContext }: {
    note: FNote;
    noteContext: NoteContext;
    blob: FBlob | null | undefined;
    componentId: string | undefined;
}) {
    const iframeRef = useRef<HTMLIFrameElement>(null);
    const { onLoad } = useStyleInjection(iframeRef);
    const historyConfig = useViewModeConfig(note, "pdfHistory");
    const [ locale ] = useTriliumOption("locale");
    const [ newLayout ] = useTriliumOptionBool("newLayout");

    useEffect(() => {
        function handleMessage(event: MessageEvent) {
            if (event.data?.type === "pdfjs-viewer-document-modified" && event.data?.data) {
                const blob = new Blob([event.data.data], { type: note.mime });
                server.upload(`notes/${note.noteId}/file`, new File([blob], note.title, { type: note.mime }), componentId);
            }

            if (event.data.type === "pdfjs-viewer-save-view-history" && event.data?.data) {
                historyConfig?.storeFn(JSON.parse(event.data.data));
            }

            if (event.data.type === "pdfjs-viewer-toc") {
                if (event.data.data) {
                    // Convert PDF outline to HeadingContext format
                    const headings = convertPdfOutlineToHeadings(event.data.data);
                    noteContext.setContextData("toc", {
                        headings,
                        activeHeadingId: null,
                        scrollToHeading: (heading) => {
                            iframeRef.current?.contentWindow?.postMessage({
                                type: "trilium-scroll-to-heading",
                                headingId: heading.id
                            }, window.location.origin);
                        }
                    });
                } else {
                    // No ToC available, use empty headings
                    noteContext.setContextData("toc", {
                        headings: [],
                        activeHeadingId: null,
                        scrollToHeading: () => {}
                    });
                }
            }

            if (event.data.type === "pdfjs-viewer-active-heading") {
                const currentToc = noteContext.getContextData("toc");
                if (currentToc) {
                    noteContext.setContextData("toc", {
                        ...currentToc,
                        activeHeadingId: event.data.headingId
                    });
                }
            }

            if (event.data.type === "pdfjs-viewer-page-info") {
                noteContext.setContextData("pdfPages", {
                    totalPages: event.data.totalPages,
                    currentPage: event.data.currentPage,
                    scrollToPage: (page: number) => {
                        iframeRef.current?.contentWindow?.postMessage({
                            type: "trilium-scroll-to-page",
                            pageNumber: page
                        }, window.location.origin);
                    },
                    requestThumbnail: (page: number) => {
                        iframeRef.current?.contentWindow?.postMessage({
                            type: "trilium-request-thumbnail",
                            pageNumber: page
                        }, window.location.origin);
                    }
                });
            }

            if (event.data.type === "pdfjs-viewer-current-page") {
                const currentPages = noteContext.getContextData("pdfPages");
                if (currentPages) {
                    noteContext.setContextData("pdfPages", {
                        ...currentPages,
                        currentPage: event.data.currentPage
                    });
                }
            }

            if (event.data.type === "pdfjs-viewer-thumbnail") {
                // Forward thumbnail to any listeners
                window.dispatchEvent(new CustomEvent("pdf-thumbnail", {
                    detail: {
                        pageNumber: event.data.pageNumber,
                        dataUrl: event.data.dataUrl
                    }
                }));
            }

            if (event.data.type === "pdfjs-viewer-attachments") {
                noteContext.setContextData("pdfAttachments", {
                    attachments: event.data.attachments,
                    downloadAttachment: (filename: string) => {
                        iframeRef.current?.contentWindow?.postMessage({
                            type: "trilium-download-attachment",
                            filename
                        }, window.location.origin);
                    }
                });
            }

            if (event.data.type === "pdfjs-viewer-layers") {
                noteContext.setContextData("pdfLayers", {
                    layers: event.data.layers,
                    toggleLayer: (layerId: string, visible: boolean) => {
                        iframeRef.current?.contentWindow?.postMessage({
                            type: "trilium-toggle-layer",
                            layerId,
                            visible
                        }, window.location.origin);
                    }
                });
            }
        }

        window.addEventListener("message", handleMessage);
        return () => {
            window.removeEventListener("message", handleMessage);
        };
    }, [ note, historyConfig, componentId, blob, noteContext ]);

    // Refresh when blob changes.
    useEffect(() => {
        if (iframeRef.current?.contentWindow) {
            iframeRef.current.contentWindow.location.reload();
        }
    }, [ blob ]);

    return (historyConfig &&
        <iframe
            tabIndex={300}
            ref={iframeRef}
            class="pdf-preview"
            src={`pdfjs/web/viewer.html?file=../../api/notes/${note.noteId}/open&lang=${locale}&sidebar=${newLayout ? "0" : "1"}`}
            onLoad={() => {
                const win = iframeRef.current?.contentWindow;
                if (win) {
                    win.TRILIUM_VIEW_HISTORY_STORE = historyConfig.config;
                }
                onLoad();

                if (iframeRef.current?.contentWindow) {
                    iframeRef.current.contentWindow.addEventListener('click', () => {
                        appContext.tabManager.activateNoteContext(noteContext.ntxId);
                    });
                }
            }}
        />
    );
}

function useStyleInjection(iframeRef: RefObject<HTMLIFrameElement>) {
    const styleRef = useRef<HTMLStyleElement | null>(null);

    // First load.
    const onLoad = useCallback(() => {
        const doc = iframeRef.current?.contentDocument;
        if (!doc) return;

        const style = doc.createElement('style');
        style.id = 'client-root-vars';
        style.textContent = cssVarsToString(getRootCssVariables());
        styleRef.current = style;

        doc.head.appendChild(style);
    }, [ iframeRef ]);

    // React to changes.
    useEffect(() => {
        const listener = () => {
            styleRef.current!.textContent = cssVarsToString(getRootCssVariables());
        };

        const media = window.matchMedia("(prefers-color-scheme: dark)");
        media.addEventListener("change", listener);
        return () => media.removeEventListener("change", listener);
    }, [ iframeRef ]);

    return {
        onLoad
    };
}

function getRootCssVariables() {
    const styles = getComputedStyle(document.documentElement);
    const vars: Record<string, string> = {};

    for (let i = 0; i < styles.length; i++) {
        const prop = styles[i];
        if (prop.startsWith('--') && VARIABLE_WHITELIST.has(prop.substring(2))) {
            vars[`--tn-${prop.substring(2)}`] = styles.getPropertyValue(prop).trim();
        }
    }

    return vars;
}

function cssVarsToString(vars: Record<string, string>) {
    return `:root {\n${Object.entries(vars)
        .map(([k, v]) => `  ${k}: ${v};`)
        .join('\n')}\n}`;
}

interface PdfOutlineItem {
    title: string;
    level: number;
    dest: unknown;
    id: string;
    items: PdfOutlineItem[];
}

interface PdfHeading {
    level: number;
    text: string;
    id: string;
    element: null;
}

function convertPdfOutlineToHeadings(outline: PdfOutlineItem[]): PdfHeading[] {
    const headings: PdfHeading[] = [];

    function flatten(items: PdfOutlineItem[]) {
        for (const item of items) {
            headings.push({
                level: item.level + 1,
                text: item.title,
                id: item.id,
                element: null // PDFs don't have DOM elements
            });

            if (item.items && item.items.length > 0) {
                flatten(item.items);
            }
        }
    }

    flatten(outline);
    return headings;
}
