import type { ReferenceParams } from "@triliumnext/commons";
import {
    findActivePdfHeading, type PdfReadingPosition, type PdfTocHeading
} from "@triliumnext/commons/src/lib/pdf_toc.js";
import { useEffect, useRef, useState } from "preact/hooks";

import appContext from "../../../components/app_context";
import type NoteContext from "../../../components/note_context";
import type { NoteContextDataMap } from "../../../components/note_context";
import FBlob from "../../../entities/fblob";
import FNote from "../../../entities/fnote";
import { copyReferenceWithToast } from "../../../services/clipboard_ext";
import { getTocUrl } from "../../../services/link";
import {
    type LandingTarget, takeLinkTarget, toLandingTarget
} from "../../../services/link_targets";
import open from "../../../services/open";
import options from "../../../services/options";
import { useViewModeConfig } from "../../collections/NoteList";
import { useTriliumEvent } from "../../react/hooks/events";
import { useEffectiveReadOnly, useLinkTargetLanding } from "../../react/hooks/note_context";
import { useBlobEditorSpacedUpdate } from "../../react/hooks/editor";
import type { TocDocumentState } from "../../sidebar/CachedToCProvider";
import PdfViewer, { getPdfUrl, nextPdfLoadToken } from "./PdfViewer";
import { refreshBlobId, useTocBuild } from "./toc_build";

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

/** How many loads in a row can fail before the viewer gives the document up. */
const MAX_FAILED_LOADS = 3;

type PdfContextDataKey =
    "tocDocument" | "pdfPages" | "pdfAttachments" | "pdfAnnotations" | "pdfLayers";

/** One navigation of the viewer's frame. */
interface PdfLoad {
    /** Names the navigation; every message of the load includes it. */
    token: string;
    noteId: string;
    /** The blob that the open route serves to the load, or refuses with 409 for another. */
    blobId: string;
    /** Whether the viewer reported that the document loaded. */
    isConfirmed: boolean;
    /** Whether the viewer cannot show the document. */
    isUnavailable: boolean;
    /** The blob that the viewer shows: the load's, then the blob of each own save. */
    renderedBlobId: string;
    position: PdfReadingPosition | null;
    /** The effective rotation of each page, by page index. */
    rotations: number[];
}

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
    /** The current load; a note of its own starts one. */
    const loadRef = useRef<PdfLoad | null>(null);
    if (!loadRef.current || loadRef.current.noteId !== note.noteId) {
        loadRef.current = createLoad(note.noteId, note.blobId);
    }
    const load = loadRef.current;
    const [ , setLoadCount ] = useState(0);
    /** The blobs of the loads that failed in a row. */
    const failedLoadsRef = useRef<string[]>([]);
    /** The token of the load when the viewer was asked for the bytes of each save. */
    const saveLoadsRef = useRef(new WeakMap<Blob, string>());
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
        if (target) {
            landOn(target);
        }
    }

    /** Posts `target` to the viewer. Returns whether it names a place to show. */
    function landOn({ page, annotation: annotationId, heading: headingId }: LandingTarget) {
        if (headingId) {
            postToViewer({ type: "trilium-scroll-to-heading", headingId, pageNumber: page });
            return true;
        }
        if (page) {
            postToViewer({ type: "trilium-scroll-to-annotation", annotationId, pageNumber: page });
            return true;
        }
        return false;
    }

    /** Navigates the frame to a new load of the blob `blobId`. */
    function startLoad(blobId: string) {
        loadRef.current = createLoad(note.noteId, blobId);
        publishedRef.current.clear();
        setLoadCount((count) => count + 1);
    }

    /** Lands on `params` for the outline, while `shownLoad` is the current, confirmed load. */
    function showTarget(shownLoad: PdfLoad, params: ReferenceParams) {
        if (loadRef.current !== shownLoad || !shownLoad.isConfirmed) {
            return false;
        }
        return landOn(toLandingTarget(params));
    }

    /** What the outline needs to know about the current load. */
    function getTocDocument(): TocDocumentState {
        const current = loadRef.current;
        if (!current || current.isUnavailable) {
            return { status: "unavailable" };
        }
        if (!current.isConfirmed) {
            return { status: "rendering" };
        }
        return {
            status: "shown",
            tocUrl: getTocUrl("notes", note.noteId),
            renderedBlobId: current.renderedBlobId,
            ownerNoteId: note.noteId,
            linkPath: noteContext.notePath ?? note.noteId,
            title: note.title,
            showTarget: (params) => showTarget(current, params),
            findActiveHeading: (headings) => (current.position
                ? findActivePdfHeading(headings as PdfTocHeading[], current.position,
                    current.rotations)
                : null),
            clientBuild: tocBuild.clientBuild
        };
    }

    function publishTocDocument() {
        publish("tocDocument", getTocDocument());
    }

    /**
     * Loads the current blob again after the load `failedLoad` failed: pdf.js reports a refused
     * fetch and a file it cannot open alike. Two failures in a row for one blob, or three in all,
     * make the document unavailable.
     */
    async function recoverFromLoadError(failedLoad: PdfLoad) {
        tocBuild.onLoadError();
        const failed = failedLoadsRef.current;
        const isRepeated = failed.at(-1) === failedLoad.blobId;
        failed.push(failedLoad.blobId);
        let blobId: string | null = null;
        if (!isRepeated && failed.length < MAX_FAILED_LOADS) {
            blobId = await refreshBlobId({ kind: "note", noteId: failedLoad.noteId })
                .catch(() => null);
        }
        if (loadRef.current !== failedLoad) {
            return;
        }
        if (blobId) {
            startLoad(blobId);
        } else {
            failedLoad.isUnavailable = true;
            publishTocDocument();
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

                const loadToken = loadRef.current?.token ?? "";
                const onMessageReceived = (event: PdfMessageEvent) => {
                    if (event.data.type !== "pdfjs-viewer-blob") return;
                    if (event.data.noteId !== note.noteId || event.data.ntxId !== noteContext.ntxId) return;
                    const blob = new Blob([event.data.data as Uint8Array<ArrayBuffer>], { type: note.mime });
                    saveLoadsRef.current.set(blob, loadToken);

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
        onContentChange(newBlob) {
            const current = loadRef.current;
            if (newBlob.blobId === current?.blobId || newBlob.blobId === current?.renderedBlobId) {
                return;
            }
            failedLoadsRef.current = [];
            startLoad(newBlob.blobId);
        },
        dataSaved(savedData, answer) {
            // A save that completes after the viewer loaded another document changes nothing.
            const current = loadRef.current;
            if (!current || saveLoadsRef.current.get(savedData) !== current.token) return;
            tocBuild.onSave(savedData);
            if (answer?.blobId) {
                // The viewer made these bytes: the frame stays, and accepts the save's tag.
                current.renderedBlobId = answer.blobId;
                postToViewer({
                    type: "trilium-saved-revision", loadToken: current.token,
                    blobId: answer.blobId, isProtected: !!note.isProtected
                });
                publishTocDocument();
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

            if (event.data.type === "pdfjs-viewer-toc-build") {
                void tocBuild.saveBuild(event.data);
            }

            handleLoadMessage(event.data);

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

        /** Follows the messages of the current load; those of an earlier one are dropped. */
        function handleLoadMessage(data: PdfMessageEvent["data"]) {
            const current = loadRef.current;
            if (!current || !("loadToken" in data) || data.loadToken !== current.token) return;

            switch (data.type) {
                case "pdfjs-viewer-document-loaded":
                    current.isConfirmed = true;
                    failedLoadsRef.current = [];
                    break;
                case "pdfjs-viewer-document-error":
                    void recoverFromLoadError(current);
                    return;
                case "pdfjs-viewer-position":
                    current.position = { pageNumber: data.pageNumber, x: data.x, y: data.y };
                    break;
                case "pdfjs-viewer-rotations":
                    current.rotations = [ ...data.rotations ];
                    break;
                case "pdfjs-viewer-page-rotation":
                    current.rotations[data.pageNumber - 1] = data.rotation;
                    break;
            }
            publishTocDocument();
        }

        window.addEventListener("message", handleMessage);
        return () => {
            window.removeEventListener("message", handleMessage);
        };
    }, [ note, historyConfig, componentId, blob, noteContext, isReadOnly, spacedUpdate ]);

    // A different PDF reloads the viewer, which sends everything again.
    useEffect(() => () => publishedRef.current.clear(), [ note.noteId ]);

    useEffect(publishTocDocument, [ load.token, tocBuild.version ]);

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
            pdfUrl={`${getPdfUrl(`notes/${note.noteId}/open`)}?blobId=${load.blobId}`}
            loadToken={load.token}
            onLoad={() => {
                tocBuild.onLoad();
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

function createLoad(noteId: string, blobId: string): PdfLoad {
    return {
        token: nextPdfLoadToken(), noteId, blobId, isConfirmed: false, isUnavailable: false,
        renderedBlobId: blobId, position: null, rotations: []
    };
}
