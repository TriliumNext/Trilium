import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type NoteContext from "../../../components/note_context";
import FNote from "../../../entities/fnote";
import options from "../../../services/options";
import server from "../../../services/server";

// The component's own job is the message protocol with the viewer iframe: what it publishes into
// the note context and what it relays. The hooks around it — the spaced-update save, the
// read-only decision, the view-mode config — need the whole app to construct, so they are stood
// in for here; the specs of those hooks cover them.
const spacedUpdate = vi.hoisted(() => ({ resetUpdateTimer: vi.fn(), scheduleUpdate: vi.fn(), updateNowIfNecessary: vi.fn() }));
const readOnly = vi.hoisted(() => ({ current: false }));
const historyStore = vi.hoisted(() => vi.fn());
/** What the component last handed the save hook: its data getter and content-change reaction. */
const saveOptions = vi.hoisted(() => ({ current: null as null | {
    getData(): unknown; onContentChange(blob: unknown): void; dataSaved(blob: Blob): void;
} }));
/** The Trilium event handlers the component registered, by event name. */
const eventHandlers = vi.hoisted(() => new Map<string, (data: any) => unknown>());
vi.mock("../../react/hooks/events", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../react/hooks/events")>()),
    useTriliumEvent: (name: string, handler: (data: any) => unknown) => {
        eventHandlers.set(name, handler);
    }
}));
vi.mock("../../react/hooks/note_context", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../react/hooks/note_context")>()),
    useEffectiveReadOnly: () => readOnly.current
}));
vi.mock("../../react/hooks/editor", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../react/hooks/editor")>()),
    useBlobEditorSpacedUpdate: (options: any) => {
        saveOptions.current = options;
        return spacedUpdate;
    }
}));
vi.mock("../../collections/NoteList", () => ({
    useViewModeConfig: () => ({ config: { files: [] }, storeFn: historyStore })
}));
// The viewer iframe itself is a separate component with its own spec; here it only has to hand
// back a frame the messages can be addressed to, and report it loaded. happy-dom does not load
// iframe pages, so the frame gets a stand-in window from `attachFrameWindow()`.
vi.mock("./PdfViewer", () => ({
    default: ({ iframeRef, onLoad, noteId, ntxId }: {
        iframeRef: { current: HTMLIFrameElement | null }; onLoad: () => void; noteId?: string; ntxId?: string | null;
    }) => <iframe
        ref={(iframe) => { iframeRef.current = iframe && attachFrameWindow(iframe); }}
        class="pdf-preview" onLoad={onLoad} data-note-id={noteId} data-ntx-id={ntxId} />,
    getPdfUrl: (path: string) => `/api/${path}`
}));
const activateNoteContext = vi.hoisted(() => vi.fn());
vi.mock("../../../components/app_context", () => ({
    default: { tabManager: { activateNoteContext } }
}));
const download = vi.hoisted(() => vi.fn());
vi.mock("../../../services/open", () => ({
    default: { download, getUrlForDownload: (path: string) => `/${path}` }
}));
const copyReferenceWithToast = vi.hoisted(() => vi.fn());
vi.mock("../../../services/clipboard_ext", () => ({ copyReferenceWithToast }));
const rememberHeadingTitles = vi.hoisted(() => vi.fn());
vi.mock("../../../services/link", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../../services/link")>()),
    rememberHeadingTitles
}));

const { default: PdfPreview } = await import("./Pdf");

const NOTE = { noteId: "note-1", mime: "application/pdf", type: "file", title: "doc.pdf" } as unknown as FNote;

let container: HTMLDivElement;
let noteContext: NoteContext;
let contextData: Record<string, unknown>;

beforeEach(() => {
    readOnly.current = false;
    contextData = {};
    // The component reads the ToC route after every load of the viewer.
    vi.spyOn(server, "get").mockResolvedValue({ status: "none" });
    noteContext = {
        ntxId: "ntx-1",
        note: NOTE,
        notePath: "root/parent/note-1",
        viewScope: {},
        setContextData: vi.fn((key: string, value: unknown) => { contextData[key] = value; }),
        getContextData: vi.fn((key: string) => contextData[key]),
        isActive: () => true,
        isCommandTarget: (ntxId?: string | null) => (ntxId ? ntxId === noteContext.ntxId : noteContext.isActive())
    } as unknown as NoteContext;

    container = document.createElement("div");
    document.body.append(container);
    // Effects, which install the message listener, only run once Preact flushes them.
    act(() => render(<PdfPreview note={NOTE} noteContext={noteContext} blob={null} componentId="cmp" isVisible />, container));
});

afterEach(() => {
    act(() => render(null, container));
    container.remove();
    vi.clearAllMocks();
});

/** Records what the component posts into its iframe. */
function recordPostsToViewer() {
    const iframe = container.querySelector("iframe") as HTMLIFrameElement;
    return vi.spyOn(iframe.contentWindow as Window, "postMessage").mockImplementation(() => {});
}

/**
 * Gives `iframe` a window with the members the component uses: `postMessage`, `location.reload()`
 * and click listeners. The window is created once per element, so spies on it survive re-renders.
 */
function attachFrameWindow(iframe: HTMLIFrameElement) {
    if (!Object.hasOwn(iframe, "contentWindow")) {
        const frameWindow = Object.assign(new EventTarget(), {
            postMessage: () => {},
            location: { reload: () => {} }
        });
        Object.defineProperty(iframe, "contentWindow", { value: frameWindow });
    }
    return iframe;
}

/** Delivers a message the way the viewer iframe posts it to the parent window. */
function fromViewer(data: Record<string, unknown>) {
    window.dispatchEvent(new MessageEvent("message", { data }));
}

/** The same message, addressed to this viewer. */
function fromThisViewer(data: Record<string, unknown>) {
    fromViewer({ noteId: "note-1", ntxId: "ntx-1", ...data });
}

describe("PdfPreview", () => {
    it("acts only on messages addressed to its own viewer", () => {
        // Every open PDF posts to the same parent window; a message from another split or tab
        // must not write into this note context, or the sidebar shows one document's list while
        // navigating another.
        const annotations = [ { id: "5R", type: "highlight", pageNumber: 1 } ];
        fromViewer({ type: "pdfjs-viewer-annotations", annotations, noteId: "note-1", ntxId: "ntx-2" });
        fromViewer({ type: "pdfjs-viewer-annotations", annotations, noteId: "note-2", ntxId: "ntx-1" });
        fromViewer({ type: "pdfjs-viewer-annotations", annotations });
        expect(noteContext.setContextData).not.toHaveBeenCalled();

        fromThisViewer({ type: "pdfjs-viewer-annotations", annotations });
        expect(noteContext.setContextData).toHaveBeenCalledWith("pdfAnnotations", expect.objectContaining({ annotations }));
    });

    it("publishes each sidebar panel's data, with the callbacks that drive its own iframe", () => {
        const posted = recordPostsToViewer();

        fromThisViewer({ type: "pdfjs-viewer-toc", data: [
            { id: "outline-0", title: "Chapter <img src=x onerror=alert(1)>", level: 1 },
            { id: "outline-1", title: "Section & more", level: 2 }
        ] });
        // The titles of a PDF are plain text, and the table of contents renders HTML.
        expect(contextData.toc).toMatchObject({
            headings: [
                { id: "outline-0", text: "Chapter &lt;img src=x onerror=alert(1)&gt;", level: 1 },
                { id: "outline-1", text: "Section &amp; more", level: 2 }
            ],
            activeHeadingId: null
        });
        (contextData.toc as any).scrollToHeading({ id: "outline-1" });
        expect(posted).toHaveBeenLastCalledWith(
            { type: "trilium-scroll-to-heading", headingKey: "outline-1" }, window.location.origin);

        fromThisViewer({ type: "pdfjs-viewer-active-heading", headingId: "outline-1" });
        expect(contextData.toc).toMatchObject({ activeHeadingId: "outline-1" });

        fromThisViewer({ type: "pdfjs-viewer-page-info", totalPages: 12, currentPage: 3 });
        expect(contextData.pdfPages).toMatchObject({ totalPages: 12, currentPage: 3 });
        (contextData.pdfPages as any).scrollToPage(7);
        expect(posted).toHaveBeenLastCalledWith({ type: "trilium-scroll-to-page", pageNumber: 7 }, window.location.origin);
        (contextData.pdfPages as any).requestThumbnail(2);
        expect(posted).toHaveBeenLastCalledWith({ type: "trilium-request-thumbnail", pageNumber: 2 }, window.location.origin);

        fromThisViewer({ type: "pdfjs-viewer-current-page", currentPage: 5 });
        expect(contextData.pdfPages).toMatchObject({ totalPages: 12, currentPage: 5 });

        fromThisViewer({ type: "pdfjs-viewer-attachments", attachments: [ { id: "a1", filename: "notes.txt", size: 3 } ] });
        (contextData.pdfAttachments as any).downloadAttachment("a1");
        expect(posted).toHaveBeenLastCalledWith({ type: "trilium-download-attachment", id: "a1" }, window.location.origin);

        fromThisViewer({ type: "pdfjs-viewer-layers", layers: [ { id: "l1", name: "Layer", visible: true } ] });
        (contextData.pdfLayers as any).toggleLayer("l1", false);
        expect(posted).toHaveBeenLastCalledWith({ type: "trilium-toggle-layer", layerId: "l1", visible: false }, window.location.origin);

        fromThisViewer({ type: "pdfjs-viewer-annotations", annotations: [ { id: "5R", pageNumber: 2 } ] });
        (contextData.pdfAnnotations as any).scrollToAnnotation("5R", 2);
        expect(posted).toHaveBeenLastCalledWith({ type: "trilium-scroll-to-annotation", annotationId: "5R", pageNumber: 2 }, window.location.origin);
    });

    it("scrolls to the place a link names once the viewer lists its annotations, and only once", () => {
        const posted = recordPostsToViewer();
        noteContext.viewScope = { page: "5", annotation: "12R" };

        // A switch that arrives while the viewer is still loading has nothing to talk to yet.
        eventHandlers.get("noteSwitched")?.({ noteContext: { ntxId: "ntx-1", note: NOTE } });
        expect(posted).not.toHaveBeenCalled();

        fromThisViewer({ type: "pdfjs-viewer-annotations", annotations: [] });
        expect(posted).toHaveBeenCalledExactlyOnceWith(
            { type: "trilium-scroll-to-annotation", annotationId: "12R", pageNumber: 5 }, window.location.origin);
        expect(noteContext.viewScope).toEqual({ page: undefined, annotation: undefined, heading: undefined });

        // The list is sent again on every edit; the link is not followed again.
        fromThisViewer({ type: "pdfjs-viewer-annotations", annotations: [] });
        expect(posted).toHaveBeenCalledOnce();
    });

    it("follows a link to the PDF it already shows, but not one meant for another pane", () => {
        const posted = recordPostsToViewer();
        fromThisViewer({ type: "pdfjs-viewer-annotations", annotations: [] });

        noteContext.viewScope = { page: "3" };
        eventHandlers.get("noteSwitched")?.({ noteContext: { ntxId: "ntx-2", note: NOTE } });
        expect(posted).not.toHaveBeenCalled();

        eventHandlers.get("noteSwitched")?.({ noteContext: { ntxId: "ntx-1", note: NOTE } });
        expect(posted).toHaveBeenCalledExactlyOnceWith(
            { type: "trilium-scroll-to-annotation", annotationId: undefined, pageNumber: 3 }, window.location.origin);
    });

    it("scrolls to the heading a link names, with the page the viewer falls back to", () => {
        const posted = recordPostsToViewer();
        fromThisViewer({ type: "pdfjs-viewer-annotations", annotations: [] });

        noteContext.viewScope = { page: "12", heading: "0k3x9aa1h7q2mz" };
        eventHandlers.get("noteSwitched")?.({ noteContext: { ntxId: "ntx-1", note: NOTE } });
        expect(posted).toHaveBeenLastCalledWith({
            type: "trilium-scroll-to-heading", headingId: "0k3x9aa1h7q2mz", pageNumber: 12
        }, window.location.origin);
        expect(noteContext.viewScope).toEqual({ page: undefined, annotation: undefined, heading: undefined });

        // A heading without a page, as a hand-written link can have it.
        noteContext.viewScope = { heading: "0k3x9aa1h7q2mz", page: "x" };
        eventHandlers.get("noteSwitched")?.({ noteContext: { ntxId: "ntx-1", note: NOTE } });
        expect(posted).toHaveBeenLastCalledWith({
            type: "trilium-scroll-to-heading", headingId: "0k3x9aa1h7q2mz", pageNumber: undefined
        }, window.location.origin);

        // A page that is not one leads nowhere.
        noteContext.viewScope = { page: "0" };
        eventHandlers.get("noteSwitched")?.({ noteContext: { ntxId: "ntx-1", note: NOTE } });
        expect(posted).toHaveBeenCalledTimes(2);
    });

    it("publishes its data again when the pane returns to it, and follows a link from there", () => {
        // `NoteDetail` keeps the viewer mounted, hidden, while the pane shows another note, and
        // `NoteContext.setNote()` clears the context data. The viewer has loaded already, so it
        // does not send the outline or the annotations again.
        const posted = recordPostsToViewer();
        const annotations = [ { id: "5R", type: "highlight", pageNumber: 1 } ];
        fromThisViewer({ type: "pdfjs-viewer-toc", data: null });
        fromThisViewer({ type: "pdfjs-viewer-page-info", totalPages: 12, currentPage: 3 });
        fromThisViewer({ type: "pdfjs-viewer-annotations", annotations });

        function show(isVisible: boolean) {
            act(() => render(
                <PdfPreview note={NOTE} noteContext={noteContext} blob={null} componentId="cmp" isVisible={isVisible} />,
                container));
        }

        show(false);
        contextData = {};
        vi.mocked(noteContext.setContextData).mockClear();
        // A hidden viewer records the page change for the return and holds the link's jump until
        // it is shown.
        fromThisViewer({ type: "pdfjs-viewer-current-page", currentPage: 7 });
        noteContext.viewScope = { page: "4" };
        eventHandlers.get("noteSwitched")?.({ noteContext: { ntxId: "ntx-1", note: NOTE } });
        expect(noteContext.setContextData).not.toHaveBeenCalled();
        expect(posted).not.toHaveBeenCalled();

        show(true);
        expect(contextData).toMatchObject({
            toc: { headings: [] },
            pdfPages: { totalPages: 12, currentPage: 7 },
            pdfAnnotations: { annotations }
        });
        expect(posted).toHaveBeenCalledExactlyOnceWith(
            { type: "trilium-scroll-to-annotation", annotationId: undefined, pageNumber: 4 }, window.location.origin);
    });

    it("keeps one PDF's data out of the pane once it shows another PDF", () => {
        // `NoteDetailWrapper` hands the kept viewer `isVisible` at once and the next note's props
        // one render later, so the viewer is shown while it still holds the previous PDF.
        const posted = recordPostsToViewer();
        fromThisViewer({ type: "pdfjs-viewer-page-info", totalPages: 12, currentPage: 3 });
        fromThisViewer({ type: "pdfjs-viewer-annotations", annotations: [] });

        function show(note: FNote, isVisible: boolean) {
            act(() => render(
                <PdfPreview note={note} noteContext={noteContext} blob={null} componentId="cmp" isVisible={isVisible} />,
                container));
        }

        show(NOTE, false);
        const otherNote = { ...NOTE, noteId: "note-2" } as unknown as FNote;
        (noteContext as { note: FNote }).note = otherNote;
        noteContext.viewScope = { page: "4" };
        contextData = {};
        vi.mocked(noteContext.setContextData).mockClear();

        show(NOTE, true);
        fromThisViewer({ type: "pdfjs-viewer-current-page", currentPage: 5 });
        show(otherNote, true);
        expect(noteContext.setContextData).not.toHaveBeenCalled();
        expect(posted).not.toHaveBeenCalled();
    });

    it("copies a reference to a page, or to an annotation the document already holds", () => {
        fromThisViewer({ type: "pdfjs-viewer-page-info", totalPages: 12, currentPage: 1 });
        (contextData.pdfPages as any).copyReference(7);
        expect(copyReferenceWithToast).toHaveBeenLastCalledWith("#root/parent/note-1?page=7");

        fromThisViewer({ type: "pdfjs-viewer-annotations", annotations: [] });
        (contextData.pdfAnnotations as any).copyReference("12R", 5);
        expect(copyReferenceWithToast).toHaveBeenLastCalledWith("#root/parent/note-1?page=5&annotation=12R");

        // An annotation drawn in this session has only its editor's id, which the next load of
        // the document does not reuse, so its reference names the page alone.
        (contextData.pdfAnnotations as any).copyReference("pdfjs_internal_editor_0", 5);
        expect(copyReferenceWithToast).toHaveBeenLastCalledWith("#root/parent/note-1?page=5");
    });

    it("leaves a page-tracking update alone until the page info has arrived", () => {
        // A current-page message before page-info has nothing to update, and the active heading
        // likewise waits for the table of contents.
        fromThisViewer({ type: "pdfjs-viewer-current-page", currentPage: 5 });
        fromThisViewer({ type: "pdfjs-viewer-active-heading", headingId: "h1" });
        expect(noteContext.setContextData).not.toHaveBeenCalled();
    });

    it("clears the table of contents when the document has none", () => {
        fromThisViewer({ type: "pdfjs-viewer-toc", data: null });
        expect(contextData.toc).toMatchObject({ headings: [], activeHeadingId: null });
    });

    it("schedules a save when the viewer reports a change, unless the note is read-only", () => {
        fromThisViewer({ type: "pdfjs-viewer-document-modified" });
        expect(spacedUpdate.resetUpdateTimer).toHaveBeenCalledOnce();
        expect(spacedUpdate.scheduleUpdate).toHaveBeenCalledOnce();

        vi.clearAllMocks();
        readOnly.current = true;
        act(() => render(<PdfPreview note={NOTE} noteContext={noteContext} blob={null} componentId="cmp" isVisible />, container));
        fromThisViewer({ type: "pdfjs-viewer-document-modified" });
        expect(spacedUpdate.scheduleUpdate).not.toHaveBeenCalled();
    });

    it("relays a thumbnail on the window, marked with the context it was rendered for", () => {
        // Thumbnails arrive one at a time and go out as a window event the page list keys itself;
        // a second viewer relays onto the same window, so each carries its own context.
        const relayed: CustomEvent[] = [];
        const listener = (event: Event) => relayed.push(event as CustomEvent);
        window.addEventListener("pdf-thumbnail", listener);

        fromThisViewer({ type: "pdfjs-viewer-thumbnail", pageNumber: 4, dataUrl: "data:image/png;base64,AAAA" });
        window.removeEventListener("pdf-thumbnail", listener);

        expect(relayed).toHaveLength(1);
        expect(relayed[0].detail).toEqual({ ntxId: "ntx-1", pageNumber: 4, dataUrl: "data:image/png;base64,AAAA" });
    });

    it("fetches the document bytes from the viewer when a save needs them", async () => {
        const posted = recordPostsToViewer();

        // The spaced update asks for the current bytes; the component asks the viewer, which
        // answers with a message addressed back to it. Answers meant for another viewer, or of
        // another kind, are not it.
        const pending = saveOptions.current?.getData() as Promise<Blob>;
        expect(posted).toHaveBeenCalledWith({ type: "trilium-request-blob" }, window.location.origin);
        fromViewer({ type: "pdfjs-viewer-blob", data: new Uint8Array([ 9 ]), noteId: "note-1", ntxId: "ntx-2" });
        fromThisViewer({ type: "pdfjs-viewer-annotations", annotations: [] });
        fromThisViewer({ type: "pdfjs-viewer-blob", data: new Uint8Array([ 37, 80, 68, 70 ]) });

        const blob = await pending;
        expect(blob.type).toBe("application/pdf");
        expect(blob.size).toBe(4);
    });

    it("gives up on a save whose bytes never come, and reloads the viewer on outside changes", async () => {
        recordPostsToViewer();
        vi.useFakeTimers();
        const pending = saveOptions.current?.getData() as Promise<Blob>;
        const rejected = expect(pending).rejects.toThrow("Timeout");
        await vi.advanceTimersByTimeAsync(10_000);
        await rejected;
        vi.useRealTimers();

        // When the note's content changes under it — another client saved — the viewer is
        // reloaded so it shows that document rather than a stale one.
        const iframe = container.querySelector("iframe") as HTMLIFrameElement;
        const frameWindow = iframe.contentWindow as Window;
        const reload = vi.spyOn(frameWindow.location, "reload").mockImplementation(() => {});
        saveOptions.current?.onContentChange({});
        expect(reload).toHaveBeenCalledOnce();

        // With the viewer gone — the note switched away mid-save — there is nothing to ask and
        // nothing to reload; a save in flight simply has no data.
        const options = saveOptions.current;
        act(() => render(null, container));
        expect(options?.getData()).toBeUndefined();
        expect(() => options?.onContentChange({})).not.toThrow();
    });

    it("flushes pending edits before a download, and only for its own context", async () => {
        await eventHandlers.get("customDownload")?.({ ntxId: "ntx-2" });
        expect(spacedUpdate.updateNowIfNecessary).not.toHaveBeenCalled();

        await eventHandlers.get("customDownload")?.({ ntxId: "ntx-1" });
        expect(spacedUpdate.updateNowIfNecessary).toHaveBeenCalledOnce();
        expect(download).toHaveBeenCalledWith(expect.stringMatching(/^\/api\/notes\/note-1\/download\?\d+$/));
    });

    it("forwards print and find to the viewer while it is the active note", () => {
        const posted = recordPostsToViewer();

        eventHandlers.get("printActiveNote")?.({});
        eventHandlers.get("findInText")?.({});
        expect(posted.mock.calls.map(([ message ]) => message)).toEqual([ { type: "trilium-print" }, { type: "trilium-find" } ]);

        // An inactive split must not print or open the find bar for a shortcut meant elsewhere.
        (noteContext as any).isActive = () => false;
        eventHandlers.get("printActiveNote")?.({});
        eventHandlers.get("findInText")?.({});
        expect(posted).toHaveBeenCalledTimes(2);
    });

    it("hands the viewer its identity in the URL and its stores on load, and claims focus on a click inside", () => {
        vi.spyOn(options, "getJson").mockReturnValue({ sig: 1 });
        const iframe = container.querySelector("iframe") as HTMLIFrameElement;
        // The viewer can post before `load`, so the address it stamps on messages goes in the URL.
        expect(iframe.dataset).toMatchObject({ noteId: "note-1", ntxId: "ntx-1" });
        iframe.dispatchEvent(new Event("load"));

        const win = iframe.contentWindow as Window;
        expect(win.TRILIUM_VIEW_HISTORY_STORE).toEqual({ files: [] });
        expect(win.TRILIUM_SIGNATURES).toEqual({ sig: 1 });

        // Clicking inside the frame does not bubble to Trilium's own focus handling, so the
        // component activates its note context itself.
        win.dispatchEvent(new Event("click"));
        expect(activateNoteContext).toHaveBeenCalledWith("ntx-1");
    });

    it("stores the view history and the signature library the viewer hands back", () => {
        const save = vi.spyOn(options, "save").mockResolvedValue(undefined as never);

        fromThisViewer({ type: "pdfjs-viewer-save-view-history", data: JSON.stringify({ files: [ { fingerprint: "f", page: 2 } ] }) });
        expect(historyStore).toHaveBeenCalledWith({ files: [ { fingerprint: "f", page: 2 } ] });

        fromThisViewer({ type: "pdfjs-viewer-save-signatures", data: "{\"sig\":1}" });
        expect(save).toHaveBeenCalledWith("pdfSignatures", "{\"sig\":1}");
    });
});

describe("the build of the table of contents", () => {
    const PENDING = { status: "missing", pendingToc: { format: "pdf" } };
    const HEADINGS = [ { title: "Chapter 1", level: 1, page: 1 } ];

    let get: ReturnType<typeof vi.spyOn>;
    let put: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        get = vi.spyOn(server, "get").mockResolvedValue(PENDING);
        put = vi.spyOn(server, "put").mockImplementation(async (_url, body: any) => ({
            status: "ready", blobId: body.targetBlobHash,
            headings: [ { id: "id1", title: "Chapter 1", level: 1, page: 1 } ]
        }));
    });

    function loadViewer() {
        (container.querySelector("iframe") as HTMLIFrameElement).dispatchEvent(new Event("load"));
    }

    /** The build requests the component posted to the viewer, oldest first. */
    function buildRequests(posted: ReturnType<typeof recordPostsToViewer>) {
        return posted.mock.calls.map(([ message ]) => message as any)
            .filter((message) => message.type === "trilium-build-toc");
    }

    function answer(requestId: number, blobId = "blobA") {
        fromThisViewer({
            type: "pdfjs-viewer-toc-build", requestId, blobId, headings: HEADINGS,
            properties: { reader: 1 }, elapsedMs: 12
        });
    }

    /** The bytes of a save, as the viewer sends them. */
    async function saveBytes(bytes: number[]) {
        const pending = saveOptions.current?.getData() as Promise<Blob>;
        fromThisViewer({ type: "pdfjs-viewer-blob", data: new Uint8Array(bytes) });
        return await pending;
    }

    it("asks the viewer to build after a load where the server cannot read the PDF, and saves its answer", async () => {
        const posted = recordPostsToViewer();

        loadViewer();

        await vi.waitFor(() => expect(buildRequests(posted)).toHaveLength(1));
        expect(get).toHaveBeenCalledWith("notes/note-1/toc", undefined, false,
            { silentBadRequest: true, silentNotFound: true });
        expect(buildRequests(posted)[0]).toEqual({
            type: "trilium-build-toc", requestId: 1, isProtected: false, data: undefined
        });

        answer(1);
        await vi.waitFor(() => expect(put).toHaveBeenCalledOnce());
        expect(put).toHaveBeenCalledWith("notes/note-1/toc", {
            targetBlobHash: "blobA", headings: HEADINGS, properties: { reader: 1 }, elapsedMs: 12
        }, undefined, { silentConflict: true });

        // An answer comes once; a second one saves nothing.
        answer(1);
        await settle();
        expect(put).toHaveBeenCalledOnce();
    });

    it("remembers the heading titles of a ready cache, and none of a stale one", async () => {
        const posted = recordPostsToViewer();
        loadViewer();
        await vi.waitFor(() => expect(buildRequests(posted)).toHaveLength(1));
        answer(1);
        await vi.waitFor(() => expect(rememberHeadingTitles).toHaveBeenCalledOnce());
        expect(rememberHeadingTitles).toHaveBeenCalledWith("notes/note-1/toc", "blobA",
            [ { id: "id1", title: "Chapter 1", level: 1, page: 1 } ]);

        put.mockResolvedValueOnce({ status: "stale", blobId: "blobOld", headings: [] });
        loadViewer();
        await vi.waitFor(() => expect(buildRequests(posted)).toHaveLength(2));
        answer(2, "blobB");
        await vi.waitFor(() => expect(put).toHaveBeenCalledTimes(2));
        await settle();
        expect(rememberHeadingTitles).toHaveBeenCalledOnce();
    });

    it("asks nothing where the cache is valid, or where the server reads the PDF itself", async () => {
        const posted = recordPostsToViewer();
        get.mockResolvedValueOnce({ status: "ready", blobId: "blobA", headings: [] })
            .mockResolvedValueOnce({ status: "missing" })
            .mockRejectedValueOnce(new Error("Protected"));

        loadViewer();
        loadViewer();
        loadViewer();
        await settle();

        expect(get).toHaveBeenCalledTimes(3);
        expect(buildRequests(posted)).toHaveLength(0);
    });

    it("builds the PDF a reload brings, and drops the late answer for the one before", async () => {
        const posted = recordPostsToViewer();
        loadViewer();
        await vi.waitFor(() => expect(buildRequests(posted)).toHaveLength(1));

        // The file was replaced and the viewer reloaded before it answered.
        loadViewer();
        await vi.waitFor(() => expect(buildRequests(posted)).toHaveLength(2));
        answer(1, "blobA");
        answer(2, "blobB");

        await vi.waitFor(() => expect(put).toHaveBeenCalledOnce());
        expect(put.mock.calls[0][1]).toMatchObject({ targetBlobHash: "blobB" });
    });

    it("builds the bytes of the last of several saves, which go to the viewer with the request", async () => {
        const posted = recordPostsToViewer();
        loadViewer();
        await vi.waitFor(() => expect(buildRequests(posted)).toHaveLength(1));

        const first = await saveBytes([ 1 ]);
        const second = await saveBytes([ 2 ]);
        saveOptions.current?.dataSaved(first);
        saveOptions.current?.dataSaved(second);
        await vi.waitFor(() => expect(get).toHaveBeenCalledTimes(3));
        await settle();
        // The check of the first save is dropped: a newer request exists when its answer comes.
        const [ , secondSave ] = buildRequests(posted);
        expect(buildRequests(posted)).toHaveLength(2);
        expect(secondSave.requestId).toBe(3);
        expect([ ...secondSave.data ]).toEqual([ 2 ]);
        // The bytes are handed over, not copied.
        expect((posted.mock.calls.at(-1) as unknown[] | undefined)?.[2]).toEqual([ secondSave.data.buffer ]);

        answer(1, "loaded");
        answer(3, "second");
        await vi.waitFor(() => expect(put).toHaveBeenCalledOnce());
        expect(put.mock.calls[0][1]).toMatchObject({ targetBlobHash: "second" });
    });

    it("starts nothing for a save that completes after the viewer loaded another document", async () => {
        const posted = recordPostsToViewer();
        get.mockResolvedValueOnce({ status: "ready", blobId: "old", headings: [] });
        loadViewer();
        const saved = await saveBytes([ 1 ]);

        loadViewer();
        await vi.waitFor(() => expect(buildRequests(posted)).toHaveLength(1));
        saveOptions.current?.dataSaved(saved);
        answer(2, "replacement");

        await vi.waitFor(() => expect(put).toHaveBeenCalledOnce());
        expect(put.mock.calls[0][1]).toMatchObject({ targetBlobHash: "replacement" });
        expect(get).toHaveBeenCalledTimes(2);
    });

    it("saves nothing for a failed build, nor for an answer after its time ran out", async () => {
        const posted = recordPostsToViewer();
        loadViewer();
        await vi.waitFor(() => expect(buildRequests(posted)).toHaveLength(1));
        fromThisViewer({ type: "pdfjs-viewer-toc-build", requestId: 1, failed: true });
        await settle();
        expect(put).not.toHaveBeenCalled();

        vi.useFakeTimers();
        try {
            loadViewer();
            await vi.waitFor(() => expect(buildRequests(posted)).toHaveLength(2));
            await vi.advanceTimersByTimeAsync(60_000);
            answer(2);
            await vi.advanceTimersByTimeAsync(10);
            expect(put).not.toHaveBeenCalled();
        } finally {
            vi.useRealTimers();
        }

        // A request whose answer never came does not hold back the next.
        loadViewer();
        await vi.waitFor(() => expect(buildRequests(posted)).toHaveLength(3));
        answer(3);
        await vi.waitFor(() => expect(put).toHaveBeenCalledOnce());
    });

    it("does not retry a table of contents that the server refuses", async () => {
        const posted = recordPostsToViewer();
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        put.mockRejectedValue(new Error("409"));
        loadViewer();
        await vi.waitFor(() => expect(buildRequests(posted)).toHaveLength(1));

        answer(1);

        await vi.waitFor(() => expect(warn).toHaveBeenCalledOnce());
        expect(put).toHaveBeenCalledOnce();
        expect(buildRequests(posted)).toHaveLength(1);
    });
});

/** Lets the requests in flight finish. */
function settle() {
    return new Promise((resolve) => setTimeout(resolve, 20));
}
