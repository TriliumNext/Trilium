import { useEffect, useRef } from "preact/hooks";

import appContext from "../../../components/app_context";
import type NoteContext from "../../../components/note_context";
import FBlob from "../../../entities/fblob";
import FNote from "../../../entities/fnote";
import { useViewModeConfig } from "../../collections/NoteList";
import { useBlobEditorSpacedUpdate, useEffectiveReadOnly, useTriliumEvent } from "../../react/hooks";
import PdfViewer from "./PdfViewer";

export default function PdfPreview({ note, blob, componentId, noteContext }: {
    note: FNote;
    noteContext: NoteContext;
    blob: FBlob | null | undefined;
    componentId: string | undefined;
}) {
    const iframeRef = useRef<HTMLIFrameElement>(null);
    const isReadOnly = useEffectiveReadOnly(note, noteContext);
    const historyConfig = useViewModeConfig<HistoryData>(note, "pdfHistory");
    const annotationScrolledRef = useRef(false);
    // Stores the annotation we intend to scroll to. Survives spurious noteSwitched
    // events that reset viewScope.annotationId to undefined before the scroll fires.
    const pendingAnnotationIdRef = useRef<string | undefined>(undefined);

    const spacedUpdate = useBlobEditorSpacedUpdate({
        note,
        noteType: "file",
        noteContext,
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
            if (event.data?.type === "pdfjs-viewer-document-modified") {
                if (!isReadOnly && event.data.noteId === note.noteId && event.data.ntxId === noteContext.ntxId) {
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

                // On first annotation load, scroll to the annotation referenced in the link.
                // Read from pendingAnnotationIdRef rather than viewScope: a spurious
                // noteSwitched with annotationId=undefined can reset viewScope before this
                // message arrives, but the ref survives that reset.
                const pendingId = pendingAnnotationIdRef.current;
                if (pendingId && !annotationScrolledRef.current) {
                    annotationScrolledRef.current = true;
                    const target = resolveAnnotation(
                        event.data.annotations,
                        { ...noteContext.viewScope, annotationId: pendingId }
                    );
                    if (target) {
                        pendingAnnotationIdRef.current = undefined;
                        iframeRef.current?.contentWindow?.postMessage({
                            type: "trilium-scroll-to-annotation",
                            annotationId: target.id,
                            pageNumber: target.pageNumber
                        }, window.location.origin);
                    }
                }
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

    // Reset scroll state when the note changes (fresh PDF load).
    // Also capture the annotationId from viewScope here: for a fresh mount the
    // useTriliumEvent("noteSwitched") handler fires AFTER noteSwitched has already
    // propagated, so it misses the event. Reading from the mutable noteContext object
    // at effect time is safe because this runs before pdfjs-viewer-annotations arrives.
    useEffect(() => {
        annotationScrolledRef.current = false;
        pendingAnnotationIdRef.current = noteContext.viewScope?.annotationId;
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [ note.noteId ]);

    // Handle same-note re-navigation (different annotationId, PDF already loaded).
    // noteSwitched fires after viewScope is updated, before any re-render. Since PdfPreview
    // doesn't re-render for same-note viewScope changes, pdfjs-viewer-annotations won't fire
    // again — we must scroll immediately from the already-loaded annotations context data.
    useTriliumEvent("noteSwitched", ({ noteContext: eventNoteContext }) => {
        if (eventNoteContext !== noteContext) return;

        const targetAnnotationId = noteContext.viewScope?.annotationId;
        if (!targetAnnotationId) return;

        // Record what we want to scroll to. This ref survives spurious noteSwitched
        // events that reset viewScope.annotationId to undefined before the scroll fires.
        pendingAnnotationIdRef.current = targetAnnotationId;
        annotationScrolledRef.current = false;

        const existing = noteContext.getContextData("pdfAnnotations");
        if (!existing) {
            // Context data was cleared when the user navigated away from this PDF and back.
            // The iframe is still loaded (same src = no reload), so pdfjs-viewer-annotations
            // won't fire automatically. Request a fresh extraction.
            iframeRef.current?.contentWindow?.postMessage(
                { type: "trilium-request-annotations" },
                window.location.origin
            );
            return;
        }

        const target = resolveAnnotation(existing.annotations, noteContext.viewScope);
        if (target) {
            annotationScrolledRef.current = true;
            pendingAnnotationIdRef.current = undefined;
            iframeRef.current?.contentWindow?.postMessage({
                type: "trilium-scroll-to-annotation",
                annotationId: target.id,
                pageNumber: target.pageNumber
            }, window.location.origin);
        }
    });

    useTriliumEvent("customDownload", ({ ntxId }) => {
        if (ntxId !== noteContext.ntxId) return;
        iframeRef.current?.contentWindow?.postMessage({
            type: "trilium-request-download"
        });
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
            pdfUrl={new URL(`${window.glob.baseApiUrl}notes/${note.noteId}/open`, window.location.href).pathname}
            onLoad={() => {
                const win = iframeRef.current?.contentWindow;
                if (win) {
                    // Skip view history restoration when navigating via annotation link.
                    // PDF.js applies the saved pixel-scroll offset lazily (after page render),
                    // which fires after our scroll-to-annotation and overrides it.
                    if (!noteContext.viewScope?.annotationId) {
                        win.TRILIUM_VIEW_HISTORY_STORE = historyConfig.config;
                    }
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

/**
 * Find the annotation to scroll to from a list, given the viewScope from the navigation URL.
 *
 * Tries an exact ID match first. Falls back to page-number + content matching because
 * PDF.js reassigns annotation IDs when the PDF is saved (temporary editor IDs become
 * permanent PDF object references), so a link copied before saving will have a stale ID.
 */
function resolveAnnotation(
    annotations: PdfAnnotationInfo[],
    viewScope: import("../../../services/link").ViewScope | undefined
): PdfAnnotationInfo | undefined {
    if (!viewScope?.annotationId) return undefined;

    // 1. Exact ID match (works for existing PDF annotations and links copied after save).
    const exact = annotations.find((a) => a.id === viewScope.annotationId);
    if (exact) return exact;

    // 2. Fallback: match by page number + content preview (handles ID rotation after save).
    const page = viewScope.annotationPage;
    const rawPreview = viewScope.annotationPreview?.replace(/…$/, "") ?? "";
    if (!page || !rawPreview) return undefined;

    return annotations.find(
        (a) =>
            a.pageNumber === page &&
            (a.highlightedText.startsWith(rawPreview) || a.contents.startsWith(rawPreview))
    );
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
