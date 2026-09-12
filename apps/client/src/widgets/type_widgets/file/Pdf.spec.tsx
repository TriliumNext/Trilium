import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type NoteContext from "../../../components/note_context";
import FNote from "../../../entities/fnote";
import options from "../../../services/options";

// The component's own job is the message protocol with the viewer iframe: what it publishes into
// the note context and what it relays. The hooks around it — the spaced-update save, the
// read-only decision, the view-mode config — need the whole app to construct, so they are stood
// in for here; the specs of those hooks cover them.
const spacedUpdate = vi.hoisted(() => ({ resetUpdateTimer: vi.fn(), scheduleUpdate: vi.fn(), updateNowIfNecessary: vi.fn() }));
const readOnly = vi.hoisted(() => ({ current: false }));
const historyStore = vi.hoisted(() => vi.fn());
/** What the component last handed the save hook: its data getter and content-change reaction. */
const saveOptions = vi.hoisted(() => ({ current: null as null | { getData(): unknown; onContentChange(blob: unknown): void } }));
/** The Trilium event handlers the component registered, by event name. */
const eventHandlers = vi.hoisted(() => new Map<string, (data: any) => unknown>());
vi.mock("../../react/hooks", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../react/hooks")>()),
    useBlobEditorSpacedUpdate: (options: any) => {
        saveOptions.current = options;
        return spacedUpdate;
    },
    useEffectiveReadOnly: () => readOnly.current,
    useTriliumEvent: (name: string, handler: (data: any) => unknown) => {
        eventHandlers.set(name, handler);
    }
}));
vi.mock("../../collections/NoteList", () => ({
    useViewModeConfig: () => ({ config: { files: [] }, storeFn: historyStore })
}));
// The viewer iframe itself is a separate component with its own spec; here it only has to hand
// back a frame the messages can be addressed to, and report it loaded.
vi.mock("./PdfViewer", () => ({
    default: ({ iframeRef, onLoad }: { iframeRef: { current: HTMLIFrameElement | null }; onLoad: () => void }) =>
        <iframe ref={iframeRef} class="pdf-preview" onLoad={onLoad} />,
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

const { default: PdfPreview } = await import("./Pdf");

const NOTE = { noteId: "note-1", mime: "application/pdf", type: "file", title: "doc.pdf" } as unknown as FNote;

let container: HTMLDivElement;
let noteContext: NoteContext;
let contextData: Record<string, unknown>;

beforeEach(() => {
    readOnly.current = false;
    contextData = {};
    noteContext = {
        ntxId: "ntx-1",
        setContextData: vi.fn((key: string, value: unknown) => { contextData[key] = value; }),
        getContextData: vi.fn((key: string) => contextData[key]),
        isActive: () => true
    } as unknown as NoteContext;

    container = document.createElement("div");
    document.body.append(container);
    // Effects, which install the message listener, only run once Preact flushes them.
    act(() => render(<PdfPreview note={NOTE} noteContext={noteContext} blob={null} componentId="cmp" />, container));
});

afterEach(() => {
    act(() => render(null, container));
    container.remove();
    vi.clearAllMocks();
});

/**
 * Records what the component posts into its iframe. Recorded rather than delivered: the blank
 * frame has no origin the real call would accept.
 */
function recordPostsToViewer() {
    const iframe = container.querySelector("iframe") as HTMLIFrameElement;
    return vi.spyOn(iframe.contentWindow as Window, "postMessage").mockImplementation(() => {});
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
            { title: "Chapter", level: 0, id: "h1", dest: null, items: [ { title: "Section", level: 1, id: "h2", dest: null, items: [] } ] }
        ] });
        // The outline is flattened into the heading list the table of contents renders, levels
        // starting at 1 as headings do.
        expect(contextData.toc).toMatchObject({
            headings: [ { id: "h1", text: "Chapter", level: 1 }, { id: "h2", text: "Section", level: 2 } ],
            activeHeadingId: null
        });
        (contextData.toc as any).scrollToHeading({ id: "h2" });
        expect(posted).toHaveBeenLastCalledWith({ type: "trilium-scroll-to-heading", headingId: "h2" }, window.location.origin);

        fromThisViewer({ type: "pdfjs-viewer-active-heading", headingId: "h2" });
        expect(contextData.toc).toMatchObject({ activeHeadingId: "h2" });

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
        act(() => render(<PdfPreview note={NOTE} noteContext={noteContext} blob={null} componentId="cmp" />, container));
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

    it("hands the viewer its identity and stores on load, and claims focus on a click inside", () => {
        vi.spyOn(options, "getJson").mockReturnValue({ sig: 1 });
        const iframe = container.querySelector("iframe") as HTMLIFrameElement;
        iframe.dispatchEvent(new Event("load"));

        const win = iframe.contentWindow as Window;
        expect(win.TRILIUM_NOTE_ID).toBe("note-1");
        expect(win.TRILIUM_NTX_ID).toBe("ntx-1");
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
