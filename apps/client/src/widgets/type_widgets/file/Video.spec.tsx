import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// --- Module mocks (hoisted above the component import) --------------------------------------------

vi.mock("bootstrap", () => {
    class Tooltip {
        static instances = new Map<Element, Tooltip>();
        static getInstance(el: Element) { return Tooltip.instances.get(el) ?? null; }
        element: Element;
        config: unknown;
        constructor(el: Element, config?: unknown) { this.element = el; this.config = config; Tooltip.instances.set(el, this); }
        dispose() { Tooltip.instances.delete(this.element); }
        show() {}
        hide() {}
    }
    class Dropdown {
        static instances = new Map<Element, Dropdown>();
        static getOrCreateInstance(el: Element) {
            const existing = Dropdown.instances.get(el);
            if (existing) return existing;
            const created = new Dropdown(el);
            Dropdown.instances.set(el, created);
            return created;
        }
        element: Element;
        constructor(el: Element) { this.element = el; }
        show() {}
        hide() {}
        update() {}
        dispose() { Dropdown.instances.delete(this.element); }
    }
    return { Tooltip, Dropdown, default: { Tooltip, Dropdown } };
});
vi.mock("../../../services/open", () => ({
    getUrlForDownload: (url: string) => url
}));

import type FNote from "../../../entities/fnote";
import { buildNote } from "../../../test/easy-froca";
import VideoPreview from "./Video";

// --- Render helper --------------------------------------------------------------------------------

let container: HTMLDivElement | undefined;

function renderInto(vnode: unknown) {
    container = document.createElement("div");
    document.body.appendChild(container);
    act(() => render(vnode as never, container as HTMLDivElement));
    return container;
}

/** Build a `file`-typed note in froca so nothing tries to load from the throwing mock server. */
function videoNote(overrides: { id?: string; mime?: string } = {}): FNote {
    const note = buildNote({ id: overrides.id ?? "vid1", title: "clip", type: "file" });
    // FNote.mime is read-only via the row, so reassign for the unsupported-format branch.
    Object.defineProperty(note, "mime", { value: overrides.mime ?? "video/mp4", configurable: true });
    return note;
}

/** Find the rendered <video> element, narrowing instead of asserting non-null. */
function getVideo(root: HTMLElement): HTMLVideoElement {
    const video = root.querySelector("video");
    if (!video) throw new Error("video element not rendered");
    return video as HTMLVideoElement;
}

/** Stub the media methods happy-dom does not implement on a single element. */
function stubMediaMethods(video: HTMLVideoElement, opts: { paused?: boolean } = {}) {
    let paused = opts.paused ?? true;
    Object.defineProperty(video, "paused", { get: () => paused, configurable: true });
    video.play = vi.fn(() => { paused = false; return Promise.resolve(); });
    video.pause = vi.fn(() => { paused = true; });
    video.requestPictureInPicture = vi.fn(() => Promise.resolve({} as PictureInPictureWindow));
    video.requestFullscreen = vi.fn(() => Promise.resolve());
    return video;
}

beforeEach(() => {
    // No-op jQuery tooltip so ActionButton's useStaticTooltip never touches the real plugin.
    ($.fn as unknown as Record<string, unknown>).tooltip = vi.fn();
});

afterEach(() => {
    if (container) { act(() => render(null, container as HTMLDivElement)); container.remove(); container = undefined; }
    vi.restoreAllMocks();
});

// --- Tests ----------------------------------------------------------------------------------------

describe("VideoPreview", () => {
    it("renders the video element, control rows and all media buttons", () => {
        const root = renderInto(<VideoPreview note={videoNote()} />);

        const wrapper = root.querySelector(".video-preview-wrapper");
        expect(wrapper).toBeTruthy();
        // controls start visible (no controls-hidden class)
        expect(wrapper?.className).not.toContain("controls-hidden");

        const video = getVideo(root);
        expect(video.getAttribute("src")).toBe("api/notes/vid1/open-partial");
        expect(video.getAttribute("datatype")).toBe("video/mp4");
        expect(root.querySelector(".media-preview-controls")).toBeTruthy();
        expect(root.querySelector(".media-seekbar-row")).toBeTruthy();
        expect(root.querySelectorAll(".media-buttons-row .left button").length).toBeGreaterThanOrEqual(2);
        expect(root.querySelector(".play-button")).toBeTruthy();
    });

    it("toggles play/pause when the wrapper is clicked outside the controls", () => {
        const root = renderInto(<VideoPreview note={videoNote()} />);
        const video = stubMediaMethods(getVideo(root));

        const wrapper = root.querySelector(".video-preview-wrapper") as HTMLElement;
        act(() => wrapper.click());
        expect(video.play).toHaveBeenCalledTimes(1);

        // Now it is "playing" -> next click should pause.
        Object.defineProperty(video, "paused", { get: () => false, configurable: true });
        act(() => wrapper.click());
        expect(video.pause).toHaveBeenCalledTimes(1);
    });

    it("ignores clicks that originate inside the controls", () => {
        const root = renderInto(<VideoPreview note={videoNote()} />);
        const video = stubMediaMethods(getVideo(root));

        const controlBtn = root.querySelector(".media-preview-controls button") as HTMLElement;
        act(() => { controlBtn.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
        expect(video.play).not.toHaveBeenCalled();
    });

    it("reflects play/pause state on the video element and via the firing of events", () => {
        const root = renderInto(<VideoPreview note={videoNote()} />);
        const video = getVideo(root);

        // play event -> playing true -> auto hide controls
        act(() => { video.dispatchEvent(new Event("play")); });
        const wrapper = root.querySelector(".video-preview-wrapper");
        expect(wrapper?.className).toContain("controls-hidden");

        // pause event -> playing false -> controls visible again
        act(() => { video.dispatchEvent(new Event("pause")); });
        expect(root.querySelector(".video-preview-wrapper")?.className).not.toContain("controls-hidden");
    });

    it("shows the unsupported-format placeholder when the video errors", () => {
        const root = renderInto(<VideoPreview note={videoNote({ mime: "video/x-weird" })} />);
        act(() => { getVideo(root).dispatchEvent(new Event("error")); });

        // Video gone, NoItems shown.
        expect(root.querySelector("video")).toBeFalsy();
        expect(root.querySelector(".no-items")).toBeTruthy();
        expect(root.querySelector(".no-items .bx-video-off")).toBeTruthy();
    });
});

describe("VideoPreview - auto hide controls", () => {
    it("hides controls after the delay while playing and reveals them on mouse move", () => {
        vi.useFakeTimers();
        try {
            const root = renderInto(<VideoPreview note={videoNote()} />);
            const video = getVideo(root);
            Object.defineProperty(video, "paused", { get: () => false, configurable: true });

            const wrapper = root.querySelector(".video-preview-wrapper") as HTMLElement;

            // Mouse move resets visibility + schedules the hide timer (video not paused).
            act(() => { wrapper.dispatchEvent(new MouseEvent("mousemove", { bubbles: true })); });
            expect(wrapper.className).not.toContain("controls-hidden");

            act(() => { vi.advanceTimersByTime(3000); });
            expect(root.querySelector(".video-preview-wrapper")?.className).toContain("controls-hidden");
        } finally {
            vi.useRealTimers();
        }
    });

    it("does not schedule a hide timer when the video is paused on mouse move", () => {
        vi.useFakeTimers();
        try {
            const root = renderInto(<VideoPreview note={videoNote()} />);
            const wrapper = root.querySelector(".video-preview-wrapper") as HTMLElement;

            act(() => { wrapper.dispatchEvent(new MouseEvent("mousemove", { bubbles: true })); });
            act(() => { vi.advanceTimersByTime(5000); });
            // Paused -> stays visible.
            expect(root.querySelector(".video-preview-wrapper")?.className).not.toContain("controls-hidden");
        } finally {
            vi.useRealTimers();
        }
    });
});

describe("VideoPreview - keyboard shortcuts", () => {
    function fireKey(root: HTMLElement, key: string, init: KeyboardEventInit = {}) {
        const wrapper = root.querySelector(".video-preview-wrapper") as HTMLElement;
        const ev = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init });
        act(() => { wrapper.dispatchEvent(ev); });
        return ev;
    }

    function setupVideoMetrics(video: HTMLVideoElement, opts: { currentTime?: number; duration?: number; volume?: number; muted?: boolean } = {}) {
        let currentTime = opts.currentTime ?? 50;
        let volume = opts.volume ?? 0.5;
        let muted = opts.muted ?? false;
        Object.defineProperty(video, "currentTime", { get: () => currentTime, set: (v) => { currentTime = v; }, configurable: true });
        Object.defineProperty(video, "duration", { get: () => opts.duration ?? 120, configurable: true });
        Object.defineProperty(video, "volume", { get: () => volume, set: (v) => { volume = v; }, configurable: true });
        Object.defineProperty(video, "muted", { get: () => muted, set: (v) => { muted = v; }, configurable: true });
        return video;
    }

    it("space toggles playback and flashes controls", () => {
        const root = renderInto(<VideoPreview note={videoNote()} />);
        const video = stubMediaMethods(getVideo(root));
        const ev = fireKey(root, " ");
        expect(ev.defaultPrevented).toBe(true);
        expect(video.play).toHaveBeenCalledTimes(1);
    });

    it("ArrowLeft / ArrowRight seek by 10s, or 60s with ctrl, clamped to [0, duration]", () => {
        const root = renderInto(<VideoPreview note={videoNote()} />);
        const video = setupVideoMetrics(getVideo(root), { currentTime: 50, duration: 120 });

        fireKey(root, "ArrowLeft");
        expect(video.currentTime).toBe(40);

        fireKey(root, "ArrowRight");
        expect(video.currentTime).toBe(50);

        fireKey(root, "ArrowRight", { ctrlKey: true });
        expect(video.currentTime).toBe(110);

        // ctrl right past duration clamps to duration
        fireKey(root, "ArrowRight", { ctrlKey: true });
        expect(video.currentTime).toBe(120);

        // left below zero clamps to 0
        setupVideoMetrics(video, { currentTime: 5, duration: 120 });
        fireKey(root, "ArrowLeft");
        expect(video.currentTime).toBe(0);
    });

    it("ArrowUp / ArrowDown change the volume clamped to [0, 1]", () => {
        const root = renderInto(<VideoPreview note={videoNote()} />);
        const video = setupVideoMetrics(getVideo(root), { volume: 0.98 });

        fireKey(root, "ArrowUp");
        expect(video.volume).toBe(1); // clamped

        setupVideoMetrics(video, { volume: 0.02 });
        fireKey(root, "ArrowDown");
        expect(video.volume).toBe(0); // clamped

        setupVideoMetrics(video, { volume: 0.5 });
        fireKey(root, "ArrowUp");
        expect(video.volume).toBeCloseTo(0.55, 5);
    });

    it("m/M toggles mute", () => {
        const root = renderInto(<VideoPreview note={videoNote()} />);
        const video = setupVideoMetrics(getVideo(root), { muted: false });

        fireKey(root, "m");
        expect(video.muted).toBe(true);
        fireKey(root, "M");
        expect(video.muted).toBe(false);
    });

    it("Home / End jump to the start and end", () => {
        const root = renderInto(<VideoPreview note={videoNote()} />);
        const video = setupVideoMetrics(getVideo(root), { currentTime: 30, duration: 200 });

        fireKey(root, "Home");
        expect(video.currentTime).toBe(0);
        fireKey(root, "End");
        expect(video.currentTime).toBe(200);
    });

    it("f/F enters fullscreen and exits when already fullscreen", () => {
        const root = renderInto(<VideoPreview note={videoNote()} />);
        getVideo(root);

        const wrapper = root.querySelector(".video-preview-wrapper") as HTMLElement & { requestFullscreen: () => Promise<void> };
        wrapper.requestFullscreen = vi.fn(() => Promise.resolve());

        // No fullscreen element -> request.
        Object.defineProperty(document, "fullscreenElement", { value: null, configurable: true });
        fireKey(root, "f");
        expect(wrapper.requestFullscreen).toHaveBeenCalledTimes(1);

        // Fullscreen element present -> exit.
        Object.defineProperty(document, "fullscreenElement", { value: wrapper, configurable: true });
        document.exitFullscreen = vi.fn(() => Promise.resolve());
        fireKey(root, "F");
        expect(document.exitFullscreen).toHaveBeenCalledTimes(1);

        Object.defineProperty(document, "fullscreenElement", { value: null, configurable: true });
    });

    it("ignores unmapped keys (no preventDefault)", () => {
        const root = renderInto(<VideoPreview note={videoNote()} />);
        getVideo(root);
        const ev = fireKey(root, "z");
        expect(ev.defaultPrevented).toBe(false);
    });
});

describe("RotateButton", () => {
    function getRotateButton(root: HTMLElement): HTMLButtonElement {
        const btn = root.querySelector(".media-buttons-row .left button.bx-rotate-right");
        if (!btn) throw new Error("rotate button not rendered");
        return btn as HTMLButtonElement;
    }

    it("cycles rotation and scales down when sideways with a sized container", () => {
        const root = renderInto(<VideoPreview note={videoNote()} />);
        const video = getVideo(root);
        // Give the parent a measurable size so the ratio branch runs.
        const parent = video.parentElement as HTMLElement;
        Object.defineProperty(parent, "clientWidth", { value: 200, configurable: true });
        Object.defineProperty(parent, "clientHeight", { value: 100, configurable: true });

        const btn = getRotateButton(root);
        act(() => btn.click()); // 90 -> sideways, container present
        expect(video.style.transform).toBe("rotate(90deg) scale(0.5)");

        act(() => btn.click()); // 180 -> not sideways
        expect(video.style.transform).toBe("rotate(180deg)");

        act(() => btn.click()); // 270 -> sideways again
        expect(video.style.transform).toBe("rotate(270deg) scale(0.5)");

        act(() => btn.click()); // 360 -> 0 -> empty transform
        expect(video.style.transform).toBe("");
    });

    it("rotates without scaling when the video has no parent element", () => {
        const root = renderInto(<VideoPreview note={videoNote()} />);
        const video = getVideo(root);
        // Force the no-container branch (line 191).
        Object.defineProperty(video, "parentElement", { value: null, configurable: true });

        const btn = getRotateButton(root);
        act(() => btn.click()); // 90 -> sideways, no container
        expect(video.style.transform).toBe("rotate(90deg)");
    });
});

describe("ZoomToFitButton", () => {
    it("toggles object-fit and the active class", () => {
        const root = renderInto(<VideoPreview note={videoNote()} />);
        const video = getVideo(root);
        const btn = root.querySelector(".media-buttons-row .right button.bx-expand") as HTMLButtonElement;
        expect(btn).toBeTruthy();

        act(() => btn.click());
        expect(video.style.objectFit).toBe("cover");
        expect(root.querySelector(".media-buttons-row .right button.bx-collapse")?.classList.contains("active")).toBe(true);

        const collapseBtn = root.querySelector(".media-buttons-row .right button.bx-collapse") as HTMLButtonElement;
        act(() => collapseBtn.click());
        expect(video.style.objectFit).toBe("");
    });
});

describe("FullscreenButton", () => {
    function getFullscreenButton(root: HTMLElement): HTMLButtonElement | null {
        return root.querySelector(".media-buttons-row .right button.bx-fullscreen") as HTMLButtonElement | null;
    }

    it("requests fullscreen on the wrapper and reacts to fullscreenchange", () => {
        const root = renderInto(<VideoPreview note={videoNote()} />);
        const wrapper = root.querySelector(".video-preview-wrapper") as HTMLElement & { requestFullscreen: () => Promise<void> };
        wrapper.requestFullscreen = vi.fn(() => Promise.resolve());

        const btn = getFullscreenButton(root);
        expect(btn).toBeTruthy();

        Object.defineProperty(document, "fullscreenElement", { value: null, configurable: true });
        act(() => btn?.click());
        expect(wrapper.requestFullscreen).toHaveBeenCalledTimes(1);

        // Simulate entering fullscreen -> icon flips to exit-fullscreen.
        Object.defineProperty(document, "fullscreenElement", { value: wrapper, configurable: true });
        act(() => { document.dispatchEvent(new Event("fullscreenchange")); });
        expect(root.querySelector(".media-buttons-row .right button.bx-exit-fullscreen")).toBeTruthy();

        // Now exit via the button.
        document.exitFullscreen = vi.fn(() => Promise.resolve());
        const exitBtn = root.querySelector(".media-buttons-row .right button.bx-exit-fullscreen") as HTMLButtonElement;
        act(() => exitBtn.click());
        expect(document.exitFullscreen).toHaveBeenCalledTimes(1);

        Object.defineProperty(document, "fullscreenElement", { value: null, configurable: true });
        act(() => { document.dispatchEvent(new Event("fullscreenchange")); });
    });
});

describe("PictureInPictureButton", () => {
    it("renders nothing when the API is unsupported", () => {
        const proto = HTMLVideoElement.prototype as unknown as Record<string, unknown>;
        const had = "requestPictureInPicture" in proto;
        const original = proto.requestPictureInPicture;
        delete proto.requestPictureInPicture;
        try {
            const root = renderInto(<VideoPreview note={videoNote()} />);
            getVideo(root);
            expect(root.querySelector(".media-buttons-row .right button.bx-window-open")).toBeFalsy();
        } finally {
            if (had) proto.requestPictureInPicture = original;
        }
    });

    it("toggles picture-in-picture and updates its icon on enter/leave events", () => {
        const proto = HTMLVideoElement.prototype as unknown as Record<string, unknown>;
        const had = "requestPictureInPicture" in proto;
        if (!had) proto.requestPictureInPicture = function () { return Promise.resolve({}); };
        try {
            const root = renderInto(<VideoPreview note={videoNote()} />);
            const video = stubMediaMethods(getVideo(root));

            const btn = root.querySelector(".media-buttons-row .right button.bx-window-open") as HTMLButtonElement;
            expect(btn).toBeTruthy();

            // No PiP element -> request.
            Object.defineProperty(document, "pictureInPictureElement", { value: null, configurable: true });
            act(() => btn.click());
            expect(video.requestPictureInPicture).toHaveBeenCalledTimes(1);

            // Entering PiP flips the icon.
            act(() => { video.dispatchEvent(new Event("enterpictureinpicture")); });
            const exitBtn = root.querySelector(".media-buttons-row .right button.bx-exit") as HTMLButtonElement;
            expect(exitBtn).toBeTruthy();

            // With a PiP element active, clicking exits.
            Object.defineProperty(document, "pictureInPictureElement", { value: video, configurable: true });
            document.exitPictureInPicture = vi.fn(() => Promise.resolve());
            act(() => exitBtn.click());
            expect(document.exitPictureInPicture).toHaveBeenCalledTimes(1);

            // Leaving PiP flips the icon back.
            act(() => { video.dispatchEvent(new Event("leavepictureinpicture")); });
            expect(root.querySelector(".media-buttons-row .right button.bx-window-open")).toBeTruthy();

            Object.defineProperty(document, "pictureInPictureElement", { value: null, configurable: true });
        } finally {
            if (!had) delete proto.requestPictureInPicture;
        }
    });
});
