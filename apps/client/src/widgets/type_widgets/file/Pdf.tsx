import { useEffect, useRef } from "preact/hooks";

import appContext from "../../../components/app_context";
import type NoteContext from "../../../components/note_context";
import FBlob from "../../../entities/fblob";
import FNote from "../../../entities/fnote";
import { useViewModeConfig } from "../../collections/NoteList";
import { useBlobEditorSpacedUpdate, useTriliumEvent } from "../../react/hooks";
import PdfViewer from "./PdfViewer";

export default function PdfPreview({ note, blob, componentId, noteContext }: {
    note: FNote;
    noteContext: NoteContext;
    blob: FBlob | null | undefined;
    componentId: string | undefined;
}) {
    const iframeRef = useRef<HTMLIFrameElement>(null);
    const historyConfig = useViewModeConfig<HistoryData>(note, "pdfHistory");

    const spacedUpdate = useBlobEditorSpacedUpdate({
        note,
        noteType: "file",
        noteContext,
        getData() {
            if (!iframeRef.current?.contentWindow) return undefined;

            return new Promise<Blob>((resolve) => {
                const onMessageReceived = (event: PdfMessageEvent) => {
                    if (event.data.type !== "pdfjs-viewer-blob") return;
                    if (event.data.noteId !== note.noteId || event.data.ntxId !== noteContext.ntxId) return;
                    const blob = new Blob([event.data.data as Uint8Array<ArrayBuffer>], { type: note.mime });
                    window.removeEventListener("message", onMessageReceived);
                    resolve(blob);
                };

                window.addEventListener("message", onMessageReceived);
                iframeRef.current?.contentWindow?.postMessage({
                    type: "trilium-request-blob",
                });
            });
        },
        onContentChange() {
            if (iframeRef.current?.contentWindow) {
                iframeRef.current.contentWindow.location.reload();
            }
        }
    });

    useEffect(() => {
        function handleMessage(event: PdfMessageEvent) {
            if (event.data?.type === "pdfjs-viewer-document-modified") {
                if (event.data.noteId === note.noteId && event.data.ntxId === noteContext.ntxId) {
                    spacedUpdate.resetUpdateTimer();
                    spacedUpdate.scheduleUpdate();
                }
            }

            if (event.data.type === "pdfjs-viewer-save-view-history" && event.data?.data) {
                if (event.data.noteId === note.noteId && event.data.ntxId === noteContext.ntxId) {
                    historyConfig?.storeFn(JSON.parse(event.data.data));
                }
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

    useTriliumEvent("customDownload", ({ ntxId }) => {
        if (ntxId !== noteContext.ntxId) return;
        iframeRef.current?.contentWindow?.postMessage({
            type: "trilium-request-download"
        });
    });

    return (historyConfig &&
        <PdfViewer
            iframeRef={iframeRef}
            tabIndex={300}
            pdfUrl={`../../api/notes/${note.noteId}/open`}
            onLoad={() => {
                const win = iframeRef.current?.contentWindow;
                if (win) {
                    win.TRILIUM_VIEW_HISTORY_STORE = historyConfig.config;
                    win.TRILIUM_NOTE_ID = note.noteId;
                    win.TRILIUM_NTX_ID = noteContext.ntxId;
                }

                if (iframeRef.current?.contentWindow) {
                    iframeRef.current.contentWindow.addEventListener('click', () => {
                        appContext.tabManager.activateNoteContext(noteContext.ntxId);
                    });
                }
            }}
        />
    );
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
