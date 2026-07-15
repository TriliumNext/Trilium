import { render } from "preact";
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "vitest";

// Viewer.js measures real layout, so unit tests capture the constructor contract and drive the
// wrapper through the CustomEvents Viewer.js dispatches on the source element instead.
const { ViewerMock } = vi.hoisted(() => {
    class ViewerMock {
        static instances: ViewerMock[] = [];
        element: HTMLElement;
        options: Record<string, unknown>;
        index: number;
        fulled = false;
        image = document.createElement("img");
        imageData = { ratio: 0.5 };
        initialImageData = { ratio: 0.5 };
        navbar = document.createElement("div");
        view = vi.fn((index: number) => { this.index = index; });
        update = vi.fn();
        destroy = vi.fn();
        full = vi.fn(() => { this.fulled = true; });
        exit = vi.fn(() => { this.fulled = false; });
        zoom = vi.fn();
        zoomTo = vi.fn();
        rotate = vi.fn();
        scaleX = vi.fn();
        move = vi.fn();
        reset = vi.fn();
        resize = vi.fn();

        constructor(element: HTMLElement, options: Record<string, unknown>) {
            this.element = element;
            this.options = options;
            this.index = Number(options.initialViewIndex ?? 0);
            ViewerMock.instances.push(this);
        }

        static get last(): ViewerMock {
            const instance = ViewerMock.instances.at(-1);
            if (!instance) throw new Error("no Viewer constructed");
            return instance;
        }
    }
    return { ViewerMock };
});

vi.mock("viewerjs", () => ({ default: ViewerMock }));
vi.mock("../hooks", () => ({ useStaticTooltip: () => {}, useTriliumEvent: () => {} }));

import type { MediaGallery, MediaViewerItem } from "./gallery";
import MediaViewer, { type MediaViewerApi, toSiblingNavigation } from "./MediaViewer";

function makeItem(id: string, title = id): MediaViewerItem {
    return { id, title, src: `api/images/${id}/${title}?v=blob-${id}`, kind: "note", mime: "image/png" };
}

function makeGallery(items: MediaViewerItem[], currentIndex = 0): MediaGallery & { navigateToIndex: Mock<(index: number) => void> } {
    return {
        items,
        currentIndex,
        surfaceKey: "note-gallery:root/parent",
        navigateToIndex: vi.fn<(index: number) => void>(),
        navigatePrevious: vi.fn(),
        navigateNext: vi.fn(),
        navigateFirst: vi.fn(),
        navigateLast: vi.fn()
    };
}

interface RenderedViewer {
    container: HTMLElement;
    api: { current: MediaViewerApi | null };
    rerender: (gallery: MediaGallery, isVisible?: boolean) => void;
    sourcesElement: () => HTMLElement;
    dispatch: (type: string, detail?: unknown) => void;
}

const mountedContainers: HTMLElement[] = [];

function renderViewer(gallery: MediaGallery, isVisible = true): RenderedViewer {
    const container = document.createElement("div");
    mountedContainers.push(container);
    const api: { current: MediaViewerApi | null } = { current: null };
    const doRender = (nextGallery: MediaGallery, nextVisible = true) =>
        render(<MediaViewer gallery={nextGallery} isVisible={nextVisible} apiRef={api} />, container);
    doRender(gallery, isVisible);
    const sourcesElement = () => {
        const sources = container.querySelector<HTMLElement>(".media-viewer-sources");
        if (!sources) throw new Error("sources element missing");
        return sources;
    };
    return {
        container,
        api,
        rerender: doRender,
        sourcesElement,
        dispatch: (type, detail) => sourcesElement().dispatchEvent(new CustomEvent(type, { detail }))
    };
}

describe("MediaViewer", () => {
    let originalDecode: typeof HTMLImageElement.prototype.decode;
    beforeEach(() => {
        ViewerMock.instances.length = 0;
        originalDecode = HTMLImageElement.prototype.decode;
        HTMLImageElement.prototype.decode = () => Promise.resolve();
    });
    afterEach(() => {
        HTMLImageElement.prototype.decode = originalDecode;
        // Unmount properly — a stale document-level key listener from a previous test would
        // preventDefault() the event and starve the listener under test.
        for (const container of mountedContainers.splice(0)) render(null, container);
    });

    it("renders a hidden source list with per-item wrappers carrying data-src (never src)", () => {
        const { container } = renderViewer(makeGallery([ makeItem("a", "One two.png"), makeItem("b") ]));
        const imgs = Array.from(container.querySelectorAll(".media-viewer-sources .media-viewer-source img"));
        expect(imgs).toHaveLength(2);
        expect(imgs[0]?.getAttribute("data-src")).toBe("api/images/a/One two.png?v=blob-a");
        expect(imgs[0]?.hasAttribute("src")).toBe(false);
        expect(imgs[0]?.getAttribute("alt")).toBe("One two.png");
    });

    it("constructs Viewer.js on the source list with the Trilium contract options", () => {
        renderViewer(makeGallery([ makeItem("a"), makeItem("b") ], 1));
        const viewer = ViewerMock.last;
        expect(viewer.element.className).toContain("media-viewer-sources");
        expect(viewer.options).toMatchObject({
            inline: true,
            button: false,
            focus: false,
            keyboard: false,
            navbar: false,
            title: false,
            toolbar: false,
            tooltip: false,
            loop: true,
            url: "data-src",
            initialViewIndex: 1,
            initialCoverage: 1
        });
        // Snappier wheel than the library default, sane zoom envelope.
        expect(viewer.options.zoomRatio as number).toBeGreaterThan(0.1);
        expect(viewer.options.minZoomRatio as number).toBeLessThan(1);
        expect(viewer.options.maxZoomRatio as number).toBeGreaterThan(1);
    });

    it("destroys the Viewer instance on unmount", () => {
        const { container } = renderViewer(makeGallery([ makeItem("a") ]));
        render(null, container);
        expect(ViewerMock.last.destroy).toHaveBeenCalledTimes(1);
    });

    it("views the new index when the gallery's currentIndex changes, without echoing same-index updates", () => {
        const items = [ makeItem("a"), makeItem("b"), makeItem("c") ];
        const { rerender, dispatch } = renderViewer(makeGallery(items, 0));
        dispatch("ready");

        rerender(makeGallery(items, 2));
        expect(ViewerMock.last.view).toHaveBeenCalledWith(2);

        ViewerMock.last.view.mockClear();
        rerender(makeGallery(items, 2));
        expect(ViewerMock.last.view).not.toHaveBeenCalled();
    });

    it("syncs viewer-internal navigation (swipe, thumbnail click) back into app navigation", () => {
        const gallery = makeGallery([ makeItem("a"), makeItem("b") ], 0);
        const { dispatch } = renderViewer(gallery);
        dispatch("ready");

        ViewerMock.last.index = 1;
        dispatch("viewed", { index: 1 });
        expect(gallery.navigateToIndex).toHaveBeenCalledWith(1);

        gallery.navigateToIndex.mockClear();
        dispatch("viewed", { index: 0, ...( { } ) });
        // Echo of the app's own navigation (index already current) must not navigate again.
        expect(gallery.navigateToIndex).not.toHaveBeenCalledWith(0);
    });

    it("updates the Viewer when the gallery items change within the same surface", () => {
        const { rerender } = renderViewer(makeGallery([ makeItem("a") ]));
        const viewer = ViewerMock.last;
        expect(viewer.update).not.toHaveBeenCalled();

        rerender(makeGallery([ makeItem("a"), makeItem("b") ]));
        expect(viewer.update).toHaveBeenCalledTimes(1);
        expect(ViewerMock.instances).toHaveLength(1);
    });

    it("marks large zoom for crisp rendering only beyond 4x native resolution", async () => {
        const { container, dispatch } = renderViewer(makeGallery([ makeItem("a") ]));
        const hasLargeZoomClass = () => container.querySelector(".media-viewer-root")?.classList.contains("tn-image-large-zoom");
        dispatch("ready");
        dispatch("zoomed", { ratio: 4, oldRatio: 1 });
        await Promise.resolve();
        expect(hasLargeZoomClass()).toBe(false);
        dispatch("zoomed", { ratio: 4.5, oldRatio: 4 });
        await vi.waitFor(() => expect(hasLargeZoomClass()).toBe(true));
    });

    it("toggles fullscreen through the api: first entry enables the navbar and updates, exit flips back", async () => {
        const { api, container, dispatch } = renderViewer(makeGallery([ makeItem("a"), makeItem("b") ]));
        // While fullscreen the root lives under document.body; afterwards back in the container.
        const rootEl = () => container.querySelector(".media-viewer-root") ?? document.querySelector(".media-viewer-root");
        const hasFulledClass = () => rootEl()?.classList.contains("media-viewer-fulled") ?? false;
        dispatch("ready");
        const viewer = ViewerMock.last;

        api.current?.toggleFullscreen();
        expect(viewer.options.navbar).toBe(true);
        expect(viewer.update).toHaveBeenCalledTimes(1);
        expect(viewer.full).toHaveBeenCalledTimes(1);
        expect(api.current?.isFullscreen()).toBe(true);
        await vi.waitFor(() => expect(hasFulledClass()).toBe(true));
        // Reparented to <body> while fullscreen — ancestor stacking contexts (panes, sidebars)
        // would otherwise paint above the fixed viewer.
        expect(rootEl()?.parentElement).toBe(document.body);

        api.current?.toggleFullscreen();
        expect(viewer.exit).toHaveBeenCalledTimes(1);
        await vi.waitFor(() => expect(hasFulledClass()).toBe(false));
        // Restored to its original place in the widget on exit.
        expect(rootEl()?.parentElement).toBe(container);

        // Re-entering keeps the already-initialized navbar without another update().
        api.current?.toggleFullscreen();
        expect(viewer.update).toHaveBeenCalledTimes(1);
        expect(viewer.full).toHaveBeenCalledTimes(2);
    });

    it("does not enable the navbar for a single-image gallery", () => {
        const { api, dispatch } = renderViewer(makeGallery([ makeItem("a") ]));
        dispatch("ready");
        api.current?.toggleFullscreen();
        expect(ViewerMock.last.options.navbar).toBe(false);
        expect(ViewerMock.last.full).toHaveBeenCalled();
    });

    it("abandons fullscreen when the gallery surface changes (viewer instance is rebuilt)", async () => {
        const items = [ makeItem("a"), makeItem("b") ];
        const first = makeGallery(items);
        const { api, container, rerender, dispatch } = renderViewer(first);
        dispatch("ready");
        api.current?.toggleFullscreen();
        await vi.waitFor(() => expect(document.querySelector("body > .media-viewer-root")).not.toBeNull());

        rerender({ ...makeGallery(items), surfaceKey: "note-gallery:other/parent" });
        // The stale fullscreen presentation must not survive: root back home, class cleared.
        await vi.waitFor(() => {
            const root = container.querySelector(".media-viewer-root");
            expect(root).not.toBeNull();
            expect(root?.classList.contains("media-viewer-fulled")).toBe(false);
        });
        expect(document.querySelector("body > .media-viewer-root")).toBeNull();
    });

    it("exits fullscreen when the widget stops being visible (note switch, closed popup)", () => {
        const items = [ makeItem("a") ];
        const gallery = makeGallery(items);
        const { api, rerender, dispatch } = renderViewer(gallery);
        dispatch("ready");
        api.current?.toggleFullscreen();
        expect(ViewerMock.last.fulled).toBe(true);

        rerender(gallery, false);
        expect(ViewerMock.last.exit).toHaveBeenCalledTimes(1);
    });

    it("exposes the viewer surface through the api (zoom, fit, 1:1, rotate, flip, move, reset)", () => {
        const { api, dispatch } = renderViewer(makeGallery([ makeItem("a") ]));
        dispatch("ready");
        const viewer = ViewerMock.last;
        viewer.imageData = { ratio: 0.75 };
        viewer.initialImageData = { ratio: 0.5 };

        api.current?.zoomBy(0.2);
        expect(viewer.zoom).toHaveBeenCalledWith(0.2, false, undefined);
        api.current?.zoomTo(1.5);
        expect(viewer.zoomTo).toHaveBeenCalledWith(1.5);
        api.current?.fitToWindow();
        expect(viewer.zoomTo).toHaveBeenCalledWith(0.5);
        api.current?.actualSize();
        expect(viewer.zoomTo).toHaveBeenCalledWith(1);
        api.current?.rotate(-90);
        expect(viewer.rotate).toHaveBeenCalledWith(-90);
        api.current?.flipHorizontal();
        expect(viewer.scaleX).toHaveBeenCalled();
        api.current?.moveBy(10, -5);
        expect(viewer.move).toHaveBeenCalledWith(10, -5);
        api.current?.reset();
        expect(viewer.reset).toHaveBeenCalled();

        expect(api.current?.isAtFit()).toBe(false);
        viewer.imageData = { ratio: 0.5 };
        expect(api.current?.isAtFit()).toBe(true);
    });

    it("shows the error overlay when the viewed image truly fails to load", async () => {
        HTMLImageElement.prototype.decode = () => Promise.reject(new Error("broken"));
        const { container, dispatch } = renderViewer(makeGallery([ makeItem("a") ]));
        dispatch("ready");
        dispatch("viewed", { index: 0 });

        await vi.waitFor(() => expect(container.querySelector(".content-error-message")).not.toBeNull());
        expect(container.querySelector(".media-viewer-root")?.classList.contains("img-loading-error")).toBe(true);
    });

    it("marks the root loaded once the viewed image is displayable", async () => {
        const { container, dispatch } = renderViewer(makeGallery([ makeItem("a") ]));
        dispatch("ready");
        dispatch("viewed", { index: 0 });

        await vi.waitFor(() => expect(container.querySelector(".media-viewer-root")?.classList.contains("img-loaded")).toBe(true));
        expect(container.querySelector(".content-error-message")).toBeNull();
    });

    it("navigates the gallery from the document-level keys (PageDown)", async () => {
        const gallery = makeGallery([ makeItem("a"), makeItem("b") ], 0);
        renderViewer(gallery);
        // The document listener is attached in a deferred effect; keep dispatching until it is live.
        await vi.waitFor(() => {
            document.dispatchEvent(new KeyboardEvent("keydown", { code: "PageDown", bubbles: true, cancelable: true }));
            expect(gallery.navigateNext).toHaveBeenCalled();
        });
    });
});

describe("toSiblingNavigation", () => {
    it("is null for empty/single/indexless galleries and maps wrap-around neighbours otherwise", () => {
        expect(toSiblingNavigation(makeGallery([ makeItem("a") ]))).toBeNull();
        expect(toSiblingNavigation(makeGallery([ makeItem("a"), makeItem("b") ], -1))).toBeNull();

        const navigation = toSiblingNavigation(makeGallery([ makeItem("a"), makeItem("b"), makeItem("c") ], 0));
        expect(navigation).toMatchObject({ index: 1, total: 3, previousId: "c", nextId: "b" });
    });
});
