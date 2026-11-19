import { escapeHtml } from "@triliumnext/commons/src/lib/utils.js";
import { useEffect, useRef } from "preact/hooks";

import appContext from "../../../components/app_context";
import type NoteContext from "../../../components/note_context";
import type { NoteContextDataMap } from "../../../components/note_context";
import FBlob from "../../../entities/fblob";
import FNote from "../../../entities/fnote";
import { copyReferenceWithToast } from "../../../services/clipboard_ext";
import { getTocUrl } from "../../../services/link";
import { takeLinkTarget } from "../../../services/link_targets";
import open from "../../../services/open";
import options from "../../../services/options";
import { useViewModeConfig } from "../../collections/NoteList";
import { useTriliumEvent } from "../../react/hooks/events";
import { useEffectiveReadOnly, useLinkTargetLanding } from "../../react/hooks/note_context";
import { useBlobEditorSpacedUpdate } from "../../react/hooks/editor";
import PdfViewer, { getPdfUrl } from "./PdfViewer";
import { useTocBuild } from "./toc_build";

/**
 * How long annotating is left to settle before a save. Longer than the second an editor of text
 * takes, because every save re-uploads and re-syncs the whole PDF however small the edit was.
 */
const SAVE_INTERVAL = 5_000;

/**
 * The form of the id pdf.js gives an annotation stored in the document: its object reference,
 * such as `12R`. An annotation drawn in this session has an editor id instead, which the next load
 * of the document does not reuse.
 */
const STORED_ANNOTATION_ID = /^\d+R\d*$/;

type PdfContextDataKey = "toc" | "pdfPages" | "pdfAttachments" | "pdfAnnotations" | "pdfLayers";

export default function PdfPreview({ note, blob, componentId, noteContext, isVisible = true }: {
    note: FNote;
    noteContext: NoteContext;
    blob: FBlob | null | undefined;
    componentId: string | undefined;
    /** False while `NoteDetail` keeps the viewer mounted but the pane shows another note. */
    isVisible?: boolean;
}) {
    const iframeRef = useRef<HTMLIFrameElement>(null);
    const isReadOnly = useEffectiveReadOnly(note, noteContext);
    const historyConfig = useViewModeConfig<HistoryData>(note, "pdfHistory");
    const isVisibleRef = useRef(isVisible);
    isVisibleRef.current = isVisible;
    /**
     * What the viewer last sent for each sidebar panel. `NoteContext.setNote()` clears the context
     * data when the pane leaves the note, and a viewer kept mounted has loaded already, so it does
     * not send its data again on the way back.
     */
    const publishedRef = useRef(new Map<PdfContextDataKey, unknown>());
    /** How many times the iframe has loaded a viewer. */
    const loadCountRef = useRef(0);
    /** The load count when the viewer was asked for the bytes of each save. */
    const saveLoadsRef = useRef(new WeakMap<Blob, number>());
    const tocBuild = useTocBuild(iframeRef, getTocUrl("notes", note.noteId), !!note.isProtected);

    function publish<K extends PdfContextDataKey>(key: K, value: NoteContextDataMap[K]) {
        publishedRef.current.set(key, value);
        if (isShown()) {
            noteContext.setContextData(key, value);
        }
    }

    /**
     * Whether the pane shows this viewer's PDF. `NoteDetailWrapper` passes `isVisible` at once
     * and the next note's props a render later, so a viewer kept from another PDF is briefly
     * visible while `noteContext.note` is already the new one.
     */
    function isShown() {
        return isVisibleRef.current && noteContext.note?.noteId === note.noteId;
    }

    function getPublished<K extends PdfContextDataKey>(key: K) {
        return publishedRef.current.get(key) as NoteContextDataMap[K] | undefined;
    }

    /**
     * Scrolls to the heading, page or annotation a link opened the note at, once the viewer is
     * shown and has listed its annotations, which it does once it can scroll to one.
     */
    function revealLinkTarget() {
        if (!isShown() || !publishedRef.current.has("pdfAnnotations")) return;
        const target = takeLinkTarget(noteContext.viewScope, [ "page", "annotation", "heading" ]);
        if (!target) return;

        const { page, annotation: annotationId, heading: headingId } = target;
        if (headingId) {
            postToViewer({ type: "trilium-scroll-to-heading", headingId, pageNumber: page });
        } else if (page) {
            postToViewer({ type: "trilium-scroll-to-annotation", annotationId, pageNumber: page });
        }
    }

    function postToViewer(message: object) {
        iframeRef.current?.contentWindow?.postMessage(message, window.location.origin);
    }

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

                const loadCount = loadCountRef.current;
                const onMessageReceived = (event: PdfMessageEvent) => {
                    if (event.data.type !== "pdfjs-viewer-blob") return;
                    if (event.data.noteId !== note.noteId || event.data.ntxId !== noteContext.ntxId) return;
                    const blob = new Blob([event.data.data as Uint8Array<ArrayBuffer>], { type: note.mime });
                    saveLoadsRef.current.set(blob, loadCount);

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
                publishedRef.current.clear();
                iframeRef.current.contentWindow.location.reload();
            }
        },
        dataSaved(savedData) {
            // A save that completes after the viewer loaded another document starts nothing.
            if (saveLoadsRef.current.get(savedData) !== loadCountRef.current) return;
            void savedData.arrayBuffer()
                .then((buffer) => tocBuild.requestBuild(new Uint8Array(buffer)));
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

            if (event.data.type === "pdfjs-viewer-toc-build") {
                void tocBuild.saveBuild(event.data);
            }

            if (event.data.type === "pdfjs-viewer-toc") {
                if (event.data.data) {
                    // Convert PDF outline to HeadingContext format
                    const headings = convertPdfOutlineToHeadings(event.data.data);
                    publish("toc", {
                        headings,
                        activeHeadingId: null,
                        scrollToHeading: (heading) => {
                            postToViewer({
                                type: "trilium-scroll-to-heading", headingKey: heading.id
                            });
                        }
                    });
                } else {
                    // No ToC available, use empty headings
                    publish("toc", {
                        headings: [],
                        activeHeadingId: null,
                        scrollToHeading: () => {}
                    });
                }
            }

            if (event.data.type === "pdfjs-viewer-active-heading") {
                const currentToc = getPublished("toc");
                if (currentToc) {
                    publish("toc", {
                        ...currentToc,
                        activeHeadingId: event.data.headingId
                    });
                }
            }

            if (event.data.type === "pdfjs-viewer-page-info") {
                publish("pdfPages", {
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
                    },
                    copyReference: (page: number) => {
                        void copyReferenceWithToast(pdfReference(getNotePath(), page));
                    }
                });
            }

            if (event.data.type === "pdfjs-viewer-current-page") {
                const currentPages = getPublished("pdfPages");
                if (currentPages) {
                    publish("pdfPages", {
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
                publish("pdfAttachments", {
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
                publish("pdfAnnotations", {
                    annotations: event.data.annotations,
                    scrollToAnnotation: (annotationId: string, pageNumber: number) => {
                        iframeRef.current?.contentWindow?.postMessage({
                            type: "trilium-scroll-to-annotation",
                            annotationId,
                            pageNumber
                        }, window.location.origin);
                    },
                    copyReference: (annotationId: string, pageNumber: number) => {
                        void copyReferenceWithToast(pdfReference(getNotePath(), pageNumber, annotationId));
                    }
                });

                revealLinkTarget();
            }

            if (event.data.type === "pdfjs-viewer-layers") {
                publish("pdfLayers", {
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

        function getNotePath() {
            return noteContext.notePath ?? note.noteId;
        }

        window.addEventListener("message", handleMessage);
        return () => {
            window.removeEventListener("message", handleMessage);
        };
    }, [ note, historyConfig, componentId, blob, noteContext, isReadOnly, spacedUpdate ]);

    // A different PDF reloads the viewer, which sends everything again.
    useEffect(() => () => publishedRef.current.clear(), [ note.noteId ]);

    useEffect(() => {
        if (!isShown()) return;
        for (const key of publishedRef.current.keys()) {
            republish(key);
        }
    }, [ isVisible ]);

    function republish<K extends PdfContextDataKey>(key: K) {
        const value = getPublished(key);
        if (value) {
            noteContext.setContextData(key, value);
        }
    }

    useLinkTargetLanding({ note, ntxId: noteContext.ntxId, isVisible }, revealLinkTarget);

    useTriliumEvent("customDownload", async ({ ntxId }) => {
        if (ntxId !== noteContext.ntxId) return;

        // Flush any pending in-viewer edits (e.g. annotations) to the server before
        // downloading, so the file reflects the latest state and not just the last
        // debounced auto-save. No-op for read-only PDFs, which have nothing to save.
        await spacedUpdate.updateNowIfNecessary();

        const url = `${open.getUrlForDownload(`api/notes/${note.noteId}/download`)}?${Date.now()}`;
        open.download(url);
    });

    useTriliumEvent("printActiveNote", ({ ntxId }) => {
        if (!noteContext.isCommandTarget(ntxId)) return;
        iframeRef.current?.contentWindow?.postMessage({
            type: "trilium-print"
        }, window.location.origin);
    });

    useTriliumEvent("findInText", ({ ntxId }) => {
        if (!noteContext.isCommandTarget(ntxId)) return;
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
                loadCountRef.current++;
                void tocBuild.requestBuild();
                const win = iframeRef.current?.contentWindow;
                if (win) {
                    win.TRILIUM_VIEW_HISTORY_STORE = historyConfig.config;
                    win.TRILIUM_SIGNATURES = options.getJson("pdfSignatures") ?? {};
                }

                if (iframeRef.current?.contentWindow) {
                    iframeRef.current.contentWindow.addEventListener('click', () => {
                        appContext.tabManager.activateNoteContext(noteContext.ntxId);
                    });
                }
            }}
            editable={!isReadOnly}
            noteId={note.noteId}
            ntxId={noteContext.ntxId}
        />
    );
}

/**
 * The link that opens a PDF note at `pageNumber`, and at the annotation `annotationId` on it when
 * the document already stores that annotation.
 */
function pdfReference(notePath: string, pageNumber: number, annotationId?: string) {
    let reference = `#${notePath}?page=${pageNumber}`;
    if (annotationId && STORED_ANNOTATION_ID.test(annotationId)) {
        reference += `&annotation=${encodeURIComponent(annotationId)}`;
    }
    return reference;
}

interface PdfHeading {
    level: number;
    /** HTML, as the sidebar renders the headings of every note type. */
    text: string;
    /** The key of the heading in the viewer. */
    id: string;
    element: null;
}

/** The headings of the sidebar. The titles of a PDF are plain text, so they are escaped. */
function convertPdfOutlineToHeadings(outline: PdfOutlineItem[]): PdfHeading[] {
    return outline.map(({ id, title, level }) => ({
        id, level, text: escapeHtml(title), element: null
    }));
}
