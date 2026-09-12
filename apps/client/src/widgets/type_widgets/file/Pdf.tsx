import { useEffect, useRef } from "preact/hooks";

import appContext from "../../../components/app_context";
import type NoteContext from "../../../components/note_context";
import FBlob from "../../../entities/fblob";
import FNote from "../../../entities/fnote";
import open from "../../../services/open";
import options from "../../../services/options";
import { useViewModeConfig } from "../../collections/NoteList";
import { useBlobEditorSpacedUpdate, useEffectiveReadOnly, useTriliumEvent } from "../../react/hooks";
import PdfViewer, { getPdfUrl } from "./PdfViewer";

/**
 * How long annotating is left to settle before a save. Longer than the second an editor of text
 * takes, because every save re-uploads and re-syncs the whole PDF however small the edit was.
 */
const SAVE_INTERVAL = 5_000;

export default function PdfPreview({ note, blob, componentId, noteContext }: {
    note: FNote;
    noteContext: NoteContext;
    blob: FBlob | null | undefined;
    componentId: string | undefined;
}) {
    const iframeRef = useRef<HTMLIFrameElement>(null);
    const isReadOnly = useEffectiveReadOnly(note, noteContext);
    const historyConfig = useViewModeConfig<HistoryData>(note, "pdfHistory");

    const spacedUpdate = useBlobEditorSpacedUpdate({
        note,
        noteType: "file",
        noteContext,
        updateInterval: SAVE_INTERVAL,
        getData() {
            if (!iframeRef.current?.contentWindow) return undefined;

            return new Promise<Blob>((resolve, reject) => {
                const timeout = setTimeout(() => {
                    reject(new Error("Timeout while waiting for blob response"));
                }, 10_000);

                const onMessageReceived = (event: PdfMessageEvent) => {
                    if (event.data.type !== "pdfjs-viewer-blob") return;
                    if (event.data.noteId !== note.noteId || event.data.ntxId !== noteContext.ntxId) return;
                    const blob = new Blob([event.data.data as Uint8Array<ArrayBuffer>], { type: note.mime });

                    clearTimeout(timeout);
                    window.removeEventListener("message", onMessageReceived);
                    resolve(blob);
                };

                window.addEventListener("message", onMessageReceived);
                iframeRef.current?.contentWindow?.postMessage({
                    type: "trilium-request-blob",
                }, window.location.origin);
            });
        },
        onContentChange() {
            if (iframeRef.current?.contentWindow) {
                iframeRef.current.contentWindow.location.reload();
            }
        },
        replaceWithoutRevision: true
    });

    useEffect(() => {
        function handleMessage(event: PdfMessageEvent) {
            // Every viewer posts to the shared parent window, so a second one — a split, or
            // another tab that has been opened — delivers its messages here as well.
            // Everything below writes this note context's data or talks to this iframe, so
            // a message addressed to a different viewer would show one document's
            // annotations while navigating another's.
            if (event.data?.noteId !== note.noteId || event.data?.ntxId !== noteContext.ntxId) return;

            if (event.data?.type === "pdfjs-viewer-document-modified" && !isReadOnly) {
                spacedUpdate.resetUpdateTimer();
                spacedUpdate.scheduleUpdate();
            }

            if (event.data.type === "pdfjs-viewer-save-view-history" && event.data?.data) {
                historyConfig?.storeFn(JSON.parse(event.data.data));
            }

            if (event.data?.type === "pdfjs-viewer-save-signatures" && event.data?.data) {
                // The library is global rather than per-note; the guard above keeps every open
                // PDF from re-saving the same payload.
                options.save("pdfSignatures", event.data.data);
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
                // Relayed on the window rather than through context data because thumbnails
                // arrive one at a time; the page list keys them itself. It carries the context it
                // was rendered for, since a second viewer relays onto the same window.
                window.dispatchEvent(new CustomEvent("pdf-thumbnail", {
                    detail: {
                        ntxId: noteContext.ntxId,
                        pageNumber: event.data.pageNumber,
                        dataUrl: event.data.dataUrl
                    }
                }));
            }

            if (event.data.type === "pdfjs-viewer-attachments") {
                noteContext.setContextData("pdfAttachments", {
                    attachments: event.data.attachments,
                    downloadAttachment: (id: string) => {
                        iframeRef.current?.contentWindow?.postMessage({
                            type: "trilium-download-attachment",
                            id
                        }, window.location.origin);
                    }
                });
            }

            if (event.data.type === "pdfjs-viewer-annotations") {
                noteContext.setContextData("pdfAnnotations", {
                    annotations: event.data.annotations,
                    scrollToAnnotation: (annotationId: string, pageNumber: number) => {
                        iframeRef.current?.contentWindow?.postMessage({
                            type: "trilium-scroll-to-annotation",
                            annotationId,
                            pageNumber
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
    }, [ note, historyConfig, componentId, blob, noteContext, isReadOnly, spacedUpdate ]);

    useTriliumEvent("customDownload", async ({ ntxId }) => {
        if (ntxId !== noteContext.ntxId) return;

        // Flush any pending in-viewer edits (e.g. annotations) to the server before
        // downloading, so the file reflects the latest state and not just the last
        // debounced auto-save. No-op for read-only PDFs, which have nothing to save.
        await spacedUpdate.updateNowIfNecessary();

        const url = `${open.getUrlForDownload(`api/notes/${note.noteId}/download`)}?${Date.now()}`;
        open.download(url);
    });

    useTriliumEvent("printActiveNote", () => {
        if (!noteContext.isActive()) return;
        iframeRef.current?.contentWindow?.postMessage({
            type: "trilium-print"
        }, window.location.origin);
    });

    useTriliumEvent("findInText", () => {
        if (!noteContext.isActive()) return;
        iframeRef.current?.contentWindow?.postMessage({
            type: "trilium-find"
        }, window.location.origin);
    });

    return (historyConfig &&
        <PdfViewer
            iframeRef={iframeRef}
            tabIndex={300}
            pdfUrl={getPdfUrl(`notes/${note.noteId}/open`)}
            onLoad={() => {
                const win = iframeRef.current?.contentWindow;
                if (win) {
                    win.TRILIUM_VIEW_HISTORY_STORE = historyConfig.config;
                    win.TRILIUM_SIGNATURES = options.getJson("pdfSignatures") ?? {};
                    win.TRILIUM_NOTE_ID = note.noteId;
                    win.TRILIUM_NTX_ID = noteContext.ntxId;
                }

                if (iframeRef.current?.contentWindow) {
                    iframeRef.current.contentWindow.addEventListener('click', () => {
                        appContext.tabManager.activateNoteContext(noteContext.ntxId);
                    });
                }
            }}
            editable={!isReadOnly}
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
