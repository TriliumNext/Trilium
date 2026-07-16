import { render } from "preact";
import { afterEach, beforeEach, describe, expect, it, type Mock, vi } from "vitest";

interface FakeSlide {
    src: string;
    alt?: string;
    width?: number;
    height?: number;
}

interface FakeLightboxProps {
    slides: FakeSlide[];
    index: number;
    plugins: unknown[];
    carousel: { finite: boolean; preload: number };
    animation: { fade: number; swipe: number; zoom: number };
    zoom: { ref?: unknown } & Record<string, unknown>;
    thumbnails: Record<string, unknown>;
    toolbar: { buttons: unknown[] };
    controller: Record<string, unknown>;
    on: { view: (props: { index: number }) => void; zoom: () => void };
}

interface ZoomStub {
    zoom: number;
    minZoom: number;
    maxZoom: number;
    offsetX: number;
    offsetY: number;
    disabled: boolean;
    zoomIn: Mock;
    zoomOut: Mock;
    changeZoom: Mock;
}

// The real lightbox measures layout and loads images, so unit tests swap it for a fake that
// captures the props contract, exposes controllable plugin refs, and mimics the lightbox's
// behavior of firing `on.view` on mount and whenever the controlled index changes.
const { lightbox } = vi.hoisted(() => ({
    lightbox: {
        props: null as FakeLightboxProps | null,
        mounts: 0,
        zoom: null as ZoomStub | null
    }
}));

vi.mock("yet-another-react-lightbox", async () => {
    const { h } = await import("preact");
    const { useLayoutEffect } = await import("preact/hooks");
    const assignForwardedRef = (ref: unknown, value: unknown) => {
        if (typeof ref === "function") ref(value);
        else if (ref && typeof ref === "object") (ref as { current: unknown }).current = value;
    };
    function FakeLightbox(props: FakeLightboxProps) {
        lightbox.props = props;
        assignForwardedRef(props.zoom?.ref, lightbox.zoom);
        useLayoutEffect(() => {
            lightbox.mounts += 1;
        }, []);
        useLayoutEffect(() => {
            props.on.view({ index: props.index });
        }, [ props.on, props.index ]);
        const slide = props.slides[props.index];
        return h(
            "div",
            { className: "yarl__root" },
            h("div", { className: "yarl__slide_current" },
                slide ? h("img", { className: "yarl__slide_image", src: slide.src, alt: slide.alt }) : null)
        );
    }
    return { default: FakeLightbox };
});
vi.mock("yet-another-react-lightbox/plugins/inline", () => ({ default: { name: "inline" } }));
vi.mock("yet-another-react-lightbox/plugins/thumbnails", () => ({ default: { name: "thumbnails" } }));
vi.mock("yet-another-react-lightbox/plugins/zoom", () => ({ default: { name: "zoom" } }));
vi.mock("./orientation", async (importOriginal) => {
    const original = await importOriginal<typeof import("./orientation")>();
    return { ...original, renderOrientedImage: vi.fn() };
});
vi.mock("../hooks", () => ({ useStaticTooltip: () => {}, useTriliumEvent: () => {} }));

import type { MediaGallery, MediaViewerItem } from "./gallery";
import MediaViewer, { type MediaViewerApi, toSiblingNavigation } from "./MediaViewer";
import { renderOrientedImage } from "./orientation";

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
    slideImage: () => HTMLImageElement;
    settleImage: () => void;
}

const mountedContainers: HTMLElement[] = [];

function renderViewer(gallery: MediaGallery, isVisible = true): RenderedViewer {
    const container = document.createElement("div");
    mountedContainers.push(container);
    const api: { current: MediaViewerApi | null } = { current: null };
    const doRender = (nextGallery: MediaGallery, nextVisible = true) =>
        render(<MediaViewer gallery={nextGallery} isVisible={nextVisible} apiRef={api} />, container);
    doRender(gallery, isVisible);
    const slideImage = () => {
        // While fullscreen the root is reparented under <body>, so fall back to the document.
        const selector = ".media-viewer-root .yarl__slide_current img";
        const img = container.querySelector<HTMLImageElement>(selector) ?? document.querySelector<HTMLImageElement>(selector);
        if (!img) throw new Error("slide image missing");
        return img;
    };
    return {
        container,
        api,
        rerender: doRender,
        slideImage,
        settleImage: () => slideImage().dispatchEvent(new Event("load"))
    };
}

/** Gives the current slide image deterministic dimensions for the DOM-measured zoom readout. */
function measureImage(image: HTMLImageElement, naturalWidth: number, renderedWidth: number) {
    Object.defineProperty(image, "naturalWidth", { value: naturalWidth, configurable: true });
    Object.defineProperty(image, "naturalHeight", { value: naturalWidth, configurable: true });
    image.getBoundingClientRect = () =>
        ({ width: renderedWidth, height: renderedWidth, top: 0, left: 0, right: renderedWidth, bottom: renderedWidth, x: 0, y: 0, toJSON: () => ({}) }) as DOMRect;
}

describe("MediaViewer", () => {
    let originalDecode: typeof HTMLImageElement.prototype.decode;
    beforeEach(() => {
        lightbox.props = null;
        lightbox.mounts = 0;
        lightbox.zoom = {
            zoom: 1,
            minZoom: 1,
            maxZoom: 64,
            offsetX: 0,
            offsetY: 0,
            disabled: false,
            zoomIn: vi.fn(),
            zoomOut: vi.fn(),
            changeZoom: vi.fn()
        };
        vi.mocked(renderOrientedImage).mockReset();
        originalDecode = HTMLImageElement.prototype.decode;
        HTMLImageElement.prototype.decode = () => Promise.resolve();
    });
    afterEach(() => {
        HTMLImageElement.prototype.decode = originalDecode;
        // Unmount properly — a stale document-level key listener from a previous test would
        // preventDefault() the event and starve the listener under test.
        for (const container of mountedContainers.splice(0)) render(null, container);
    });

    it("configures the lightbox with the Trilium contract: our chrome, no animations, lazy gallery", () => {
        renderViewer(makeGallery([ makeItem("a", "One two.png"), makeItem("b") ], 1));
        const props = lightbox.props;
        expect(props).not.toBeNull();
        expect(props?.slides).toEqual([
            { src: "api/images/a/One two.png?v=blob-a", alt: "One two.png" },
            { src: "api/images/b/b?v=blob-b", alt: "b" }
        ]);
        expect(props?.index).toBe(1);
        // The thumbnail strip mounts only in fullscreen — a mounted strip (even hidden) eagerly
        // loads every gallery image.
        expect(props?.plugins).toHaveLength(2);
        expect(props?.carousel).toMatchObject({ finite: false, preload: 1 });
        expect(props?.animation).toEqual({ fade: 0, swipe: 0, zoom: 0 });
        expect(props?.zoom).toMatchObject({ scrollToZoom: true });
        expect(props?.thumbnails).toMatchObject({ position: "bottom" });
        expect(props?.toolbar).toEqual({ buttons: [] });
        expect(props?.controller).toMatchObject({ focus: false });
        // A single-image gallery must not loop.
        renderViewer(makeGallery([ makeItem("solo") ]));
        expect(lightbox.props?.carousel).toMatchObject({ finite: true });
    });

    it("passes the gallery index down and does not echo the resulting view callback into navigation", () => {
        const items = [ makeItem("a"), makeItem("b"), makeItem("c") ];
        const gallery = makeGallery(items, 0);
        const { rerender } = renderViewer(gallery);
        expect(lightbox.props?.index).toBe(0);

        const next = makeGallery(items, 2);
        rerender(next);
        expect(lightbox.props?.index).toBe(2);
        // The fake fired on.view({index: 2}) after the prop change — an echo, not user navigation.
        expect(next.navigateToIndex).not.toHaveBeenCalled();
        expect(gallery.navigateToIndex).not.toHaveBeenCalled();
    });

    it("syncs lightbox-internal navigation (swipe, thumbnail click) back into app navigation", () => {
        const gallery = makeGallery([ makeItem("a"), makeItem("b") ], 0);
        renderViewer(gallery);

        lightbox.props?.on.view({ index: 1 });
        expect(gallery.navigateToIndex).toHaveBeenCalledWith(1);

        gallery.navigateToIndex.mockClear();
        lightbox.props?.on.view({ index: 0 });
        expect(gallery.navigateToIndex).not.toHaveBeenCalled();
    });

    it("marks the root loaded once the viewed image is displayable", async () => {
        const { container, settleImage } = renderViewer(makeGallery([ makeItem("a") ]));
        settleImage();
        await vi.waitFor(() => expect(container.querySelector(".media-viewer-root")?.classList.contains("img-loaded")).toBe(true));
        expect(container.querySelector(".content-error-message")).toBeNull();
        // The toolbar only appears once the image is displayable.
        expect(container.querySelector(".media-viewer-toolbar")).not.toBeNull();
    });

    it("shows the error overlay when the viewed image truly fails to load", async () => {
        HTMLImageElement.prototype.decode = () => Promise.reject(new Error("broken"));
        const { container, settleImage } = renderViewer(makeGallery([ makeItem("a") ]));
        settleImage();
        await vi.waitFor(() => expect(container.querySelector(".content-error-message")).not.toBeNull());
        expect(container.querySelector(".media-viewer-root")?.classList.contains("img-loading-error")).toBe(true);
    });

    it("measures the zoom readout off the DOM and flags large zoom beyond 4x native resolution", async () => {
        const { container, api, slideImage } = renderViewer(makeGallery([ makeItem("a") ]));
        const hasLargeZoomClass = () => container.querySelector(".media-viewer-root")?.classList.contains("tn-image-large-zoom");

        measureImage(slideImage(), 100, 400);
        lightbox.props?.on.zoom();
        await vi.waitFor(() => expect(api.current?.zoomPercent()).toBe(400));
        expect(hasLargeZoomClass()).toBe(false);

        measureImage(slideImage(), 100, 450);
        lightbox.props?.on.zoom();
        await vi.waitFor(() => expect(hasLargeZoomClass()).toBe(true));
        expect(api.current?.zoomPercent()).toBe(450);
    });

    it("maps the zoom api onto changeZoom with the fit-scale conversion", () => {
        const { api, slideImage } = renderViewer(makeGallery([ makeItem("a") ]));
        const changeZoom = lightbox.zoom?.changeZoom as Mock;
        // Fit renders the 800px-wide image at 400px → fit scale 0.5 native.
        measureImage(slideImage(), 800, 400);

        api.current?.zoomBy(0.2);
        expect(changeZoom).toHaveBeenLastCalledWith(1.2, true, undefined, undefined);

        api.current?.zoomTo(1.5);
        expect(changeZoom).toHaveBeenLastCalledWith(3, true);

        api.current?.actualSize();
        expect(changeZoom).toHaveBeenLastCalledWith(2, true);

        api.current?.fitToWindow();
        expect(changeZoom).toHaveBeenLastCalledWith(1, true);

        expect(api.current?.isAtFit()).toBe(true);
        if (lightbox.zoom) lightbox.zoom.zoom = 2;
        expect(api.current?.isAtFit()).toBe(false);
    });

    it("pans through an alternating zoom jiggle that carries the offsets on the anchor", () => {
        const { api } = renderViewer(makeGallery([ makeItem("a") ]));
        const changeZoom = lightbox.zoom?.changeZoom as Mock;

        // At fit there is nothing to pan.
        api.current?.moveBy(10, 0);
        expect(changeZoom).not.toHaveBeenCalled();

        if (lightbox.zoom) lightbox.zoom.zoom = 3;
        api.current?.moveBy(10, -5);
        expect(changeZoom).toHaveBeenCalledTimes(1);
        const [ firstTarget, rapid, anchorX, anchorY ] = changeZoom.mock.calls[0];
        expect(firstTarget).toBeCloseTo(3 * 0.999, 10);
        expect(rapid).toBe(true);
        expect(Number.isFinite(anchorX)).toBe(true);
        expect(Number.isFinite(anchorY)).toBe(true);
        // The internally-subtracted anchor delta must resolve to the requested pan.
        const factor = 1 / 3 - 1 / firstTarget;
        expect(-anchorX * factor).toBeCloseTo(10, 6);
        expect(-anchorY * factor).toBeCloseTo(-5, 6);

        // The next call returns to the gesture's base level so the zoom never drifts, and the
        // factor is computed against the level being left, not a possibly-stale ref read.
        api.current?.moveBy(10, 0);
        const [ secondTarget, , secondAnchorX ] = changeZoom.mock.calls[1];
        expect(secondTarget).toBe(3);
        const secondFactor = 1 / (3 * 0.999) - 1 / 3;
        expect(-secondAnchorX * secondFactor).toBeCloseTo(10, 6);

        // Zooming through the api starts a fresh pan gesture at the new level.
        if (lightbox.zoom) lightbox.zoom.zoom = 5;
        api.current?.zoomBy(0.2);
        api.current?.moveBy(10, 0);
        const [ thirdTarget ] = changeZoom.mock.calls[3];
        expect(thirdTarget).toBeCloseTo(5 * 0.999, 10);
    });

    it("rotates and flips by swapping the slide for an oriented bitmap, reset on navigation", async () => {
        const release = vi.fn();
        vi.mocked(renderOrientedImage).mockResolvedValue({ url: "blob:oriented-1", width: 600, height: 800, release });
        const gallery = makeGallery([ makeItem("a"), makeItem("b") ], 0);
        const { api } = renderViewer(gallery);

        api.current?.rotate(90);
        expect(renderOrientedImage).toHaveBeenCalledWith(
            "api/images/a/a?v=blob-a",
            { quarterTurns: 1, flipX: false }
        );
        await vi.waitFor(() => {
            expect(lightbox.props?.slides[0]).toEqual({ src: "blob:oriented-1", alt: "a", width: 600, height: 800 });
        });
        // The other slide stays untouched.
        expect(lightbox.props?.slides[1]).toEqual({ src: "api/images/b/b?v=blob-b", alt: "b" });

        // Rotating again composes on the current orientation.
        api.current?.rotate(90);
        expect(renderOrientedImage).toHaveBeenLastCalledWith(
            "api/images/a/a?v=blob-a",
            { quarterTurns: 2, flipX: false }
        );

        // Navigating to another item discards the transient orientation and releases the bitmap.
        lightbox.props?.on.view({ index: 1 });
        await vi.waitFor(() => expect(release).toHaveBeenCalled());
        expect(lightbox.props?.slides[0]).toEqual({ src: "api/images/a/a?v=blob-a", alt: "a" });
    });

    it("flips what the user sees and clears orientation on reset()", async () => {
        const release = vi.fn();
        vi.mocked(renderOrientedImage).mockResolvedValue({ url: "blob:flipped", width: 800, height: 600, release });
        const { api } = renderViewer(makeGallery([ makeItem("a") ]));

        api.current?.flipHorizontal();
        expect(renderOrientedImage).toHaveBeenCalledWith(
            "api/images/a/a?v=blob-a",
            { quarterTurns: 0, flipX: true }
        );
        await vi.waitFor(() => expect(lightbox.props?.slides[0].src).toBe("blob:flipped"));

        const changeZoom = lightbox.zoom?.changeZoom as Mock;
        api.current?.reset();
        expect(changeZoom).toHaveBeenLastCalledWith(1, true);
        await vi.waitFor(() => expect(release).toHaveBeenCalled());
        expect(lightbox.props?.slides[0].src).toBe("api/images/a/a?v=blob-a");
    });

    it("toggles fullscreen: root reparents under <body> and the thumbnail strip follows", async () => {
        const { api, container } = renderViewer(makeGallery([ makeItem("a"), makeItem("b") ]));
        const rootEl = () => container.querySelector(".media-viewer-root") ?? document.querySelector(".media-viewer-root");

        api.current?.toggleFullscreen();
        expect(api.current?.isFullscreen()).toBe(true);
        await vi.waitFor(() => expect(rootEl()?.classList.contains("media-viewer-fulled")).toBe(true));
        // The thumbnail strip plugin mounts only while fullscreen.
        expect(lightbox.props?.plugins).toHaveLength(3);
        // Reparented to <body> while fullscreen — ancestor stacking contexts (panes, sidebars)
        // would otherwise paint above the fixed viewer.
        expect(rootEl()?.parentElement).toBe(document.body);

        api.current?.toggleFullscreen();
        expect(api.current?.isFullscreen()).toBe(false);
        await vi.waitFor(() => expect(rootEl()?.classList.contains("media-viewer-fulled")).toBe(false));
        expect(lightbox.props?.plugins).toHaveLength(2);
        expect(rootEl()?.parentElement).toBe(container);
    });

    it("does not mount thumbnails for a single-image gallery", async () => {
        const { api, container } = renderViewer(makeGallery([ makeItem("a") ]));
        api.current?.toggleFullscreen();
        expect(api.current?.isFullscreen()).toBe(true);
        await vi.waitFor(() =>
            expect(document.querySelector(".media-viewer-root.media-viewer-fulled") ?? container.querySelector(".media-viewer-fulled")).not.toBeNull());
        expect(lightbox.props?.plugins).toHaveLength(2);
    });

    it("abandons fullscreen when the gallery surface changes (lightbox is remounted)", async () => {
        const items = [ makeItem("a"), makeItem("b") ];
        const { api, container, rerender } = renderViewer(makeGallery(items));
        api.current?.toggleFullscreen();
        await vi.waitFor(() => expect(document.querySelector("body > .media-viewer-root")).not.toBeNull());
        expect(lightbox.mounts).toBe(1);

        rerender({ ...makeGallery(items), surfaceKey: "note-gallery:other/parent" });
        // The stale fullscreen presentation must not survive: root back home, class cleared.
        await vi.waitFor(() => {
            const root = container.querySelector(".media-viewer-root");
            expect(root).not.toBeNull();
            expect(root?.classList.contains("media-viewer-fulled")).toBe(false);
        });
        expect(document.querySelector("body > .media-viewer-root")).toBeNull();
        expect(lightbox.mounts).toBe(2);
    });

    it("exits fullscreen when the widget stops being visible (note switch, closed popup)", async () => {
        const gallery = makeGallery([ makeItem("a") ]);
        const { api, container, rerender } = renderViewer(gallery);
        api.current?.toggleFullscreen();
        expect(api.current?.isFullscreen()).toBe(true);

        rerender(gallery, false);
        expect(api.current?.isFullscreen()).toBe(false);
        await vi.waitFor(() => expect(container.querySelector(".media-viewer-root")).not.toBeNull());
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
