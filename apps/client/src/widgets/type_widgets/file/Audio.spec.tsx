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
import AudioPreview from "./Audio";

// --- Render helper --------------------------------------------------------------------------------

let container: HTMLDivElement | undefined;

function renderInto(vnode: unknown) {
    container = document.createElement("div");
    document.body.appendChild(container);
    act(() => render(vnode as never, container as HTMLDivElement));
    return container;
}

/** Build a `file`-typed note in froca so nothing tries to load from the throwing mock server. */
function audioNote(overrides: { id?: string; mime?: string } = {}): FNote {
    const note = buildNote({ id: overrides.id ?? "aud1", title: "clip", type: "file" });
    // FNote.mime is read-only via the row, so reassign for the unsupported-format branch.
    Object.defineProperty(note, "mime", { value: overrides.mime ?? "audio/mpeg", configurable: true });
    return note;
}

/** Find the rendered <audio> element, narrowing instead of asserting non-null. */
function getAudio(root: HTMLElement): HTMLAudioElement {
    const audio = root.querySelector("audio");
    if (!audio) throw new Error("audio element not rendered");
    return audio as HTMLAudioElement;
}

/** Stub the media methods happy-dom does not implement on a single element. */
function stubMediaMethods(audio: HTMLAudioElement, opts: { paused?: boolean } = {}) {
    let paused = opts.paused ?? true;
    Object.defineProperty(audio, "paused", { get: () => paused, configurable: true });
    audio.play = vi.fn(() => { paused = false; return Promise.resolve(); });
    audio.pause = vi.fn(() => { paused = true; });
    return audio;
}

function setupAudioMetrics(audio: HTMLAudioElement, opts: { currentTime?: number; duration?: number; volume?: number; muted?: boolean } = {}) {
    let currentTime = opts.currentTime ?? 50;
    let volume = opts.volume ?? 0.5;
    let muted = opts.muted ?? false;
    Object.defineProperty(audio, "currentTime", { get: () => currentTime, set: (v) => { currentTime = v; }, configurable: true });
    Object.defineProperty(audio, "duration", { get: () => opts.duration ?? 120, configurable: true });
    Object.defineProperty(audio, "volume", { get: () => volume, set: (v) => { volume = v; }, configurable: true });
    Object.defineProperty(audio, "muted", { get: () => muted, set: (v) => { muted = v; }, configurable: true });
    return audio;
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

describe("AudioPreview", () => {
    it("renders the audio element, icon and all control rows / buttons", () => {
        const root = renderInto(<AudioPreview note={audioNote()} />);

        const wrapper = root.querySelector(".audio-preview-wrapper");
        expect(wrapper).toBeTruthy();
        expect(wrapper?.getAttribute("tabindex")).toBe("0");

        const audio = getAudio(root);
        expect(audio.getAttribute("src")).toBe("api/notes/aud1/open-partial");
        expect(audio.classList.contains("audio-preview")).toBe(true);

        expect(root.querySelector(".audio-preview-icon-wrapper .audio-preview-icon.bx-music")).toBeTruthy();
        expect(root.querySelector(".media-preview-controls")).toBeTruthy();
        expect(root.querySelector(".media-seekbar-row")).toBeTruthy();
        // playback speed (left), 2 skip + play (center), volume (right)
        expect(root.querySelector(".media-buttons-row .left button")).toBeTruthy();
        expect(root.querySelectorAll(".media-buttons-row .center button").length).toBeGreaterThanOrEqual(3);
        expect(root.querySelector(".media-buttons-row .right button")).toBeTruthy();
        expect(root.querySelector(".play-button")).toBeTruthy();
    });

    it("toggles playback via the togglePlayback callback (play then pause)", () => {
        const root = renderInto(<AudioPreview note={audioNote()} />);
        const audio = stubMediaMethods(getAudio(root));

        const playBtn = root.querySelector(".play-button") as HTMLButtonElement;
        act(() => playBtn.click());
        expect(audio.play).toHaveBeenCalledTimes(1);

        // Now it is "playing" -> next toggle pauses.
        Object.defineProperty(audio, "paused", { get: () => false, configurable: true });
        act(() => playBtn.click());
        expect(audio.pause).toHaveBeenCalledTimes(1);
    });

    it("reflects play/pause state on the play button via fired media events", () => {
        const root = renderInto(<AudioPreview note={audioNote()} />);
        const audio = getAudio(root);

        // play event -> playing true -> pause icon
        act(() => { audio.dispatchEvent(new Event("play")); });
        expect(root.querySelector(".play-button.bx-pause")).toBeTruthy();

        // pause event -> playing false -> play icon
        act(() => { audio.dispatchEvent(new Event("pause")); });
        expect(root.querySelector(".play-button.bx-play")).toBeTruthy();
    });

    it("shows the unsupported-format placeholder when the audio errors, hiding the player", () => {
        const root = renderInto(<AudioPreview note={audioNote({ mime: "audio/x-weird" })} />);
        act(() => { getAudio(root).dispatchEvent(new Event("error")); });

        expect(root.querySelector("audio")).toBeFalsy();
        expect(root.querySelector(".no-items")).toBeTruthy();
        expect(root.querySelector(".no-items .bx-volume-mute")).toBeTruthy();
    });

    it("clears the error state when the note id changes (effect re-runs)", () => {
        const root = renderInto(<AudioPreview note={audioNote({ id: "audA" })} />);
        act(() => { getAudio(root).dispatchEvent(new Event("error")); });
        expect(root.querySelector(".no-items")).toBeTruthy();

        // Re-render with a different note -> useEffect([noteId]) resets error -> player returns.
        act(() => render(<AudioPreview note={audioNote({ id: "audB" })} />, container as HTMLDivElement));
        expect(root.querySelector(".no-items")).toBeFalsy();
        expect(root.querySelector("audio")).toBeTruthy();
    });
});

describe("AudioPreview - keyboard shortcuts", () => {
    function fireKey(root: HTMLElement, key: string, init: KeyboardEventInit = {}) {
        const wrapper = root.querySelector(".audio-preview-wrapper") as HTMLElement;
        const ev = new KeyboardEvent("keydown", { key, bubbles: true, cancelable: true, ...init });
        act(() => { wrapper.dispatchEvent(ev); });
        return ev;
    }

    it("space toggles playback and prevents default", () => {
        const root = renderInto(<AudioPreview note={audioNote()} />);
        const audio = stubMediaMethods(getAudio(root));
        const ev = fireKey(root, " ");
        expect(ev.defaultPrevented).toBe(true);
        expect(audio.play).toHaveBeenCalledTimes(1);
    });

    it("ArrowLeft / ArrowRight seek by 10s, or 60s with ctrl, clamped to [0, duration]", () => {
        const root = renderInto(<AudioPreview note={audioNote()} />);
        const audio = setupAudioMetrics(getAudio(root), { currentTime: 50, duration: 120 });

        fireKey(root, "ArrowLeft");
        expect(audio.currentTime).toBe(40);

        fireKey(root, "ArrowRight");
        expect(audio.currentTime).toBe(50);

        fireKey(root, "ArrowRight", { ctrlKey: true });
        expect(audio.currentTime).toBe(110);

        // ctrl right past duration clamps to duration
        fireKey(root, "ArrowRight", { ctrlKey: true });
        expect(audio.currentTime).toBe(120);

        // left below zero clamps to 0
        setupAudioMetrics(audio, { currentTime: 5, duration: 120 });
        fireKey(root, "ArrowLeft", { ctrlKey: true });
        expect(audio.currentTime).toBe(0);
    });

    it("ArrowUp / ArrowDown change the volume clamped to [0, 1]", () => {
        const root = renderInto(<AudioPreview note={audioNote()} />);
        const audio = setupAudioMetrics(getAudio(root), { volume: 0.98 });

        fireKey(root, "ArrowUp");
        expect(audio.volume).toBe(1); // clamped

        setupAudioMetrics(audio, { volume: 0.02 });
        fireKey(root, "ArrowDown");
        expect(audio.volume).toBe(0); // clamped

        setupAudioMetrics(audio, { volume: 0.5 });
        fireKey(root, "ArrowUp");
        expect(audio.volume).toBeCloseTo(0.55, 5);
    });

    it("m/M toggles mute", () => {
        const root = renderInto(<AudioPreview note={audioNote()} />);
        const audio = setupAudioMetrics(getAudio(root), { muted: false });

        fireKey(root, "m");
        expect(audio.muted).toBe(true);
        fireKey(root, "M");
        expect(audio.muted).toBe(false);
    });

    it("Home / End jump to the start and end", () => {
        const root = renderInto(<AudioPreview note={audioNote()} />);
        const audio = setupAudioMetrics(getAudio(root), { currentTime: 30, duration: 200 });

        fireKey(root, "Home");
        expect(audio.currentTime).toBe(0);
        fireKey(root, "End");
        expect(audio.currentTime).toBe(200);
    });

    it("ignores unmapped keys (no preventDefault)", () => {
        const root = renderInto(<AudioPreview note={audioNote()} />);
        getAudio(root);
        const ev = fireKey(root, "z");
        expect(ev.defaultPrevented).toBe(false);
    });
});
