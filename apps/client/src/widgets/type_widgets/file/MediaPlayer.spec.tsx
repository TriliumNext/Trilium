import { RefObject } from "preact";
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
            let inst = Dropdown.instances.get(el);
            if (!inst) { inst = new Dropdown(el); Dropdown.instances.set(el, inst); }
            return inst;
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
vi.mock("../../../services/keyboard_actions", () => ({
    default: { getAction: vi.fn(async () => ({ effectiveShortcuts: [] })) }
}));

import { PlaybackSpeed, PlayPauseButton, LoopButton, SeekBar, SkipButton, VolumeControl } from "./MediaPlayer";

// --- Fake media element ---------------------------------------------------------------------------

interface FakeMedia {
    currentTime: number;
    duration: number;
    volume: number;
    muted: boolean;
    loop: boolean;
    playbackRate: number;
    addEventListener: (type: string, cb: () => void) => void;
    removeEventListener: (type: string, cb: () => void) => void;
    fire: (type: string) => void;
    listeners: Record<string, Set<() => void>>;
}

function createFakeMedia(overrides: Partial<FakeMedia> = {}): FakeMedia {
    const listeners: Record<string, Set<() => void>> = {};
    const media: FakeMedia = {
        currentTime: 0,
        duration: 0,
        volume: 1,
        muted: false,
        loop: false,
        playbackRate: 1,
        listeners,
        addEventListener(type, cb) {
            (listeners[type] ??= new Set()).add(cb);
        },
        removeEventListener(type, cb) {
            listeners[type]?.delete(cb);
        },
        fire(type) {
            for (const cb of listeners[type] ?? []) cb();
        },
        ...overrides
    };
    return media;
}

/** A real <video>/<audio> DOM element augmented with a controllable MutationObserver-friendly `loop`. */
function fakeRef(media: unknown): RefObject<HTMLVideoElement | HTMLAudioElement> {
    return { current: media as HTMLVideoElement };
}

// --- Render harness -------------------------------------------------------------------------------

let container: HTMLDivElement | undefined;
function renderInto(vnode: unknown) {
    container = document.createElement("div");
    document.body.appendChild(container);
    act(() => { render(vnode as never, container as HTMLDivElement); });
    return container;
}

// --- MutationObserver stub (happy-dom's may not invoke for attribute changes on plain objects) ----

interface FakeMObserver { cb: MutationCallback; target?: Node; }
let mutationObservers: FakeMObserver[] = [];
let RealMutationObserver: typeof MutationObserver | undefined;

beforeEach(() => {
    mutationObservers = [];
    RealMutationObserver = window.MutationObserver;
    class FakeMO {
        cb: MutationCallback;
        constructor(cb: MutationCallback) { this.cb = cb; mutationObservers.push({ cb: this.cb }); }
        observe(target: Node) { const o = mutationObservers[mutationObservers.length - 1]; if (o) o.target = target; }
        disconnect() {}
        takeRecords() { return []; }
    }
    Object.assign(window, { MutationObserver: FakeMO });
    // Dropdown's useTooltip uses $.fn.tooltip.
    const fn = $.fn as unknown as Record<string, unknown>;
    if (typeof fn.tooltip !== "function") {
        fn.tooltip = function (this: unknown) { return this; };
    }
});

afterEach(() => {
    if (container) { render(null, container); container.remove(); container = undefined; }
    if (RealMutationObserver) Object.assign(window, { MutationObserver: RealMutationObserver });
    vi.restoreAllMocks();
});

function fireMutations() {
    for (const o of mutationObservers) act(() => { o.cb([], undefined as never); });
}

/** Run an action whose return value (boolean from dispatchEvent, JQuery from trigger, ...) must be discarded for `act`. */
function actDo(fn: () => unknown) {
    act(() => { fn(); });
}

// --- SeekBar / formatTime -------------------------------------------------------------------------

describe("SeekBar", () => {
    it("renders formatted current + remaining time and a range bound to duration", () => {
        const media = createFakeMedia({ currentTime: 65, duration: 130 });
        const root = renderInto(<SeekBar mediaRef={fakeRef(media)} />);

        const range = root.querySelector("input.media-trackbar") as HTMLInputElement | null;
        expect(range).not.toBeNull();
        expect(range?.getAttribute("type")).toBe("range");

        // Fire durationchange + timeupdate so the component reads from the media element.
        act(() => media.fire("durationchange"));
        act(() => media.fire("timeupdate"));

        const times = root.querySelectorAll(".media-time");
        expect(times.length).toBe(2);
        // formatTime(65) => "1:05"; remaining = 130-65 = 65 => "-1:05"
        expect(times[0]?.textContent).toBe("1:05");
        expect(times[1]?.textContent).toBe("-1:05");
        expect(range?.getAttribute("max")).toBe("130");
    });

    it("formats sub-minute and pads seconds; remaining clamps to >= 0", () => {
        const media = createFakeMedia({ currentTime: 9, duration: 5 });
        const root = renderInto(<SeekBar mediaRef={fakeRef(media)} />);
        act(() => media.fire("durationchange"));
        act(() => media.fire("timeupdate"));
        const times = root.querySelectorAll(".media-time");
        expect(times[0]?.textContent).toBe("0:09");
        // duration - currentTime = -4 => Math.max(0, ...) => 0 => "-0:00"
        expect(times[1]?.textContent).toBe("-0:00");
    });

    it("seeking via the range input writes currentTime back to the media element", () => {
        const media = createFakeMedia({ duration: 100 });
        const root = renderInto(<SeekBar mediaRef={fakeRef(media)} />);
        const range = root.querySelector("input.media-trackbar") as HTMLInputElement;
        range.value = "42.5";
        actDo(() => range.dispatchEvent(new Event("input", { bubbles: true })));
        expect(media.currentTime).toBe(42.5);
    });

    it("does not crash when mediaRef.current is null (effect + handlers early-return)", () => {
        const root = renderInto(<SeekBar mediaRef={fakeRef(null)} />);
        const range = root.querySelector("input.media-trackbar") as HTMLInputElement;
        range.value = "10";
        // onSeek early-returns; nothing to assert besides "no throw".
        expect(() => actDo(() => range.dispatchEvent(new Event("input", { bubbles: true })))).not.toThrow();
    });

    it("removes listeners on unmount", () => {
        const media = createFakeMedia({ duration: 10 });
        renderInto(<SeekBar mediaRef={fakeRef(media)} />);
        expect(media.listeners["timeupdate"]?.size).toBe(1);
        expect(media.listeners["durationchange"]?.size).toBe(1);
        if (container) { act(() => render(null, container as HTMLDivElement)); }
        expect(media.listeners["timeupdate"]?.size ?? 0).toBe(0);
        expect(media.listeners["durationchange"]?.size ?? 0).toBe(0);
    });
});

// --- PlayPauseButton ------------------------------------------------------------------------------

describe("PlayPauseButton", () => {
    it("shows the play icon when paused and fires togglePlayback on click", () => {
        const toggle = vi.fn();
        const root = renderInto(<PlayPauseButton playing={false} togglePlayback={toggle} />);
        const btn = root.querySelector("button.play-button") as HTMLButtonElement;
        expect(btn.className).toContain("bx-play");
        btn.click();
        expect(toggle).toHaveBeenCalledTimes(1);
    });

    it("shows the pause icon when playing", () => {
        const root = renderInto(<PlayPauseButton playing={true} togglePlayback={vi.fn()} />);
        const btn = root.querySelector("button.play-button") as HTMLButtonElement;
        expect(btn.className).toContain("bx-pause");
    });
});

// --- VolumeControl --------------------------------------------------------------------------------

describe("VolumeControl", () => {
    it("initializes volume + muted from the media element and reflects mid-range icon", () => {
        const media = createFakeMedia({ volume: 0.3, muted: false });
        const root = renderInto(<VolumeControl mediaRef={fakeRef(media)} />);
        const slider = root.querySelector("input.media-volume-slider") as HTMLInputElement;
        // volume < 0.5 => volume-low icon
        const muteBtn = root.querySelector(".media-volume-row button") as HTMLButtonElement;
        expect(muteBtn.className).toContain("bx-volume-low");
        expect(slider.value).toBe("0.3");
    });

    it("shows full-volume icon for high volume and mute icon when muted", () => {
        const media = createFakeMedia({ volume: 0.8, muted: false });
        const root = renderInto(<VolumeControl mediaRef={fakeRef(media)} />);
        let muteBtn = root.querySelector(".media-volume-row button") as HTMLButtonElement;
        expect(muteBtn.className).toContain("bx-volume-full");

        // Toggling mute updates icon to mute and slider to 0.
        act(() => muteBtn.click());
        expect(media.muted).toBe(true);
        muteBtn = root.querySelector(".media-volume-row button") as HTMLButtonElement;
        expect(muteBtn.className).toContain("bx-volume-mute");
        const slider = root.querySelector("input.media-volume-slider") as HTMLInputElement;
        expect(slider.value).toBe("0");
    });

    it("changing the slider sets volume and unmutes when raised above zero", () => {
        const media = createFakeMedia({ volume: 0, muted: true });
        const root = renderInto(<VolumeControl mediaRef={fakeRef(media)} />);
        const slider = root.querySelector("input.media-volume-slider") as HTMLInputElement;
        slider.value = "0.6";
        actDo(() => slider.dispatchEvent(new Event("input", { bubbles: true })));
        expect(media.volume).toBe(0.6);
        expect(media.muted).toBe(false);
        const muteBtn = root.querySelector(".media-volume-row button") as HTMLButtonElement;
        expect(muteBtn.className).toContain("bx-volume-full");
    });

    it("changing slider to a positive value while not muted keeps muted unchanged", () => {
        const media = createFakeMedia({ volume: 0.2, muted: false });
        const root = renderInto(<VolumeControl mediaRef={fakeRef(media)} />);
        const slider = root.querySelector("input.media-volume-slider") as HTMLInputElement;
        slider.value = "0.9";
        actDo(() => slider.dispatchEvent(new Event("input", { bubbles: true })));
        expect(media.volume).toBe(0.9);
        expect(media.muted).toBe(false);
    });

    it("syncs state when the media fires volumechange externally", () => {
        const media = createFakeMedia({ volume: 1, muted: false });
        const root = renderInto(<VolumeControl mediaRef={fakeRef(media)} />);
        media.volume = 0.1;
        media.muted = true;
        act(() => media.fire("volumechange"));
        const muteBtn = root.querySelector(".media-volume-row button") as HTMLButtonElement;
        expect(muteBtn.className).toContain("bx-volume-mute");
    });

    it("defaults to volume 1 / not muted when mediaRef is null and handlers early-return", () => {
        const root = renderInto(<VolumeControl mediaRef={fakeRef(null)} />);
        const slider = root.querySelector("input.media-volume-slider") as HTMLInputElement;
        expect(slider.value).toBe("1");
        const muteBtn = root.querySelector(".media-volume-row button") as HTMLButtonElement;
        expect(muteBtn.className).toContain("bx-volume-full");
        // toggleMute + onVolumeChange early-return without throwing.
        slider.value = "0.5";
        expect(() => actDo(() => slider.dispatchEvent(new Event("input", { bubbles: true })))).not.toThrow();
        expect(() => act(() => muteBtn.click())).not.toThrow();
    });

    it("removes the volumechange listener on unmount", () => {
        const media = createFakeMedia({ volume: 0.5 });
        renderInto(<VolumeControl mediaRef={fakeRef(media)} />);
        expect(media.listeners["volumechange"]?.size).toBe(1);
        if (container) act(() => render(null, container as HTMLDivElement));
        expect(media.listeners["volumechange"]?.size ?? 0).toBe(0);
    });
});

// --- SkipButton -----------------------------------------------------------------------------------

describe("SkipButton", () => {
    it("skips forward, clamped to duration", () => {
        const media = createFakeMedia({ currentTime: 50, duration: 55 });
        const root = renderInto(<SkipButton mediaRef={fakeRef(media)} seconds={10} icon="bx bx-fast-forward" text="fwd" />);
        const btn = root.querySelector("button") as HTMLButtonElement;
        expect(btn.className).toContain("bx-fast-forward");
        act(() => btn.click());
        expect(media.currentTime).toBe(55);
    });

    it("skips backward, clamped to 0", () => {
        const media = createFakeMedia({ currentTime: 3, duration: 100 });
        const root = renderInto(<SkipButton mediaRef={fakeRef(media)} seconds={-10} icon="bx bx-rewind" text="back" />);
        act(() => (root.querySelector("button") as HTMLButtonElement).click());
        expect(media.currentTime).toBe(0);
    });

    it("does nothing when mediaRef is null", () => {
        const root = renderInto(<SkipButton mediaRef={fakeRef(null)} seconds={10} icon="bx bx-x" text="x" />);
        expect(() => act(() => (root.querySelector("button") as HTMLButtonElement).click())).not.toThrow();
    });
});

// --- LoopButton -----------------------------------------------------------------------------------

describe("LoopButton", () => {
    it("reflects initial loop state and toggles it on click", () => {
        const media = createFakeMedia({ loop: false });
        const root = renderInto(<LoopButton mediaRef={fakeRef(media)} />);
        let btn = root.querySelector("button") as HTMLButtonElement;
        expect(btn.className).not.toContain("active");
        act(() => btn.click());
        expect(media.loop).toBe(true);
        btn = root.querySelector("button") as HTMLButtonElement;
        expect(btn.className).toContain("active");
    });

    it("starts active when media already loops", () => {
        const media = createFakeMedia({ loop: true });
        const root = renderInto(<LoopButton mediaRef={fakeRef(media)} />);
        const btn = root.querySelector("button") as HTMLButtonElement;
        expect(btn.className).toContain("active");
    });

    it("updates when the loop attribute changes externally (MutationObserver)", () => {
        const media = createFakeMedia({ loop: false });
        const root = renderInto(<LoopButton mediaRef={fakeRef(media)} />);
        media.loop = true;
        fireMutations();
        const btn = root.querySelector("button") as HTMLButtonElement;
        expect(btn.className).toContain("active");
    });

    it("does nothing when mediaRef is null", () => {
        const root = renderInto(<LoopButton mediaRef={fakeRef(null)} />);
        expect(() => act(() => (root.querySelector("button") as HTMLButtonElement).click())).not.toThrow();
    });
});

// --- PlaybackSpeed --------------------------------------------------------------------------------

describe("PlaybackSpeed", () => {
    it("renders the current speed label from the media element", () => {
        const media = createFakeMedia({ playbackRate: 1.5 });
        const root = renderInto(<PlaybackSpeed mediaRef={fakeRef(media)} />);
        const label = root.querySelector(".media-speed-label");
        expect(label?.textContent).toBe("1.5x");
    });

    it("syncs the label when the media fires ratechange externally", () => {
        const media = createFakeMedia({ playbackRate: 1 });
        const root = renderInto(<PlaybackSpeed mediaRef={fakeRef(media)} />);
        media.playbackRate = 2;
        act(() => media.fire("ratechange"));
        expect(root.querySelector(".media-speed-label")?.textContent).toBe("2x");
    });

    it("selecting a speed from the dropdown updates the media element", () => {
        const media = createFakeMedia({ playbackRate: 1 });
        const root = renderInto(<PlaybackSpeed mediaRef={fakeRef(media)} />);
        // Open the dropdown so its children render (Dropdown only renders children when shown).
        const dropdown = root.querySelector(".dropdown") as HTMLElement;
        actDo(() => $(dropdown).trigger("show.bs.dropdown"));

        const items = root.querySelectorAll("button.dropdown-item");
        expect(items.length).toBe(5); // PLAYBACK_SPEEDS
        // The first option (0.5x) should not be active; the 1x option should be.
        const activeItem = root.querySelector("button.dropdown-item.active");
        expect(activeItem?.textContent).toBe("1x");

        // Click the 2x option (last).
        act(() => (items[items.length - 1] as HTMLButtonElement).click());
        expect(media.playbackRate).toBe(2);
    });

    it("selecting a speed does nothing when mediaRef is null", () => {
        const root = renderInto(<PlaybackSpeed mediaRef={fakeRef(null)} />);
        const dropdown = root.querySelector(".dropdown") as HTMLElement;
        actDo(() => $(dropdown).trigger("show.bs.dropdown"));
        const item = root.querySelector("button.dropdown-item") as HTMLButtonElement | null;
        expect(() => { if (item) act(() => item.click()); }).not.toThrow();
    });

    it("defaults to speed 1 when mediaRef is null", () => {
        const root = renderInto(<PlaybackSpeed mediaRef={fakeRef(null)} />);
        expect(root.querySelector(".media-speed-label")?.textContent).toBe("1x");
    });

    it("removes the ratechange listener on unmount", () => {
        const media = createFakeMedia({ playbackRate: 1 });
        renderInto(<PlaybackSpeed mediaRef={fakeRef(media)} />);
        expect(media.listeners["ratechange"]?.size).toBe(1);
        if (container) act(() => render(null, container as HTMLDivElement));
        expect(media.listeners["ratechange"]?.size ?? 0).toBe(0);
    });
});
