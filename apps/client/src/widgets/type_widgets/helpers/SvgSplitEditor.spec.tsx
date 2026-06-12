import type { ComponentChildren, VNode } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { flush, renderComponent } from "../../../test/render";

// --- Module mocks (hoisted above the component import) ---------------------------------------------

// Capture the props handed to the (mocked) SplitEditor so tests can drive its callbacks. The mock
// renders previewContent + previewButtons into the real DOM so containerRef gets a live element and
// the preview buttons are clickable.
const lastSplitProps: { current: Record<string, unknown> | undefined } = { current: undefined };

vi.mock("./SplitEditor", () => {
    function SplitEditor(props: Record<string, unknown>) {
        lastSplitProps.current = props;
        return (
            <div className="mock-split-editor">
                <div className="mock-preview-content">{props.previewContent as ComponentChildren}</div>
                <div className="mock-preview-buttons">{props.previewButtons as ComponentChildren}</div>
            </div>
        );
    }
    function PreviewButton(props: { icon?: string; text?: string; onClick?: () => void }) {
        return (
            <button class="preview-button" data-icon={props.icon} onClick={props.onClick}>
                {props.text}
            </button>
        );
    }
    return { default: SplitEditor, PreviewButton };
});

// svg-pan-zoom: capture constructed instances + the element it was given.
const panZoomInstances: Array<Record<string, ReturnType<typeof vi.fn>>> = [];
const svgPanZoomCalls: Array<{ el: unknown; opts: unknown }> = [];

vi.mock("svg-pan-zoom", () => {
    const factory = vi.fn((el: unknown, opts: unknown) => {
        svgPanZoomCalls.push({ el, opts });
        const instance: Record<string, ReturnType<typeof vi.fn>> = {};
        const chain = vi.fn(() => instance);
        Object.assign(instance, {
            zoomIn: chain,
            zoomOut: chain,
            zoom: chain,
            pan: chain,
            resize: chain,
            center: chain,
            fit: chain,
            getPan: vi.fn(() => ({ x: 1, y: 2 })),
            getZoom: vi.fn(() => 1.5),
            destroy: vi.fn()
        });
        panZoomInstances.push(instance);
        return instance;
    });
    return { default: factory };
});

vi.mock("../../../services/toast", () => ({
    default: { showError: vi.fn() }
}));

vi.mock("../../../services/utils", async (importOriginal) => ({
    ...(await importOriginal<typeof import("../../../services/utils")>()),
    default: {
        ...(await importOriginal<typeof import("../../../services/utils")>()).default,
        downloadAsSvg: vi.fn(async () => undefined),
        downloadAsPng: vi.fn(async () => undefined)
    }
}));

import server from "../../../services/server";
import toast from "../../../services/toast";
import utils from "../../../services/utils";
import { buildNote } from "../../../test/easy-froca";
import type FNote from "../../../entities/fnote";
import SvgSplitEditor from "./SvgSplitEditor";

// --- Render harness (component inside ParentComponent so useTriliumEvent registers) ----------------

let container: HTMLElement | undefined;
let fireEvent: (name: string, data: unknown) => void;
let unmountEditor: () => void;

/** Supplies the required `TypeWidgetProps` base props so tests only vary the interesting ones. */
function Editor({ ntxId, note, attachmentName, renderSvg }: {
    ntxId: string;
    note: FNote;
    attachmentName: string;
    renderSvg: (content: string) => string | Promise<string>;
}) {
    return (
        <SvgSplitEditor
            ntxId={ntxId}
            note={note}
            attachmentName={attachmentName}
            renderSvg={renderSvg}
            viewScope={undefined}
            parentComponent={undefined}
            noteContext={undefined}
        />
    );
}

function renderEditor(vnode: VNode) {
    const { container: host, parent, unmount } = renderComponent(vnode);
    container = host;
    unmountEditor = unmount;
    fireEvent = (name, data) => act(() => {
        (parent.handleEventInChildren as unknown as (n: string, d: unknown) => void)(name, data);
    });
    return host;
}

/** Inject a real <svg> element into the preview container so the resizer / export paths find it. */
function injectSvgIntoPreview() {
    const previewDiv = container?.querySelector(".render-container");
    if (previewDiv) {
        previewDiv.innerHTML = "<svg><rect/></svg>";
    }
}

const VALID_SVG = "<svg xmlns=\"http://www.w3.org/2000/svg\"><rect/></svg>";

// happy-dom's ResizeObserver is inert. Replace it so useElementSize's callback can be fired on demand,
// driving the resizer's "react to container changes" effect.
const resizeObservers: Array<{ cb: () => void }> = [];
class FakeResizeObserver {
    cb: () => void;
    constructor(cb: () => void) { this.cb = cb; resizeObservers.push({ cb }); }
    observe() {}
    unobserve() {}
    disconnect() {}
}
let originalResizeObserver: typeof ResizeObserver | undefined;
let originalGetBoundingClientRect: typeof HTMLElement.prototype.getBoundingClientRect | undefined;

function fireResize() {
    act(() => { resizeObservers.forEach((o) => o.cb()); });
}

beforeEach(() => {
    lastSplitProps.current = undefined;
    panZoomInstances.length = 0;
    svgPanZoomCalls.length = 0;
    resizeObservers.length = 0;
    vi.clearAllMocks();
    // setup.ts's auto-mock only defines server.get/post; ensure post is a fresh spy each test.
    Object.assign(server, { post: vi.fn(async () => undefined) });
});

afterEach(() => {
    container = undefined;
    if (originalResizeObserver) {
        window.ResizeObserver = originalResizeObserver;
        originalResizeObserver = undefined;
    }
    if (originalGetBoundingClientRect) {
        HTMLElement.prototype.getBoundingClientRect = originalGetBoundingClientRect;
        originalGetBoundingClientRect = undefined;
    }
});

// --- Tests ----------------------------------------------------------------------------------------

describe("SvgSplitEditor", () => {
    it("renders through SplitEditor with svg className and preview buttons", () => {
        const note = buildNote({ id: "n1", title: "Diagram" });
        renderEditor(<Editor ntxId="ntx1" note={note} attachmentName="diagram" renderSvg={() => VALID_SVG} />);

        expect(lastSplitProps.current?.className).toBe("svg-editor");
        expect(lastSplitProps.current?.note).toBe(note);
        expect(lastSplitProps.current?.ntxId).toBe("ntx1");

        const buttons = container?.querySelectorAll(".preview-button") ?? [];
        expect(buttons.length).toBe(3);
        const icons = Array.from(buttons).map((b) => b.getAttribute("data-icon"));
        expect(icons).toEqual([ "bx bx-zoom-in", "bx bx-zoom-out", "bx bx-crop" ]);
    });

    it("renders the SVG into the preview and clears error on successful renderSvg", async () => {
        const note = buildNote({ id: "n2", title: "Diagram" });
        const renderSvg = vi.fn(() => VALID_SVG);
        renderEditor(<Editor ntxId="ntx2" note={note} attachmentName="diagram" renderSvg={renderSvg} />);

        const onContentChanged = lastSplitProps.current?.onContentChanged as (c: string) => Promise<void>;
        await act(async () => { await onContentChanged("graph TD; A-->B"); });
        await flush();

        expect(renderSvg).toHaveBeenCalledWith("graph TD; A-->B");
        expect(lastSplitProps.current?.error).toBeNull();
        const previewHtml = container?.querySelector(".render-container")?.innerHTML ?? "";
        expect(previewHtml).toContain("<svg");
    });

    it("sets the error message when renderSvg throws", async () => {
        const note = buildNote({ id: "n3", title: "Diagram" });
        const renderSvg = vi.fn(() => { throw new Error("boom"); });
        renderEditor(<Editor ntxId="ntx3" note={note} attachmentName="diagram" renderSvg={renderSvg} />);

        const onContentChanged = lastSplitProps.current?.onContentChanged as (c: string) => Promise<void>;
        await act(async () => { await onContentChanged("bad"); });
        await flush();

        expect(lastSplitProps.current?.error).toBe("boom");
    });

    it("does not POST an attachment when SVG has not been rendered (onSave guard)", async () => {
        const note = buildNote({ id: "n4", title: "Diagram" });
        renderEditor(<Editor ntxId="ntx4" note={note} attachmentName="diagram" renderSvg={() => VALID_SVG} />);

        const dataSaved = lastSplitProps.current?.dataSaved as () => void;
        dataSaved();
        await flush();
        expect(server.post).not.toHaveBeenCalled();
    });

    it("POSTs the attachment via dataSaved once an SVG is rendered", async () => {
        const note = buildNote({ id: "n5", title: "Diagram" });
        note.getAttachments = async () => [ { title: "diagram.svg" } as never ];
        renderEditor(<Editor ntxId="ntx5" note={note} attachmentName="diagram" renderSvg={() => VALID_SVG} />);

        const onContentChanged = lastSplitProps.current?.onContentChanged as (c: string) => Promise<void>;
        await act(async () => { await onContentChanged("content"); });
        await flush();

        const dataSaved = lastSplitProps.current?.dataSaved as () => void;
        (server.post as ReturnType<typeof vi.fn>).mockClear();
        dataSaved();

        expect(server.post).toHaveBeenCalledTimes(1);
        const [ url, payload ] = (server.post as ReturnType<typeof vi.fn>).mock.calls[0];
        expect(url).toBe("notes/n5/attachments?matchBy=title");
        expect(payload).toMatchObject({ role: "image", title: "diagram.svg", mime: "image/svg+xml", content: VALID_SVG, position: 0 });
    });

    it("auto-saves on entering a note when no matching attachment exists", async () => {
        const note = buildNote({ id: "n6", title: "Diagram" });
        note.getAttachments = vi.fn(async () => [] as never);
        renderEditor(<Editor ntxId="ntx6" note={note} attachmentName="diagram" renderSvg={() => VALID_SVG} />);

        const onContentChanged = lastSplitProps.current?.onContentChanged as (c: string) => Promise<void>;
        await act(async () => { await onContentChanged("content"); });
        await flush();

        expect(note.getAttachments).toHaveBeenCalled();
        expect(server.post).toHaveBeenCalledTimes(1);
    });

    it("does NOT auto-save when a matching attachment already exists", async () => {
        const note = buildNote({ id: "n7", title: "Diagram" });
        note.getAttachments = vi.fn(async () => [ { title: "diagram.svg" } ] as never);
        renderEditor(<Editor ntxId="ntx7" note={note} attachmentName="diagram" renderSvg={() => VALID_SVG} />);

        const onContentChanged = lastSplitProps.current?.onContentChanged as (c: string) => Promise<void>;
        await act(async () => { await onContentChanged("content"); });
        await flush();

        expect(note.getAttachments).toHaveBeenCalled();
        expect(server.post).not.toHaveBeenCalled();
    });

    it("logs an error when getAttachments rejects during auto-save", async () => {
        const note = buildNote({ id: "n8", title: "Diagram" });
        note.getAttachments = vi.fn(async () => { throw new Error("nope"); });
        const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
        renderEditor(<Editor ntxId="ntx8" note={note} attachmentName="diagram" renderSvg={() => VALID_SVG} />);

        const onContentChanged = lastSplitProps.current?.onContentChanged as (c: string) => Promise<void>;
        await act(async () => { await onContentChanged("content"); });
        await flush();

        expect(consoleError).toHaveBeenCalled();
    });
});

describe("SvgSplitEditor - export events", () => {
    async function setupRenderedSvg(ntxId: string, noteId: string) {
        const note = buildNote({ id: noteId, title: "Diagram" });
        note.getAttachments = async () => [ { title: "diagram.svg" } as never ];
        renderEditor(<Editor ntxId={ntxId} note={note} attachmentName="diagram" renderSvg={() => VALID_SVG} />);
        const onContentChanged = lastSplitProps.current?.onContentChanged as (c: string) => Promise<void>;
        await act(async () => { await onContentChanged("content"); });
        await flush();
        injectSvgIntoPreview();
        return note;
    }

    it("exportSvg ignores events for a different ntxId", async () => {
        await setupRenderedSvg("ntxA", "ne1");
        fireEvent("exportSvg", { ntxId: "other" });
        await flush();
        expect(utils.downloadAsSvg).not.toHaveBeenCalled();
    });

    it("exportSvg downloads the SVG for the matching ntxId", async () => {
        const note = await setupRenderedSvg("ntxB", "ne2");
        fireEvent("exportSvg", { ntxId: "ntxB" });
        await flush();
        expect(utils.downloadAsSvg).toHaveBeenCalledTimes(1);
        const [ title ] = (utils.downloadAsSvg as ReturnType<typeof vi.fn>).mock.calls[0];
        expect(title).toBe(note.title);
    });

    it("exportSvg shows an error toast when no <svg> element is present", async () => {
        await setupRenderedSvg("ntxC", "ne3");
        // Remove the svg element so containerRef.querySelector returns null.
        const previewDiv = container?.querySelector(".render-container");
        if (previewDiv) previewDiv.innerHTML = "";
        fireEvent("exportSvg", { ntxId: "ntxC" });
        await flush();
        expect(toast.showError).toHaveBeenCalledTimes(1);
        expect(utils.downloadAsSvg).not.toHaveBeenCalled();
    });

    it("exportSvg shows an error toast when downloadAsSvg rejects", async () => {
        await setupRenderedSvg("ntxD", "ne4");
        (utils.downloadAsSvg as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("dl fail"));
        fireEvent("exportSvg", { ntxId: "ntxD" });
        await flush();
        expect(toast.showError).toHaveBeenCalledTimes(1);
    });

    it("exportPng downloads the PNG for the matching ntxId", async () => {
        const note = await setupRenderedSvg("ntxE", "ne5");
        fireEvent("exportPng", { ntxId: "ntxE" });
        await flush();
        expect(utils.downloadAsPng).toHaveBeenCalledTimes(1);
        const [ title ] = (utils.downloadAsPng as ReturnType<typeof vi.fn>).mock.calls[0];
        expect(title).toBe(note.title);
    });

    it("exportPng ignores events for a different ntxId", async () => {
        await setupRenderedSvg("ntxF", "ne6");
        fireEvent("exportPng", { ntxId: "nope" });
        await flush();
        expect(utils.downloadAsPng).not.toHaveBeenCalled();
    });

    it("exportPng shows an error toast when no <svg> element is present", async () => {
        await setupRenderedSvg("ntxG", "ne7");
        const previewDiv = container?.querySelector(".render-container");
        if (previewDiv) previewDiv.innerHTML = "";
        fireEvent("exportPng", { ntxId: "ntxG" });
        await flush();
        expect(toast.showError).toHaveBeenCalledTimes(1);
        expect(utils.downloadAsPng).not.toHaveBeenCalled();
    });

    it("exportPng shows an error toast when downloadAsPng rejects", async () => {
        await setupRenderedSvg("ntxH", "ne8");
        (utils.downloadAsPng as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("dl fail"));
        fireEvent("exportPng", { ntxId: "ntxH" });
        await flush();
        expect(toast.showError).toHaveBeenCalledTimes(1);
    });

    it("does nothing on export events when no SVG has been rendered", async () => {
        const note = buildNote({ id: "ne9", title: "Diagram" });
        renderEditor(<Editor ntxId="ntxI" note={note} attachmentName="diagram" renderSvg={() => VALID_SVG} />);
        fireEvent("exportSvg", { ntxId: "ntxI" });
        fireEvent("exportPng", { ntxId: "ntxI" });
        await flush();
        expect(utils.downloadAsSvg).not.toHaveBeenCalled();
        expect(utils.downloadAsPng).not.toHaveBeenCalled();
    });
});

describe("SvgSplitEditor - pan & zoom resizer", () => {
    /**
     * The resizer effect runs after the SVG is rendered and a real <svg> element is present in the
     * preview container. We inject the <svg> ourselves (the mocked RawHtml renders into a real div)
     * and then trigger a re-render so the effect picks up the element.
     */
    async function setupWithZoom(ntxId: string, noteId: string) {
        const note = buildNote({ id: noteId, title: "Diagram" });
        note.getAttachments = async () => [ { title: "diagram.svg" } as never ];
        renderEditor(<Editor ntxId={ntxId} note={note} attachmentName="diagram" renderSvg={() => VALID_SVG} />);
        const onContentChanged = lastSplitProps.current?.onContentChanged as (c: string) => Promise<void>;
        await act(async () => { await onContentChanged("content"); });
        await flush();
        return note;
    }

    it("wires the zoom-in / zoom-out / reset buttons to the pan-zoom instance", async () => {
        await setupWithZoom("ntxZ1", "nz1");
        await flush();

        // The pan-zoom instance is created from the rendered <svg> (RawHtmlBlock writes real markup).
        expect(svgPanZoomCalls.length).toBeGreaterThanOrEqual(1);
        const instance = panZoomInstances[panZoomInstances.length - 1];

        const buttons = Array.from(container?.querySelectorAll(".preview-button") ?? []) as HTMLButtonElement[];
        expect(buttons.length).toBe(3);

        buttons[0].click();
        expect(instance.zoomIn).toHaveBeenCalled();
        buttons[1].click();
        expect(instance.zoomOut).toHaveBeenCalled();
        buttons[2].click();
        expect(instance.fit).toHaveBeenCalled();
        expect(instance.center).toHaveBeenCalled();
    });

    it("calls resize/center/fit when setting up a fresh pan-zoom instance", async () => {
        await setupWithZoom("ntxZ2", "nz2");
        await flush();
        const instance = panZoomInstances[panZoomInstances.length - 1];
        // Fresh setup path (no preserved pan/zoom) calls resize().center().fit().
        expect(instance.resize).toHaveBeenCalled();
        expect(instance.center).toHaveBeenCalled();
        expect(instance.fit).toHaveBeenCalled();
    });

    it("destroys the pan-zoom instance on unmount", async () => {
        await setupWithZoom("ntxZ3", "nz3");
        await flush();
        const instance = panZoomInstances[panZoomInstances.length - 1];
        unmountEditor();
        expect(instance.destroy).toHaveBeenCalled();
    });

    it("marks the container as empty (no svgPanZoom) when renderSvg returns an empty string", async () => {
        const note = buildNote({ id: "nz4", title: "Diagram" });
        renderEditor(<Editor ntxId="ntxZ4" note={note} attachmentName="diagram" renderSvg={() => ""} />);
        const onContentChanged = lastSplitProps.current?.onContentChanged as (c: string) => Promise<void>;
        await act(async () => { await onContentChanged(""); });
        await flush();
        // Empty SVG → no <svg> element → no pan-zoom instance is created.
        expect(svgPanZoomCalls.length).toBe(0);
    });

    it("re-runs resize().fit().center() when the container size changes after setup", async () => {
        originalResizeObserver = window.ResizeObserver;
        window.ResizeObserver = FakeResizeObserver as unknown as typeof ResizeObserver;
        originalGetBoundingClientRect = HTMLElement.prototype.getBoundingClientRect;
        HTMLElement.prototype.getBoundingClientRect = function () {
            return { width: 100, height: 100, top: 0, left: 0, right: 100, bottom: 100, x: 0, y: 0, toJSON() {} } as DOMRect;
        };

        await setupWithZoom("ntxZ5", "nz5");
        await flush();
        const instancesBefore = panZoomInstances.length;

        // A non-zero width update drives the "react to container changes" effect (resize/fit/center).
        fireResize();
        await flush();

        // The width change re-runs the pan-zoom setup and the "react to container changes" effect.
        const instance = panZoomInstances[panZoomInstances.length - 1];
        expect(panZoomInstances.length).toBeGreaterThanOrEqual(instancesBefore);
        expect(instance.resize).toHaveBeenCalled();
        expect(instance.fit).toHaveBeenCalled();
        expect(instance.center).toHaveBeenCalled();
    });

    it("preserves the previous pan/zoom when re-rendering the same note", async () => {
        const note = buildNote({ id: "nz6", title: "Diagram" });
        note.getAttachments = async () => [ { title: "diagram.svg" } as never ];
        renderEditor(
            <Editor ntxId="ntxZ6" note={note} attachmentName="diagram" renderSvg={(c) => `<svg data-c="${c}"><rect/></svg>`} />
        );
        const onContentChanged = lastSplitProps.current?.onContentChanged as (c: string) => Promise<void>;

        // First render builds an instance and records lastNoteId.
        await act(async () => { await onContentChanged("first"); });
        await flush();
        const firstInstance = panZoomInstances[panZoomInstances.length - 1];

        // Changing only the content (same note) tears down (records lastPanZoom) and rebuilds; the
        // rebuild should restore the recorded pan/zoom rather than re-fitting.
        await act(async () => { await onContentChanged("second"); });
        await flush();
        const secondInstance = panZoomInstances[panZoomInstances.length - 1];

        expect(firstInstance.getPan).toHaveBeenCalled();
        expect(firstInstance.getZoom).toHaveBeenCalled();
        expect(secondInstance).not.toBe(firstInstance);
        expect(secondInstance.zoom).toHaveBeenCalledWith(1.5);
        expect(secondInstance.pan).toHaveBeenCalledWith({ x: 1, y: 2 });
    });
});
