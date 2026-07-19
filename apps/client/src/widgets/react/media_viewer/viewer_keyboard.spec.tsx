import { render } from "preact";
import { useRef } from "preact/hooks";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { MediaGallery } from "./gallery";
import type { MediaViewerApi } from "./MediaViewer";
import { codeToControl, getPanDelta, useMediaViewerKeyboard } from "./viewer_keyboard";

describe("codeToControl", () => {
    it("maps zoom/reset keys (Equal/Minus/Slash, numpad, Q/E) regardless of modifiers", () => {
        expect(codeToControl("Equal")).toBe("zoomIn");
        expect(codeToControl("NumpadAdd")).toBe("zoomIn");
        expect(codeToControl("KeyE")).toBe("zoomIn");
        expect(codeToControl("Minus")).toBe("zoomOut");
        expect(codeToControl("NumpadSubtract")).toBe("zoomOut");
        expect(codeToControl("KeyQ")).toBe("zoomOut");
        expect(codeToControl("Slash")).toBe("reset");
        expect(codeToControl("NumpadDivide")).toBe("reset");
    });

    it("maps arrows and WASD to pan controls, and F to the fullscreen toggle", () => {
        expect(codeToControl("ArrowUp")).toBe("panUp");
        expect(codeToControl("KeyW")).toBe("panUp");
        expect(codeToControl("ArrowDown")).toBe("panDown");
        expect(codeToControl("KeyS")).toBe("panDown");
        expect(codeToControl("ArrowLeft")).toBe("panLeft");
        expect(codeToControl("KeyA")).toBe("panLeft");
        expect(codeToControl("ArrowRight")).toBe("panRight");
        expect(codeToControl("KeyD")).toBe("panRight");
        expect(codeToControl("KeyF")).toBe("fullscreen");
    });

    it("ignores unrelated keys", () => {
        expect(codeToControl("KeyZ")).toBeNull();
        expect(codeToControl("Space")).toBeNull();
        expect(codeToControl("Escape")).toBeNull();
    });
});

describe("getPanDelta", () => {
    it("translates the content opposite the viewed direction", () => {
        expect(getPanDelta([ "panRight" ], false, 1).dx).toBeLessThan(0);
        expect(getPanDelta([ "panLeft" ], false, 1).dx).toBeGreaterThan(0);
        expect(getPanDelta([ "panUp" ], false, 1).dy).toBeGreaterThan(0);
        expect(getPanDelta([ "panDown" ], false, 1).dy).toBeLessThan(0);
    });

    it("cancels opposing keys, scales by elapsed time, speeds up with Shift", () => {
        expect(getPanDelta([ "panLeft", "panRight" ], false, 1)).toEqual({ dx: 0, dy: 0 });
        expect(getPanDelta([ "panRight" ], false, 1).dx).toBe(getPanDelta([ "panRight" ], false, 0.5).dx * 2);
        expect(Math.abs(getPanDelta([ "panRight" ], true, 1).dx)).toBeGreaterThan(Math.abs(getPanDelta([ "panRight" ], false, 1).dx));
    });
});

function makeApi(overrides: Partial<MediaViewerApi> = {}): MediaViewerApi {
    return {
        zoomBy: vi.fn(),
        zoomTo: vi.fn(),
        fitToWindow: vi.fn(),
        actualSize: vi.fn(),
        reset: vi.fn(),
        rotate: vi.fn(),
        flipHorizontal: vi.fn(),
        moveBy: vi.fn(),
        toggleFullscreen: vi.fn(),
        isFullscreen: () => false,
        isAtFit: () => true,
        zoomPercent: () => 100,
        ...overrides
    };
}

function makeGallery(itemCount = 3): MediaGallery {
    return {
        items: Array.from({ length: itemCount }, (_item, i) => ({
            id: `n${i}`, title: `n${i}`, src: `api/images/n${i}/x`, kind: "note" as const, mime: "image/png"
        })),
        currentIndex: 0,
        surfaceKey: "s",
        navigateToIndex: vi.fn(),
        navigatePrevious: vi.fn(),
        navigateNext: vi.fn(),
        navigateFirst: vi.fn(),
        navigateLast: vi.fn()
    };
}

const mountedContainers: HTMLElement[] = [];

function renderKeyboardHost(api: MediaViewerApi, gallery: MediaGallery) {
    const container = document.createElement("div");
    document.body.appendChild(container);
    mountedContainers.push(container);
    function Host() {
        const hostRef = useRef<HTMLDivElement>(null);
        const apiRef = useRef<MediaViewerApi | null>(api);
        useMediaViewerKeyboard(apiRef, hostRef, gallery);
        return <div ref={hostRef} tabIndex={0} className="host" />;
    }
    render(<Host />, container);
    const host = container.querySelector<HTMLElement>(".host");
    if (!host) throw new Error("host missing");
    const press = (code: string, init: KeyboardEventInit = {}) => {
        const event = new KeyboardEvent("keydown", { code, bubbles: true, cancelable: true, ...init });
        host.dispatchEvent(event);
        return event;
    };
    return { host, container, press };
}

describe("useMediaViewerKeyboard", () => {
    let rafCallbacks: FrameRequestCallback[];
    beforeEach(() => {
        rafCallbacks = [];
        vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
            rafCallbacks.push(callback);
            return rafCallbacks.length;
        });
        vi.stubGlobal("cancelAnimationFrame", () => {});
    });
    afterEach(() => {
        vi.unstubAllGlobals();
        // Unmount properly so the hook's document-level Escape listener is removed between tests.
        for (const container of mountedContainers.splice(0)) render(null, container);
        document.body.innerHTML = "";
    });

    it("resets on / and toggles fullscreen on F, claiming the keys", () => {
        const api = makeApi();
        const { press } = renderKeyboardHost(api, makeGallery());

        expect(press("Slash").defaultPrevented).toBe(true);
        expect(api.reset).toHaveBeenCalledTimes(1);
        expect(press("KeyF").defaultPrevented).toBe(true);
        expect(api.toggleFullscreen).toHaveBeenCalledTimes(1);
    });

    it("pans via the RAF loop while a direction key is held", () => {
        const api = makeApi();
        const { press } = renderKeyboardHost(api, makeGallery());

        expect(press("ArrowRight").defaultPrevented).toBe(true);
        expect(rafCallbacks.length).toBeGreaterThan(0);
        rafCallbacks[0](1000);
        const next = rafCallbacks.at(-1);
        if (next) next(1016);
        const moveBy = api.moveBy as ReturnType<typeof vi.fn>;
        expect(moveBy).toHaveBeenCalled();
        expect(moveBy.mock.calls.at(-1)?.[0]).toBeLessThan(0);
    });

    it("turns horizontal arrows into gallery navigation while fullscreen at fit", () => {
        const api = makeApi({ isFullscreen: () => true, isAtFit: () => true });
        const gallery = makeGallery();
        const { press } = renderKeyboardHost(api, gallery);

        expect(press("ArrowRight").defaultPrevented).toBe(true);
        expect(gallery.navigateNext).toHaveBeenCalledTimes(1);
        press("ArrowLeft");
        expect(gallery.navigatePrevious).toHaveBeenCalledTimes(1);
        // No pan loop was started for these.
        expect(rafCallbacks).toHaveLength(0);
    });

    it("keeps horizontal arrows as pan while fullscreen but zoomed in", () => {
        const api = makeApi({ isFullscreen: () => true, isAtFit: () => false });
        const gallery = makeGallery();
        const { press } = renderKeyboardHost(api, gallery);

        press("ArrowRight");
        expect(gallery.navigateNext).not.toHaveBeenCalled();
        expect(rafCallbacks.length).toBeGreaterThan(0);
    });

    it("claims Escape only while fullscreen, exiting it", () => {
        let fulled = true;
        const api = makeApi({ isFullscreen: () => fulled, toggleFullscreen: vi.fn(() => { fulled = false; }) });
        renderKeyboardHost(api, makeGallery());

        const escape = new KeyboardEvent("keydown", { code: "Escape", bubbles: true, cancelable: true });
        document.body.dispatchEvent(escape);
        expect(api.toggleFullscreen).toHaveBeenCalledTimes(1);
        expect(escape.defaultPrevented).toBe(true);

        // Not fullscreen anymore: Escape passes through untouched (the app may use it).
        const second = new KeyboardEvent("keydown", { code: "Escape", bubbles: true, cancelable: true });
        document.body.dispatchEvent(second);
        expect(api.toggleFullscreen).toHaveBeenCalledTimes(1);
        expect(second.defaultPrevented).toBe(false);
    });
});
