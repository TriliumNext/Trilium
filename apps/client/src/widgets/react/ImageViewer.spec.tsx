import { type ComponentChildren, render } from "preact";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

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

// Avoid pulling the real hooks module (bootstrap tooltips + app context) into the test.
vi.mock("./hooks", () => ({ useStaticTooltip: () => {} }));

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
