import { type ComponentChildren, render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import appContext from "../../components/app_context";
import Component from "../../components/component";
import { collectShortcutHints } from "../../services/shortcut_hints";
import { ParentComponent } from "./react_utils";

// Capture the props handed to the zoom library without mounting it (it needs real layout).
const { transformWrapperSpy } = vi.hoisted(() => ({ transformWrapperSpy: vi.fn() }));

vi.mock("react-zoom-pan-pinch", () => ({
    TransformWrapper: (props: { children?: ComponentChildren }) => {
        transformWrapperSpy(props);
        return props.children;
    },
    // Surface the dynamic wrapper class so tests can observe the loaded/load-error state.
    TransformComponent: (props: { children?: ComponentChildren; wrapperClass?: string }) => (
        <div className={props.wrapperClass}>{props.children}</div>
    )
}));

// Keep the real hooks (useContextualShortcutHints is exercised below), but stub the bootstrap-Tooltip
// one, which needs real layout.
vi.mock("./hooks", async (importOriginal) => ({
    ...(await importOriginal<typeof import("./hooks")>()),
    useStaticTooltip: () => {}
}));

import ImageViewer, { evaluateImageZoom } from "./ImageViewer";

function renderViewer(props: Parameters<typeof ImageViewer>[0]) {
    const container = document.createElement("div");
    render(<ImageViewer {...props} />, container);
    return container;
}

describe("ImageViewer", () => {
    // The viewer reveals via HTMLImageElement.decode(); stub it so both paths are deterministic
    // (happy-dom does no real image loading). Default resolves so the timer never lingers.
    let originalDecode: typeof HTMLImageElement.prototype.decode;
    beforeEach(() => {
        transformWrapperSpy.mockClear();
        originalDecode = HTMLImageElement.prototype.decode;
        HTMLImageElement.prototype.decode = () => Promise.resolve();
    });
    afterEach(() => {
        HTMLImageElement.prototype.decode = originalDecode;
    });

    it("renders the image with the given src, alt and class", () => {
        const container = renderViewer({ src: "api/images/abc/Pic", imgClassName: "note-detail-image-view", alt: "Pic" });
        const img = container.querySelector("img");
        expect(img).not.toBeNull();
        expect(img?.getAttribute("src")).toBe("api/images/abc/Pic");
        expect(img?.getAttribute("alt")).toBe("Pic");
        expect(img?.className).toBe("note-detail-image-view");
    });

    it("registers its contextual shortcut hints on the host component", () => {
        const host = new Component();
        const container = document.createElement("div");
        act(() => render(
            <ParentComponent.Provider value={host}><ImageViewer src="x" /></ParentComponent.Provider>,
            container
        ));

        const sections = collectShortcutHints(host);
        expect(sections).toHaveLength(3);
        expect(sections[0].hints.map(h => h.labelKey)).toEqual([
            "image_viewer.hints.zoom_in",
            "image_viewer.hints.zoom_out",
            "image_viewer.hints.reset_zoom"
        ]);
        expect(sections[1].hints.map(h => h.labelKey)).toEqual([
            "image_viewer.hints.pan_up",
            "image_viewer.hints.pan_down",
            "image_viewer.hints.pan_left",
            "image_viewer.hints.pan_right",
            "image_viewer.hints.pan_fast"
        ]);
        expect(sections[2].hints.map(h => h.labelKey)).toEqual([
            "image_viewer.hints.next_image",
            "image_viewer.hints.previous_image",
            "image_viewer.hints.first_image",
            "image_viewer.hints.last_image"
        ]);
    });

    it("registers nothing on the app root, whose hints would be collected in every context", () => {
        // A standalone Preact root mounted by the content renderer is hosted by appContext itself, and
        // every chain the dispatcher walks ends there — so its hints would join every other widget's.
        const container = document.createElement("div");
        act(() => render(
            <ParentComponent.Provider value={appContext}><ImageViewer src="x" /></ParentComponent.Provider>,
            container
        ));

        expect(collectShortcutHints(appContext)).toEqual([]);
    });

    it("wires up the interactive zoom behavior", () => {
        renderViewer({ src: "x" });
        const props = transformWrapperSpy.mock.calls[0][0];
        expect(props.centerOnInit).toBe(true);
        expect(props.centerZoomedOut).toBe(true);
        expect(props.autoAlignment).toEqual({ disabled: true });
        expect(props.doubleClick).toEqual({ mode: "reset" });
        // Numeric envelope is user-tunable — assert sane relationships, not exact values.
        expect(props.maxScale).toBeGreaterThan(props.minScale);
        expect(props.wheel.step).toBeGreaterThan(0);
    });

    it("lets minScale and maxScale be overridden", () => {
        renderViewer({ src: "x", minScale: 1, maxScale: 8 });
        const props = transformWrapperSpy.mock.calls[0][0];
        expect(props.minScale).toBe(1);
        expect(props.maxScale).toBe(8);
    });

    const wrapperClassList = (container: HTMLElement) => container.querySelector(".image-viewer-viewport")?.classList;

    it("starts hidden — image not yet revealed, neither loaded nor failed, no zoom controls", () => {
        // decode() resolves on a microtask, so synchronously after render the image is still hidden.
        const container = renderViewer({ src: "x" });
        expect(wrapperClassList(container)?.contains("img-loaded")).toBe(false);
        expect(wrapperClassList(container)?.contains("img-loading-error")).toBe(false);
        // The image is present (so it can fade in) but the controls wait until it has loaded.
        expect(container.querySelector("img")).not.toBeNull();
        expect(container.querySelector(".image-viewer-controls")).toBeNull();
    });

    it("reveals the image and its zoom controls once it decodes", async () => {
        const container = renderViewer({ src: "x" });

        await vi.waitFor(() => expect(wrapperClassList(container)?.contains("img-loaded")).toBe(true));
        expect(wrapperClassList(container)?.contains("img-loading-error")).toBe(false);
        expect(container.querySelector(".image-viewer-controls")).not.toBeNull();
        expect(container.querySelector(".content-error-message")).toBeNull();
    });

    it("tints the viewport red and shows an error message, keeping the image hidden, when decoding fails", async () => {
        HTMLImageElement.prototype.decode = () => Promise.reject(new Error("decode failed"));
        const container = renderViewer({ src: "x" });

        await vi.waitFor(() => expect(wrapperClassList(container)?.contains("img-loading-error")).toBe(true));
        expect(wrapperClassList(container)?.contains("img-loaded")).toBe(false);
        expect(container.querySelector(".image-viewer-controls")).toBeNull();
        expect(container.querySelector(".content-error-message")).not.toBeNull();
    });

    it("reveals without decode() where the API is unavailable (ancient/headless runtimes)", async () => {
        (HTMLImageElement.prototype as { decode?: () => Promise<void> }).decode = undefined;
        const container = renderViewer({ src: "x" });

        await vi.waitFor(() => expect(wrapperClassList(container)?.contains("img-loaded")).toBe(true));
        expect(wrapperClassList(container)?.contains("img-loading-error")).toBe(false);
    });

    it("reveals an image that loaded even when decode() rejects (e.g. Chrome Android memory limits)", async () => {
        // A large image can load fine yet have decode() reject; only a true load failure has naturalWidth 0.
        HTMLImageElement.prototype.decode = () => Promise.reject(new Error("EncodingError"));
        const completeSpy = vi.spyOn(HTMLImageElement.prototype, "complete", "get").mockReturnValue(true);
        const naturalWidthSpy = vi.spyOn(HTMLImageElement.prototype, "naturalWidth", "get").mockReturnValue(4000);
        try {
            const container = renderViewer({ src: "x" });

            await vi.waitFor(() => expect(wrapperClassList(container)?.contains("img-loaded")).toBe(true));
            expect(wrapperClassList(container)?.contains("img-loading-error")).toBe(false);
            expect(container.querySelector(".content-error-message")).toBeNull();
        } finally {
            completeSpy.mockRestore();
            naturalWidthSpy.mockRestore();
        }
    });
});

describe("evaluateImageZoom", () => {
    const img = (naturalWidth: number, clientWidth: number) => ({ naturalWidth, clientWidth });

    it("is pannable only once zoomed past the fitted size", () => {
        expect(evaluateImageZoom(0.5, img(800, 800)).pannable).toBe(false);
        expect(evaluateImageZoom(1, img(800, 800)).pannable).toBe(false);
        expect(evaluateImageZoom(1.5, img(800, 800)).pannable).toBe(true);
    });

    it("goes crisp only past 4x native for a downscaled image", () => {
        // native 4000 fitted to 800 => 1x native at scale 5, exactly 4x native at scale 20
        expect(evaluateImageZoom(5, img(4000, 800)).largeZoom).toBe(false);
        expect(evaluateImageZoom(20, img(4000, 800)).largeZoom).toBe(false);
        expect(evaluateImageZoom(21, img(4000, 800)).largeZoom).toBe(true);
    });

    it("goes crisp past 4x scale for an image shown at native size", () => {
        // native 200 shown at 200 => exactly 4x native at scale 4
        expect(evaluateImageZoom(4, img(200, 200)).largeZoom).toBe(false);
        expect(evaluateImageZoom(5, img(200, 200)).largeZoom).toBe(true);
    });

    it("never goes crisp when the image is missing or not yet loaded", () => {
        expect(evaluateImageZoom(50, null).largeZoom).toBe(false);
        expect(evaluateImageZoom(50, img(0, 800)).largeZoom).toBe(false);
    });

    it("reports on-screen size relative to native resolution", () => {
        expect(evaluateImageZoom(1, img(800, 800)).nativeScale).toBe(1);
        expect(evaluateImageZoom(5, img(4000, 800)).nativeScale).toBe(1); // 0.2x fit, 1x native at scale 5
        expect(evaluateImageZoom(50, null).nativeScale).toBe(0);
    });
});
