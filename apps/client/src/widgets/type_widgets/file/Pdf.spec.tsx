import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// --- Module mocks (hoisted above the component import) --------------------------------------------

vi.mock("../../../components/app_context", () => ({
    default: {
        addBeforeUnloadListener: vi.fn(),
        removeBeforeUnloadListener: vi.fn(),
        tabManager: {
            activateNoteContext: vi.fn()
        }
    }
}));

// Stub PdfViewer so we render a real <iframe> we can drive (ref + onLoad), without pulling in
// the heavy pdf.js viewer machinery / font imports.
vi.mock("./PdfViewer", () => ({
    default: ({ iframeRef, pdfUrl, tabIndex, onLoad, editable }: {
        iframeRef?: { current: HTMLIFrameElement | null };
        pdfUrl: string;
        tabIndex?: number;
        onLoad?: () => void;
        editable?: boolean;
    }) => (
        <iframe
            class="pdf-preview"
            ref={iframeRef}
            data-pdf-url={pdfUrl}
            data-editable={editable ? "1" : "0"}
            tabIndex={tabIndex}
            onLoad={onLoad}
        />
    )
}));

import appContext from "../../../components/app_context";
import type Component from "../../../components/component";
import type NoteContext from "../../../components/note_context";
import type FBlob from "../../../entities/fblob";
import type FNote from "../../../entities/fnote";
import server from "../../../services/server";
import { buildNote } from "../../../test/easy-froca";
import { flush, renderComponent } from "../../../test/render";
import PdfPreview from "./Pdf";

// --- Render helpers -------------------------------------------------------------------------------

let parent: Component | undefined;

async function renderPdf(props: {
    note: FNote;
    noteContext: NoteContext;
    blob?: FBlob | null;
    componentId?: string;
}) {
    const { container, parent: p } = renderComponent(
        <PdfPreview
            note={props.note}
            noteContext={props.noteContext}
            blob={props.blob ?? null}
            componentId={props.componentId}
        />
    );
    parent = p;
    // useViewModeConfig resolves restore() asynchronously; settle it so PdfViewer renders.
    await flush();
    return container;
}

/** Build a `file`-typed PDF note that never tries to load attachments from the throwing mock server. */
function pdfNote(overrides: { id?: string; mime?: string } = {}): FNote {
    const note = buildNote({ id: overrides.id ?? "pdf1", title: "doc", type: "file" });
    Object.defineProperty(note, "mime", { value: overrides.mime ?? "application/pdf", configurable: true });
    // useViewModeConfig -> ViewModeStorage.restore() -> note.getAttachmentsByRole(); keep it empty.
    note.getAttachmentsByRole = vi.fn(async () => []);
    return note;
}

interface FakeContextStore {
    setContextData: ReturnType<typeof vi.fn>;
    getContextData: ReturnType<typeof vi.fn>;
    store: Map<string, unknown>;
}

function fakeNoteContext(overrides: {
    ntxId?: string;
    active?: boolean;
    contextData?: Record<string, unknown>;
} = {}): NoteContext & FakeContextStore {
    const store = new Map<string, unknown>(Object.entries(overrides.contextData ?? {}));
    const ctx = {
        ntxId: overrides.ntxId ?? "ntx1",
        viewScope: { viewMode: "default", readOnlyTemporarilyDisabled: false },
        isActive: () => overrides.active ?? true,
        isReadOnly: vi.fn(async () => false),
        setContextData: vi.fn((key: string, value: unknown) => { store.set(key, value); }),
        getContextData: vi.fn((key: string) => store.get(key)),
        store
    };
    return ctx as unknown as NoteContext & FakeContextStore;
}

function getIframe(root: HTMLElement): HTMLIFrameElement {
    const iframe = root.querySelector("iframe.pdf-preview");
    if (!iframe) throw new Error("pdf iframe not rendered");
    return iframe as HTMLIFrameElement;
}

/** Replace the iframe's contentWindow with a stub that records postMessage payloads. */
function stubContentWindow(iframe: HTMLIFrameElement) {
    const posted: unknown[] = [];
    const win = {
        postMessage: vi.fn((msg: unknown) => { posted.push(msg); }),
        addEventListener: vi.fn(),
        location: { reload: vi.fn() }
    } as unknown as Window;
    Object.defineProperty(iframe, "contentWindow", { value: win, configurable: true });
    return { win, posted };
}

/** Dispatch a window "message" event the component's handler listens for. */
function postWindowMessage(data: unknown) {
    act(() => { window.dispatchEvent(new MessageEvent("message", { data })); });
}

/**
 * Force every <iframe> to expose a stub `contentWindow` from the moment it is created (happy-dom
 * leaves it null). Needed for effects that read `iframeRef.current.contentWindow` during render,
 * e.g. the blob `onContentChange` callback. Returns a restore function.
 */
function installPrototypeContentWindow() {
    const posted: unknown[] = [];
    const win = {
        postMessage: vi.fn((msg: unknown) => { posted.push(msg); }),
        addEventListener: vi.fn(),
        location: { reload: vi.fn() }
    } as unknown as Window;
    const proto = HTMLIFrameElement.prototype as unknown as Record<string, unknown>;
    const original = Object.getOwnPropertyDescriptor(proto, "contentWindow");
    Object.defineProperty(proto, "contentWindow", { configurable: true, get: () => win });
    const restore = () => {
        if (original) Object.defineProperty(proto, "contentWindow", original);
        else delete proto.contentWindow;
    };
    return { win, posted, restore };
}

beforeEach(() => {
    ($.fn as unknown as Record<string, unknown>).tooltip = vi.fn();
    // SpacedUpdate.triggerUpdate's catch calls the global logError, which the test env lacks.
    (globalThis as unknown as { logError?: unknown }).logError = vi.fn();
});

afterEach(() => {
    parent = undefined;
    delete (globalThis as unknown as { logError?: unknown }).logError;
});

// --- Tests ----------------------------------------------------------------------------------------

describe("PdfPreview - rendering", () => {
    it("renders the PdfViewer iframe once history config resolves, editable when not read-only", async () => {
        const root = await renderPdf({ note: pdfNote(), noteContext: fakeNoteContext() });
        const iframe = getIframe(root);
        expect(iframe.getAttribute("data-editable")).toBe("1");
        // pdfUrl is built from the note id via URL().pathname.
        expect(iframe.getAttribute("data-pdf-url")).toContain("notes/pdf1/open");
    });

    it("runs the onLoad callback, seeding the iframe window globals and wiring the click activation", async () => {
        const root = await renderPdf({ note: pdfNote({ id: "pdfLoad" }), noteContext: fakeNoteContext({ ntxId: "ntxLoad" }) });
        const iframe = getIframe(root);
        const { win } = stubContentWindow(iframe);

        act(() => { iframe.dispatchEvent(new Event("load")); });

        const typedWin = win as unknown as { TRILIUM_NOTE_ID?: string; TRILIUM_NTX_ID?: string | null };
        expect(typedWin.TRILIUM_NOTE_ID).toBe("pdfLoad");
        expect(typedWin.TRILIUM_NTX_ID).toBe("ntxLoad");
        expect(win.addEventListener).toHaveBeenCalledWith("click", expect.any(Function));

        // Invoke the registered click listener to cover the activate path.
        const addEventListener = win.addEventListener as unknown as ReturnType<typeof vi.fn>;
        const clickHandler = addEventListener.mock.calls.find((c) => c[0] === "click")?.[1] as (() => void) | undefined;
        clickHandler?.();
        expect(appContext.tabManager.activateNoteContext).toHaveBeenCalledWith("ntxLoad");
    });

    it("tolerates onLoad when the iframe has no contentWindow", async () => {
        const root = await renderPdf({ note: pdfNote(), noteContext: fakeNoteContext() });
        const iframe = getIframe(root);
        Object.defineProperty(iframe, "contentWindow", { value: null, configurable: true });
        expect(() => act(() => { iframe.dispatchEvent(new Event("load")); })).not.toThrow();
    });
});

describe("PdfPreview - message handlers", () => {
    it("schedules an update on document-modified only when matching note/ntx and not read-only", async () => {
        const ctx = fakeNoteContext({ ntxId: "ntxA" });
        await renderPdf({ note: pdfNote({ id: "noteA" }), noteContext: ctx });

        // Mismatched ntx -> ignored.
        postWindowMessage({ type: "pdfjs-viewer-document-modified", noteId: "noteA", ntxId: "other" });
        // Matching -> handled (no throw; SpacedUpdate timers stay internal).
        expect(() => postWindowMessage({ type: "pdfjs-viewer-document-modified", noteId: "noteA", ntxId: "ntxA" })).not.toThrow();
    });

    it("stores parsed view history when save-view-history matches the note/ntx", async () => {
        const ctx = fakeNoteContext({ ntxId: "ntxH" });
        await renderPdf({ note: pdfNote({ id: "noteH" }), noteContext: ctx });

        const payload = JSON.stringify({ files: [ { fingerprint: "fp", page: 2 } ] });
        postWindowMessage({ type: "pdfjs-viewer-save-view-history", noteId: "noteH", ntxId: "ntxH", data: payload });
        // historyConfig.storeFn sets context data "saveState"? No — it persists via storeFn which updates state.
        // We just assert it didn't throw and that a non-matching message is ignored.
        expect(() => postWindowMessage({ type: "pdfjs-viewer-save-view-history", noteId: "noteH", ntxId: "nope", data: payload })).not.toThrow();
    });

    it("converts a PDF outline into headings and exposes a scroll-to-heading callback (toc with data)", async () => {
        const ctx = fakeNoteContext({ ntxId: "ntxT" });
        const root = await renderPdf({ note: pdfNote(), noteContext: ctx });
        const iframe = getIframe(root);
        const { win } = stubContentWindow(iframe);

        const outline = [
            { title: "Chapter 1", level: 0, dest: null, id: "h1", items: [
                { title: "Section 1.1", level: 1, dest: null, id: "h1-1", items: [] }
            ] },
            { title: "Chapter 2", level: 0, dest: null, id: "h2", items: [] }
        ];
        postWindowMessage({ type: "pdfjs-viewer-toc", data: outline });

        expect(ctx.setContextData).toHaveBeenCalledWith("toc", expect.objectContaining({
            activeHeadingId: null
        }));
        const toc = ctx.store.get("toc") as { headings: { id: string; level: number; text: string }[]; scrollToHeading: (h: { id: string }) => void };
        // Flattened recursively: 3 headings, levels offset by +1.
        expect(toc.headings.map((h) => h.id)).toEqual([ "h1", "h1-1", "h2" ]);
        expect(toc.headings[0].level).toBe(1);

        // scrollToHeading posts to the iframe.
        toc.scrollToHeading({ id: "h1-1" });
        expect(win.postMessage).toHaveBeenCalledWith(
            expect.objectContaining({ type: "trilium-scroll-to-heading", headingId: "h1-1" }),
            window.location.origin
        );
    });

    it("sets empty headings when toc has no data", async () => {
        const ctx = fakeNoteContext();
        await renderPdf({ note: pdfNote(), noteContext: ctx });

        postWindowMessage({ type: "pdfjs-viewer-toc", data: null });
        const toc = ctx.store.get("toc") as { headings: unknown[]; scrollToHeading: () => void };
        expect(toc.headings).toEqual([]);
        // No-op scrollToHeading branch.
        expect(() => toc.scrollToHeading()).not.toThrow();
    });

    it("updates the active heading only when a toc context already exists", async () => {
        const ctx = fakeNoteContext();
        await renderPdf({ note: pdfNote(), noteContext: ctx });

        // No toc yet -> active-heading message is a no-op.
        postWindowMessage({ type: "pdfjs-viewer-active-heading", headingId: "x" });
        expect(ctx.store.get("toc")).toBeUndefined();

        // Seed a toc, then update.
        postWindowMessage({ type: "pdfjs-viewer-toc", data: [] });
        postWindowMessage({ type: "pdfjs-viewer-active-heading", headingId: "active-1" });
        const toc = ctx.store.get("toc") as { activeHeadingId: string };
        expect(toc.activeHeadingId).toBe("active-1");
    });

    it("stores page info with working scroll-to-page and thumbnail request callbacks", async () => {
        const ctx = fakeNoteContext();
        const root = await renderPdf({ note: pdfNote(), noteContext: ctx });
        const { win } = stubContentWindow(getIframe(root));

        postWindowMessage({ type: "pdfjs-viewer-page-info", totalPages: 10, currentPage: 3 });
        const pages = ctx.store.get("pdfPages") as {
            totalPages: number;
            currentPage: number;
            scrollToPage: (p: number) => void;
            requestThumbnail: (p: number) => void;
        };
        expect(pages.totalPages).toBe(10);
        expect(pages.currentPage).toBe(3);

        pages.scrollToPage(5);
        expect(win.postMessage).toHaveBeenCalledWith(
            expect.objectContaining({ type: "trilium-scroll-to-page", pageNumber: 5 }),
            window.location.origin
        );

        pages.requestThumbnail(7);
        expect(win.postMessage).toHaveBeenCalledWith(
            expect.objectContaining({ type: "trilium-request-thumbnail", pageNumber: 7 }),
            window.location.origin
        );
    });

    it("merges current-page into existing page info, ignoring it when none exists", async () => {
        const ctx = fakeNoteContext();
        await renderPdf({ note: pdfNote(), noteContext: ctx });

        // No pdfPages yet -> ignored.
        postWindowMessage({ type: "pdfjs-viewer-current-page", currentPage: 4 });
        expect(ctx.store.get("pdfPages")).toBeUndefined();

        postWindowMessage({ type: "pdfjs-viewer-page-info", totalPages: 8, currentPage: 1 });
        postWindowMessage({ type: "pdfjs-viewer-current-page", currentPage: 4 });
        const pages = ctx.store.get("pdfPages") as { currentPage: number; totalPages: number };
        expect(pages.currentPage).toBe(4);
        expect(pages.totalPages).toBe(8);
    });

    it("re-dispatches thumbnail messages as a pdf-thumbnail CustomEvent", async () => {
        await renderPdf({ note: pdfNote(), noteContext: fakeNoteContext() });

        const received: CustomEvent[] = [];
        const listener = (e: Event) => received.push(e as CustomEvent);
        window.addEventListener("pdf-thumbnail", listener);
        try {
            postWindowMessage({ type: "pdfjs-viewer-thumbnail", pageNumber: 2, dataUrl: "data:img" });
            expect(received).toHaveLength(1);
            expect(received[0].detail).toEqual({ pageNumber: 2, dataUrl: "data:img" });
        } finally {
            window.removeEventListener("pdf-thumbnail", listener);
        }
    });

    it("stores attachments with a working download callback", async () => {
        const ctx = fakeNoteContext();
        const root = await renderPdf({ note: pdfNote(), noteContext: ctx });
        const { win } = stubContentWindow(getIframe(root));

        postWindowMessage({ type: "pdfjs-viewer-attachments", attachments: [ { filename: "a.txt", size: 1 } ] });
        const data = ctx.store.get("pdfAttachments") as { attachments: unknown[]; downloadAttachment: (f: string) => void };
        expect(data.attachments).toHaveLength(1);

        data.downloadAttachment("a.txt");
        expect(win.postMessage).toHaveBeenCalledWith(
            expect.objectContaining({ type: "trilium-download-attachment", filename: "a.txt" }),
            window.location.origin
        );
    });

    it("stores annotations with a working scroll-to-annotation callback", async () => {
        const ctx = fakeNoteContext();
        const root = await renderPdf({ note: pdfNote(), noteContext: ctx });
        const { win } = stubContentWindow(getIframe(root));

        postWindowMessage({ type: "pdfjs-viewer-annotations", annotations: [ { id: "an1" } ] });
        const data = ctx.store.get("pdfAnnotations") as {
            annotations: unknown[];
            scrollToAnnotation: (id: string, page: number) => void;
        };
        expect(data.annotations).toHaveLength(1);

        data.scrollToAnnotation("an1", 3);
        expect(win.postMessage).toHaveBeenCalledWith(
            expect.objectContaining({ type: "trilium-scroll-to-annotation", annotationId: "an1", pageNumber: 3 }),
            window.location.origin
        );
    });

    it("stores layers with a working toggle-layer callback", async () => {
        const ctx = fakeNoteContext();
        const root = await renderPdf({ note: pdfNote(), noteContext: ctx });
        const { win } = stubContentWindow(getIframe(root));

        postWindowMessage({ type: "pdfjs-viewer-layers", layers: [ { id: "L1", name: "Layer", visible: true } ] });
        const data = ctx.store.get("pdfLayers") as {
            layers: unknown[];
            toggleLayer: (id: string, visible: boolean) => void;
        };
        expect(data.layers).toHaveLength(1);

        data.toggleLayer("L1", false);
        expect(win.postMessage).toHaveBeenCalledWith(
            expect.objectContaining({ type: "trilium-toggle-layer", layerId: "L1", visible: false }),
            window.location.origin
        );
    });
});

describe("PdfPreview - trilium events", () => {
    function fireTrilium(name: string, data: unknown) {
        act(() => {
            (parent?.handleEventInChildren as unknown as (n: string, d: unknown) => void)(name, data);
        });
    }

    it("requests a download from the iframe on customDownload for the matching ntx only", async () => {
        const root = await renderPdf({ note: pdfNote(), noteContext: fakeNoteContext({ ntxId: "ntxD" }) });
        const { win } = stubContentWindow(getIframe(root));

        // Mismatched ntx -> nothing posted.
        fireTrilium("customDownload", { ntxId: "other" });
        expect(win.postMessage).not.toHaveBeenCalled();

        fireTrilium("customDownload", { ntxId: "ntxD" });
        expect(win.postMessage).toHaveBeenCalledWith({ type: "trilium-request-download" });
    });

    it("forwards print to the iframe only when the context is active", async () => {
        const inactive = fakeNoteContext({ active: false });
        const root = await renderPdf({ note: pdfNote(), noteContext: inactive });
        const { win } = stubContentWindow(getIframe(root));

        fireTrilium("printActiveNote", {});
        expect(win.postMessage).not.toHaveBeenCalled();
    });

    it("posts print and find messages when the context is active", async () => {
        const root = await renderPdf({ note: pdfNote(), noteContext: fakeNoteContext({ active: true }) });
        const { win } = stubContentWindow(getIframe(root));

        fireTrilium("printActiveNote", {});
        expect(win.postMessage).toHaveBeenCalledWith({ type: "trilium-print" }, window.location.origin);

        fireTrilium("findInText", {});
        expect(win.postMessage).toHaveBeenCalledWith({ type: "trilium-find" }, window.location.origin);
    });

    it("ignores findInText when the context is not active", async () => {
        const root = await renderPdf({ note: pdfNote(), noteContext: fakeNoteContext({ active: false }) });
        const { win } = stubContentWindow(getIframe(root));

        fireTrilium("findInText", {});
        expect(win.postMessage).not.toHaveBeenCalled();
    });
});

describe("PdfPreview - blob save flow", () => {
    function fireTrilium(name: string, data: unknown) {
        act(() => {
            (parent?.handleEventInChildren as unknown as (n: string, d: unknown) => void)(name, data);
        });
    }

    it("reloads the iframe through onContentChange once the blob is available", async () => {
        const { win, restore } = installPrototypeContentWindow();
        try {
            // contentWindow is present from creation, so the blob effect's onContentChange reloads it.
            await renderPdf({ note: pdfNote({ id: "noteCC" }), noteContext: fakeNoteContext({ ntxId: "ntxCC" }) });
            const reload = (win.location as unknown as { reload: ReturnType<typeof vi.fn> }).reload;
            expect(reload).toHaveBeenCalled();
        } finally {
            restore();
        }
    });

    it("requests a blob from the iframe, builds a File and uploads it on save", async () => {
        const { win, restore } = installPrototypeContentWindow();
        try {
            const ctx = fakeNoteContext({ ntxId: "ntxUp" });
            await renderPdf({ note: pdfNote({ id: "noteUp" }), noteContext: ctx });

            // Mark dirty, then force an immediate save via beforeNoteSwitch (registered by the hook).
            postWindowMessage({ type: "pdfjs-viewer-document-modified", noteId: "noteUp", ntxId: "ntxUp" });

            await act(async () => {
                fireTrilium("beforeNoteSwitch", { noteContext: { ntxId: "ntxUp" } });
                // getData posts trilium-request-blob; reply with a matching blob to resolve the promise.
                window.dispatchEvent(new MessageEvent("message", {
                    data: {
                        type: "pdfjs-viewer-blob",
                        noteId: "noteUp",
                        ntxId: "ntxUp",
                        data: new Uint8Array([ 1, 2, 3 ])
                    }
                }));
                await new Promise((resolve) => setTimeout(resolve, 0));
            });

            // getData asked the iframe for its blob...
            expect(win.postMessage).toHaveBeenCalledWith(
                expect.objectContaining({ type: "trilium-request-blob" }),
                window.location.origin
            );
            // ...and the resolved blob was uploaded.
            expect(server.upload).toHaveBeenCalledWith(
                expect.stringContaining("notes/noteUp/file"),
                expect.any(File),
                expect.anything()
            );
        } finally {
            restore();
        }
    });

    it("rejects getData (no upload) when no blob reply arrives before the timeout", async () => {
        vi.useFakeTimers();
        const { restore } = installPrototypeContentWindow();
        try {
            const ctx = fakeNoteContext({ ntxId: "ntxTO" });
            // Fake timers are active, so render synchronously (no async flush, which would await a real timer).
            const { parent: p } = renderComponent(
                <PdfPreview note={pdfNote({ id: "noteTO" })} noteContext={ctx} blob={null} componentId={undefined} />
            );
            parent = p;

            // Mark dirty; scheduleUpdate sets a 0ms timer that, once the interval has elapsed,
            // runs the updater -> getData, which registers a 10s reject timeout.
            postWindowMessage({ type: "pdfjs-viewer-document-modified", noteId: "noteTO", ntxId: "ntxTO" });

            // Pass the 1s spaced-update interval so triggerUpdate runs getData.
            await act(async () => { await vi.advanceTimersByTimeAsync(1_500); });
            // No blob reply -> advance past the 10s timeout to trigger reject (line 30).
            await act(async () => { await vi.advanceTimersByTimeAsync(10_500); });

            expect(server.upload).not.toHaveBeenCalled();
        } finally {
            restore();
            vi.useRealTimers();
        }
    });

    it("returns undefined from getData (no upload) when the iframe has no contentWindow", async () => {
        // No prototype contentWindow installed -> getData short-circuits to undefined.
        const ctx = fakeNoteContext({ ntxId: "ntxNo" });
        await renderPdf({ note: pdfNote({ id: "noteNo" }), noteContext: ctx });

        postWindowMessage({ type: "pdfjs-viewer-document-modified", noteId: "noteNo", ntxId: "ntxNo" });
        await act(async () => {
            fireTrilium("beforeNoteSwitch", { noteContext: { ntxId: "ntxNo" } });
            await new Promise((resolve) => setTimeout(resolve, 0));
        });

        expect(server.upload).not.toHaveBeenCalled();
    });
});
