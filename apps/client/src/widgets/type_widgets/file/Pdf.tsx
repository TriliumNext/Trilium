import type { ReferenceParams } from "@triliumnext/commons";
import { findActivePdfHeading, type PdfTocHeading } from "@triliumnext/commons/src/lib/pdf_toc.js";
import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";

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
import PdfViewer, {
    applyReadingMessage, getPdfUrl, nextPdfLoadToken, type PdfReading
} from "./PdfViewer";
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

type PdfSectionKey = "pdfPages" | "pdfAttachments" | "pdfAnnotations" | "pdfLayers";
type PdfContextDataKey = "tocDocument" | PdfSectionKey;

const PDF_SECTION_KEYS: PdfSectionKey[] = [
    "pdfPages", "pdfAttachments", "pdfLayers", "pdfAnnotations"
];

/** The sections that only an editable viewer reports (see `bootstrap.ts`). */
const EDITABLE_SECTION_KEYS: PdfSectionKey[] = [ "pdfPages", "pdfAttachments", "pdfLayers" ];

/** One navigation of the viewer's frame, and where its viewer reads. */
interface PdfLoad extends PdfReading {
    /** Names the navigation; every message of the load includes it. */
    token: string;
    noteId: string;
    /** The blob that the open route serves to the load, or refuses with 409 for another. */
    blobId: string;
    /** Whether the frame loads the viewer in editable mode. */
    isEditable: boolean;
    /** Whether the viewer reported that the document loaded. */
    isConfirmed: boolean;
    /** Whether the viewer cannot show the document. */
    isUnavailable: boolean;
    /** The blob that the viewer shows: the load's, then the blob of each own save. */
    renderedBlobId: string;
    /**
     * What the load published for the sidebar. `NoteContext.setNote()` clears the context data
     * when the pane leaves the note, and a viewer kept mounted does not send its data again, so
     * the pane gets this map back when it shows the PDF again.
     */
    published: Map<PdfContextDataKey, unknown>;
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
    /** The current load; a note of its own starts one, and so does a switch of the mode. */
    const loadRef = useRef<PdfLoad | null>(null);
    const isEditable = !isReadOnly;
    if (!loadRef.current || loadRef.current.noteId !== note.noteId) {
        loadRef.current = createLoad(note.noteId, note.blobId, isEditable);
    } else if (loadRef.current.isEditable !== isEditable) {
        loadRef.current = createLoad(note.noteId, loadRef.current.renderedBlobId, isEditable);
    }
    const load = loadRef.current;
    const [ , setLoadCount ] = useState(0);
    /** The blobs of the loads that failed in a row. */
    const failedLoadsRef = useRef<string[]>([]);
    /** The token of the load when the viewer was asked for the bytes of each save. */
    const saveLoadsRef = useRef(new WeakMap<Blob, string>());
    const tocBuild = useTocBuild(iframeRef, getTocUrl("notes", note.noteId), !!note.isProtected);

    function publish<K extends PdfContextDataKey>(key: K, value: NoteContextDataMap[K]) {
        loadRef.current?.published.set(key, value);
        if (isShown()) {
            noteContext.setContextData(key, value);
        }
    }

    /**
     * Writes what the current load published to the note context, and clears each section that
     * the load lacks. It never clears `tocDocument`, which attachments publish too.
     */
    function syncSidebar() {
        const published = loadRef.current?.published;
        if (!published) return;
        for (const [ key, value ] of published) {
            noteContext.setContextData(key, value as NoteContextDataMap[typeof key]);
        }
        for (const key of PDF_SECTION_KEYS) {
            if (!published.has(key)) {
                noteContext.clearContextData(key);
            }
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
        return loadRef.current?.published.get(key) as NoteContextDataMap[K] | undefined;
    }

    /**
     * Scrolls to the heading, page or annotation a link opened the note at, once the viewer is
     * shown and the current load has listed its annotations, which it does once it can scroll.
     */
    function revealLinkTarget() {
        if (!isShown() || getPublished("pdfAnnotations")?.status !== "ready") return;
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
        const mode = loadRef.current?.isEditable ?? isEditable;
        loadRef.current = createLoad(note.noteId, blobId, mode);
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
            // The viewer of a load given up sends no section.
            failedLoad.isUnavailable = true;
            for (const key of PDF_SECTION_KEYS) {
                failedLoad.published.delete(key);
            }
            failedLoad.published.set("tocDocument", getTocDocument());
            if (isShown()) {
                syncSidebar();
            }
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
            if (newBlob.blobId === loadRef.current?.renderedBlobId) {
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
            handleSectionMessage(event.data);
        }

        /** Publishes the sidebar sections that the viewer of the current load sends. */
        function handleSectionMessage(data: PdfMessageEvent["data"]) {
            const loadToken = loadRef.current?.token;
            if (!loadToken || !("loadToken" in data) || data.loadToken !== loadToken) return;

            if (data.type === "pdfjs-viewer-page-info") {
                publish("pdfPages", {
                    status: "ready",
                    loadToken,
                    totalPages: data.totalPages,
                    currentPage: data.currentPage,
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

            if (data.type === "pdfjs-viewer-current-page") {
                const currentPages = getPublished("pdfPages");
                if (currentPages?.status === "ready") {
                    publish("pdfPages", {
                        ...currentPages,
                        currentPage: data.currentPage
                    });
                }
            }

            if (data.type === "pdfjs-viewer-thumbnail") {
                // Relayed on the window rather than through context data because thumbnails
                // arrive one at a time; the page list keys them itself. It carries the context and
                // the load it was rendered for, since a second viewer relays onto the same window.
                window.dispatchEvent(new CustomEvent("pdf-thumbnail", {
                    detail: {
                        ntxId: noteContext.ntxId,
                        loadToken,
                        pageNumber: data.pageNumber,
                        dataUrl: data.dataUrl
                    }
                }));
            }

            if (data.type === "pdfjs-viewer-attachments") {
                publish("pdfAttachments", {
                    status: "ready",
                    loadToken,
                    attachments: data.attachments,
                    downloadAttachment: (id: string) => {
                        iframeRef.current?.contentWindow?.postMessage({
                            type: "trilium-download-attachment",
                            id
                        }, window.location.origin);
                    }
                });
            }

            if (data.type === "pdfjs-viewer-annotations") {
                publish("pdfAnnotations", {
                    status: "ready",
                    loadToken,
                    annotations: data.annotations,
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

            if (data.type === "pdfjs-viewer-layers") {
                publish("pdfLayers", {
                    status: "ready",
                    loadToken,
                    layers: data.layers,
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
                default:
                    if (!applyReadingMessage(current, data)) return;
            }
            publishTocDocument();
        }

        window.addEventListener("message", handleMessage);
        return () => {
            window.removeEventListener("message", handleMessage);
        };
    }, [ note, historyConfig, componentId, blob, noteContext, isReadOnly, spacedUpdate ]);

    // Runs before the frame of the load can send anything: the sections that the load reports
    // wait for its viewer, and the others go.
    useLayoutEffect(() => {
        const loading = { status: "loading", loadToken: load.token } as const;
        load.published.set("pdfAnnotations", loading);
        if (load.isEditable) {
            for (const key of EDITABLE_SECTION_KEYS) {
                load.published.set(key, loading);
            }
        }
        if (isShown()) {
            syncSidebar();
        }
    }, [ load.token ]);

    useEffect(publishTocDocument, [ load.token, tocBuild.version ]);

    useEffect(() => {
        if (isShown()) {
            syncSidebar();
        }
    }, [ isVisible ]);

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
            editable={load.isEditable}
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

function createLoad(noteId: string, blobId: string, isEditable: boolean): PdfLoad {
    return {
        token: nextPdfLoadToken(), noteId, blobId, isEditable, isConfirmed: false,
        isUnavailable: false, renderedBlobId: blobId, position: null, rotations: [],
        published: new Map()
    };
}
