import type { RefObject } from "preact";
import { useEffect, useRef } from "preact/hooks";

import appContext from "../../../components/app_context";
import type NoteContext from "../../../components/note_context";
import FBlob from "../../../entities/fblob";
import FNote from "../../../entities/fnote";
import { t } from "../../../services/i18n";
import contextMenu from "../../../menus/context_menu";
import server from "../../../services/server";
import { textPrompt } from "../../../services/textPrompt";
import toast from "../../../services/toast";
import { PDF_ANNOTATION_COLORS } from "../../sidebar/pdf/pdfAnnotationColors";
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
                    },
                    setAnnotationColor: (annotationId: string, color: string) => {
                        iframeRef.current?.contentWindow?.postMessage({
                            type: "trilium-set-annotation-color",
                            annotationId,
                            color
                        }, window.location.origin);
                    },
                    deleteAnnotation: (annotationId: string, pageNumber: number) => {
                        iframeRef.current?.contentWindow?.postMessage({
                            type: "trilium-delete-annotation",
                            annotationId,
                            pageNumber
                        }, window.location.origin);
                    }
                });

                // On first annotation load, scroll to the annotation referenced in the link.
                // Area annotations (prefix "area:") live in pdfAreaAnnotations, not here —
                // their scroll is handled in pdfjs-viewer-ready-for-overlays instead.
                const pendingId = pendingAnnotationIdRef.current;
                if (pendingId && !pendingId.startsWith("area:") && !annotationScrolledRef.current) {
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

            if (event.data.type === "pdfjs-viewer-area-capture") {
                handleAreaCapture(
                    note,
                    event.data.imageData,
                    event.data.pageNumber,
                    event.data.rect,
                    noteContext,
                    iframeRef
                );
            }

            if (event.data.type === "pdfjs-viewer-area-right-click") {
                handleAreaRightClick(event.data, noteContext, iframeRef);
            }

            if (event.data.type === "pdfjs-viewer-ready-for-overlays") {
                // The PDF viewer just registered its trilium-set-area-overlays listener.
                // Send the current area overlays now that it's ready to receive them.
                const areaCtx = noteContext.getContextData("pdfAreaAnnotations");
                if (areaCtx?.annotations.length) {
                    iframeRef.current?.contentWindow?.postMessage(
                        {
                            type: "trilium-set-area-overlays",
                            areas: areaCtx.annotations.map((a) => ({
                                pageNumber: a.pageNumber,
                                rect: a.rect,
                                color: a.color,
                                attachmentId: a.attachmentId,
                                attributeId: a.attributeId,
                                comment: a.comment
                            }))
                        },
                        window.location.origin
                    );

                    // If a copied area link was clicked (fresh load path), scroll now.
                    const pendingId = pendingAnnotationIdRef.current;
                    if (pendingId?.startsWith("area:") && !annotationScrolledRef.current) {
                        const attachmentId = pendingId.slice(5);
                        const area = areaCtx.annotations.find((a) => a.attachmentId === attachmentId);
                        if (area) {
                            annotationScrolledRef.current = true;
                            pendingAnnotationIdRef.current = undefined;
                            iframeRef.current?.contentWindow?.postMessage(
                                { type: "trilium-scroll-to-area", pageNumber: area.pageNumber, rect: area.rect },
                                window.location.origin
                            );
                        }
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

    // Load area annotations (image captures stored as attachments) when the PDF note changes.
    useEffect(() => {
        loadAreaAnnotations(note, noteContext, iframeRef);
    }, [ note.noteId ]);

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

        // Area annotation link — stored in pdfAreaAnnotations, scrolled via trilium-scroll-to-area
        if (targetAnnotationId.startsWith("area:")) {
            const attachmentId = targetAnnotationId.slice(5);
            const areaCtx = noteContext.getContextData("pdfAreaAnnotations");
            if (!areaCtx) {
                // Area annotations not loaded yet (context was cleared on navigate-away).
                // loadAreaAnnotations will be called and will handle the scroll once done.
                loadAreaAnnotations(note, noteContext, iframeRef, pendingAnnotationIdRef, annotationScrolledRef);
            } else {
                const area = areaCtx.annotations.find((a) => a.attachmentId === attachmentId);
                if (area) {
                    annotationScrolledRef.current = true;
                    pendingAnnotationIdRef.current = undefined;
                    iframeRef.current?.contentWindow?.postMessage(
                        { type: "trilium-scroll-to-area", pageNumber: area.pageNumber, rect: area.rect },
                        window.location.origin
                    );
                }
            }
            return;
        }

        // Regular text / highlight annotation
        const existing = noteContext.getContextData("pdfAnnotations");
        if (!existing) {
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

/** Note label used to store area annotation metadata (attachmentId + page + rect). */
const AREA_ANNOTATION_LABEL = "areaAnnotation";

async function loadAreaAnnotations(
    note: FNote,
    noteContext: NoteContext,
    iframeRef: RefObject<HTMLIFrameElement>,
    pendingAnnotationIdRef?: { current: string | undefined },
    annotationScrolledRef?: { current: boolean }
) {
    const capturedNoteId = note.noteId;
    try {
        const attributes = await server.get<{ attributeId: string; type: string; name: string; value: string }[]>(
            `notes/${capturedNoteId}/attributes`
        );

        // Guard: user may have navigated away while the fetch was in-flight
        if (noteContext.noteId !== capturedNoteId) return;

        const areaAnnotations: PdfAreaAnnotationInfo[] = attributes
            .filter((a) => a.type === "label" && a.name === AREA_ANNOTATION_LABEL)
            .map((a) => {
                try {
                    const { attachmentId, page, rect, comment, color } = JSON.parse(a.value);
                    return {
                        attachmentId,
                        attributeId: a.attributeId,
                        pageNumber: page,
                        rect,
                        imageUrl: `api/attachments/${attachmentId}/open`,
                        comment,
                        color
                    } satisfies PdfAreaAnnotationInfo;
                } catch {
                    return null;
                }
            })
            .filter((a): a is NonNullable<typeof a> => a !== null);

        noteContext.setContextData("pdfAreaAnnotations", {
            annotations: areaAnnotations,
            scrollToArea(pageNumber, rect) {
                iframeRef.current?.contentWindow?.postMessage(
                    { type: "trilium-scroll-to-area", pageNumber, rect },
                    window.location.origin
                );
            },
            async deleteArea(attachmentId, attributeId) {
                await server.remove(`notes/${note.noteId}/attributes/${attributeId}`);
                await server.remove(`attachments/${attachmentId}`);
                await loadAreaAnnotations(note, noteContext, iframeRef);
            },
            async updateArea(attributeId, patch) {
                // Find the existing annotation to merge the patch into its stored JSON
                const existing = areaAnnotations.find((a) => a.attributeId === attributeId);
                if (!existing) return;
                const updated = {
                    attachmentId: existing.attachmentId,
                    page: existing.pageNumber,
                    rect: existing.rect,
                    comment: patch.comment !== undefined ? patch.comment : existing.comment,
                    color: patch.color !== undefined ? patch.color : existing.color
                };
                // Replace attribute: delete old, create new with same name
                await server.remove(`notes/${note.noteId}/attributes/${attributeId}`);
                await server.post(`notes/${note.noteId}/attributes`, {
                    type: "label",
                    name: AREA_ANNOTATION_LABEL,
                    value: JSON.stringify(updated)
                });
                await loadAreaAnnotations(note, noteContext, iframeRef);
            }
        });

        // Redraw persistent overlays in the PDF viewer with all metadata.
        // Note: at initial load the iframe may not have set up its listener yet.
        // The viewer signals "pdfjs-viewer-ready-for-overlays" once ready, and we
        // resend the data then. This postMessage is for redraws when context changes.
        iframeRef.current?.contentWindow?.postMessage(
            {
                type: "trilium-set-area-overlays",
                areas: areaAnnotations.map((a) => ({
                    pageNumber: a.pageNumber,
                    rect: a.rect,
                    color: a.color,
                    attachmentId: a.attachmentId,
                    attributeId: a.attributeId,
                    comment: a.comment
                }))
            },
            window.location.origin
        );

        // If a pending area annotation scroll was requested (e.g. user clicked a copied
        // area link while this note was not yet loaded), scroll to it now.
        const pendingId = pendingAnnotationIdRef?.current;
        if (pendingId?.startsWith("area:") && !annotationScrolledRef?.current) {
            const attachmentId = pendingId.slice(5);
            const area = areaAnnotations.find((a) => a.attachmentId === attachmentId);
            if (area) {
                if (annotationScrolledRef) annotationScrolledRef.current = true;
                if (pendingAnnotationIdRef) pendingAnnotationIdRef.current = undefined;
                iframeRef.current?.contentWindow?.postMessage(
                    { type: "trilium-scroll-to-area", pageNumber: area.pageNumber, rect: area.rect },
                    window.location.origin
                );
            }
        }
    } catch (e) {
        console.error("Failed to load area annotations:", e);
    }
}

async function handleAreaCapture(
    note: FNote,
    imageData: string,
    pageNumber: number,
    rect: { x: number; y: number; width: number; height: number },
    noteContext: NoteContext,
    iframeRef: RefObject<HTMLIFrameElement>
) {
    try {
        // Convert base64 → binary File so server.upload stores real binary bytes
        // (posting base64 as a JSON string stores UTF-8 text, not decoded PNG)
        const base64 = imageData.replace("data:image/png;base64,", "");
        const binary = atob(base64);
        const bytes = new Uint8Array(binary.length);
        for (let i = 0; i < binary.length; i++) {
            bytes[i] = binary.charCodeAt(i);
        }
        const file = new File([bytes], "area-capture.png", { type: "image/png" });

        // Upload via the binary-safe multipart route (role="image" set automatically)
        const result = await server.upload(
            `notes/${note.noteId}/attachments/upload`, file, undefined, "POST"
        ) as { uploaded: boolean; url: string };

        if (!result?.uploaded || !result?.url) {
            throw new Error("Upload returned no URL");
        }

        // URL format: "api/attachments/{attachmentId}/image/{title}"
        const attachmentIdMatch = result.url.match(/api\/attachments\/([^/]+)\//);
        const attachmentId = attachmentIdMatch?.[1];
        if (!attachmentId) throw new Error(`Could not extract attachmentId from URL: ${result.url}`);

        // Store metadata as a note label so it survives across sessions
        await server.post(`notes/${note.noteId}/attributes`, {
            type: "label",
            name: AREA_ANNOTATION_LABEL,
            value: JSON.stringify({ attachmentId, page: pageNumber, rect })
        });

        toast.showMessage(t("pdf.area_capture_saved"));
        await loadAreaAnnotations(note, noteContext, iframeRef);
    } catch (e) {
        console.error("Area capture failed:", e);
        toast.showError(t("pdf.area_capture_failed"));
    }
}

const AREA_PRESET_COLORS = PDF_ANNOTATION_COLORS;

function handleAreaRightClick(
    data: PdfViewerAreaRightClickMessage,
    noteContext: NoteContext,
    iframeRef: RefObject<HTMLIFrameElement>
) {
    const areaCtx = noteContext.getContextData("pdfAreaAnnotations");
    const annotation = areaCtx?.annotations.find((a) => a.attachmentId === data.attachmentId);
    if (!annotation || !areaCtx) return;

    // Convert iframe-relative client coords → parent page coords
    const iframeRect = iframeRef.current?.getBoundingClientRect();
    const pageX = (iframeRect?.left ?? 0) + window.scrollX + data.clientX;
    const pageY = (iframeRect?.top ?? 0) + window.scrollY + data.clientY;

    contextMenu.show({
        x: pageX,
        y: pageY,
        items: [
            {
                title: annotation.comment ? t("pdf.area_edit_note") : t("pdf.area_add_note"),
                command: "editNote",
                uiIcon: "bx bx-comment-add"
            },
            {
                title: t("pdf.area_change_color"),
                command: "changeColor",
                uiIcon: "bx bx-palette",
                items: AREA_PRESET_COLORS.map((c) => ({
                    title: c.label,
                    command: `color:${c.value}`,
                    uiIcon: "bx bx-circle"
                }))
            },
            { kind: "separator" },
            {
                title: t("pdf.area_annotation_delete"),
                command: "delete",
                uiIcon: "bx bx-trash"
            }
        ],
        selectMenuItemHandler: async ({ command }) => {
            if (command === "editNote") {
                const entered = await textPrompt(t("pdf.area_note_prompt"), annotation.comment ?? "");
                if (entered !== null) {
                    areaCtx.updateArea(annotation.attributeId, { comment: entered.trim() });
                }
            } else if (command?.startsWith("color:")) {
                areaCtx.updateArea(annotation.attributeId, { color: command.slice(6) });
            } else if (command === "delete") {
                areaCtx.deleteArea(annotation.attachmentId, annotation.attributeId);
            }
        }
    });
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
