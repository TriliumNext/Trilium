import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type FNote from "../../../entities/fnote";
import type { MediaSource } from "./media_source";
import VideoPreview from "./Video";

const source: MediaSource = {
    id: "vid1",
    title: "Holiday",
    mime: "video/mp4",
    streamUrl: "api/notes/vid1/open-partial?v=blobV",
    fullUrl: "api/notes/vid1/open?v=blobV"
};
const videoNote = { noteId: "vid1", title: "Holiday", mime: "video/mp4", blobId: "blobV" } as FNote;

describe("VideoPreview", () => {
    let container: HTMLElement;

    beforeEach(() => {
        container = document.createElement("div");
        document.body.appendChild(container);
        // happy-dom implements neither playback nor the fullscreen/PiP APIs the controls drive.
        HTMLMediaElement.prototype.play = vi.fn(async () => {}) as unknown as HTMLMediaElement["play"];
        HTMLMediaElement.prototype.pause = vi.fn();
        HTMLElement.prototype.requestFullscreen = vi.fn(async () => {});
        document.exitFullscreen = vi.fn(async () => {});
        setFullscreenElement(null);
    });

    afterEach(() => {
        vi.useRealTimers();
        act(() => render(null, container));
        container.remove();
    });

    const renderPlayer = (props: Partial<Parameters<typeof VideoPreview>[0]> = {}) => {
        act(() => render(<VideoPreview entity={videoNote} source={source} environment="standalone" {...props} />, container));
        const video = container.querySelector("video");
        if (!video) throw new Error("no video element rendered");
        return video;
    };

    const wrapper = () => {
        const el = container.querySelector(".video-preview-wrapper");
        if (!el) throw new Error("no wrapper rendered");
        return el as HTMLElement;
    };

    /** `duration` is read-only on a media element, and happy-dom leaves it NaN — seeking needs a real one. */
    const setDuration = (video: HTMLVideoElement, duration: number) =>
        Object.defineProperty(video, "duration", { value: duration, configurable: true });

    const press = (key: string, init: KeyboardEventInit = {}) =>
        act(() => { wrapper().dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, ...init })); });

    describe("keyboard shortcuts", () => {
        it("seeks by 10s, or a minute with Ctrl, and clamps to the media's bounds", async () => {
            const video = renderPlayer();
            setDuration(video, 100);
            video.currentTime = 50;

            await press("ArrowRight");
            expect(video.currentTime).toBe(60);
            await press("ArrowLeft");
            expect(video.currentTime).toBe(50);
            await press("ArrowRight", { ctrlKey: true });
            expect(video.currentTime).toBe(100);
            // Already at the end: another jump forward can't run past the duration.
            await press("ArrowRight");
            expect(video.currentTime).toBe(100);

            video.currentTime = 5;
            await press("ArrowLeft");
            expect(video.currentTime).toBe(0);
        });

        it("jumps to the start and the end", async () => {
            const video = renderPlayer();
            setDuration(video, 80);
            video.currentTime = 30;

            await press("End");
            expect(video.currentTime).toBe(80);
            await press("Home");
            expect(video.currentTime).toBe(0);
        });

        it("toggles playback with Space, following the element's own state", async () => {
            const video = renderPlayer();

            await press(" ");
            expect(video.play).toHaveBeenCalledTimes(1);

            // A playing element pauses instead.
            Object.defineProperty(video, "paused", { value: false, configurable: true });
            await press(" ");
            expect(video.pause).toHaveBeenCalledTimes(1);
        });

        it("toggles mute and steps the volume", async () => {
            const video = renderPlayer();
            video.volume = 0.5;

            await press("m");
            expect(video.muted).toBe(true);
            await press("M");
            expect(video.muted).toBe(false);

            await press("ArrowUp");
            expect(video.volume).toBeCloseTo(0.55);
            await press("ArrowDown");
            expect(video.volume).toBeCloseTo(0.5);

            // Volume is capped at both ends rather than running out of range.
            video.volume = 1;
            await press("ArrowUp");
            expect(video.volume).toBe(1);
            video.volume = 0;
            await press("ArrowDown");
            expect(video.volume).toBe(0);
        });

        it("enters and leaves fullscreen with F", async () => {
            renderPlayer();

            await press("f");
            expect(wrapper().requestFullscreen).toHaveBeenCalled();

            setFullscreenElement(wrapper());
            await press("F");
            expect(document.exitFullscreen).toHaveBeenCalled();
        });

        it("ignores keys it doesn't bind", async () => {
            const video = renderPlayer();
            setDuration(video, 100);
            video.currentTime = 20;

            await press("k");
            expect(video.currentTime).toBe(20);
            expect(video.play).not.toHaveBeenCalled();
        });

        it("stands aside for the application's own chords", async () => {
            const video = renderPlayer();
            setDuration(video, 100);
            video.currentTime = 20;
            video.volume = 0.5;

            // Ctrl+F is the app's, not "fullscreen"; likewise Ctrl+Space, Ctrl+M and the rest.
            await press("f", { ctrlKey: true });
            expect(wrapper().requestFullscreen).not.toHaveBeenCalled();

            await press(" ", { ctrlKey: true });
            expect(video.play).not.toHaveBeenCalled();

            await press("m", { ctrlKey: true });
            expect(video.muted).toBe(false);

            await press("Home", { metaKey: true });
            await press("End", { altKey: true });
            expect(video.currentTime).toBe(20);

            await press("ArrowUp", { altKey: true });
            expect(video.volume).toBeCloseTo(0.5);
        });
    });

    describe("click and tap", () => {
        const pointerDown = (pointerType: string) =>
            act(() => { wrapper().dispatchEvent(new PointerEvent("pointerdown", { pointerType, bubbles: true })); });
        const click = (target: Element = wrapper()) =>
            act(() => { target.dispatchEvent(new MouseEvent("click", { bubbles: true })); });

        it("plays or pauses on a mouse click", async () => {
            const video = renderPlayer();
            await pointerDown("mouse");
            await click();
            expect(video.play).toHaveBeenCalled();
        });

        it("only reveals the controls on a touch tap, leaving playback to the play button", async () => {
            const video = renderPlayer();
            await pointerDown("touch");
            await click();

            expect(video.play).not.toHaveBeenCalled();
            // The tap hid the (initially visible) controls instead.
            expect(wrapper().classList.contains("controls-hidden")).toBe(true);

            await pointerDown("touch");
            await click();
            expect(wrapper().classList.contains("controls-hidden")).toBe(false);
        });

        it("leaves clicks on the controls themselves alone", async () => {
            const video = renderPlayer();
            const controls = container.querySelector(".media-preview-controls");
            if (!controls) throw new Error("no controls rendered");

            await pointerDown("mouse");
            await click(controls);
            expect(video.play).not.toHaveBeenCalled();
        });
    });

    describe("auto-hiding controls", () => {
        it("hides them while playing and brings them back on pause", async () => {
            const video = renderPlayer();
            expect(wrapper().classList.contains("controls-hidden")).toBe(false);

            Object.defineProperty(video, "paused", { value: false, configurable: true });
            await act(async () => { video.dispatchEvent(new Event("play")); });
            expect(wrapper().classList.contains("controls-hidden")).toBe(true);

            Object.defineProperty(video, "paused", { value: true, configurable: true });
            await act(async () => { video.dispatchEvent(new Event("pause")); });
            expect(wrapper().classList.contains("controls-hidden")).toBe(false);
        });

        it("reveals them on mouse movement, then hides them again while playback continues", async () => {
            vi.useFakeTimers();
            const video = renderPlayer();
            Object.defineProperty(video, "paused", { value: false, configurable: true });
            await act(async () => { video.dispatchEvent(new Event("play")); });
            expect(wrapper().classList.contains("controls-hidden")).toBe(true);

            act(() => { wrapper().dispatchEvent(new PointerEvent("pointermove", { pointerType: "mouse", bubbles: true })); });
            expect(wrapper().classList.contains("controls-hidden")).toBe(false);

            act(() => { vi.advanceTimersByTime(3000); });
            expect(wrapper().classList.contains("controls-hidden")).toBe(true);
        });

        it("ignores pointer movement from a touch drag, which has no hover to reveal with", async () => {
            const video = renderPlayer();
            Object.defineProperty(video, "paused", { value: false, configurable: true });
            await act(async () => { video.dispatchEvent(new Event("play")); });

            act(() => { wrapper().dispatchEvent(new PointerEvent("pointermove", { pointerType: "touch", bubbles: true })); });
            expect(wrapper().classList.contains("controls-hidden")).toBe(true);
        });
    });

    describe("view controls", () => {
        const clickButton = (iconClass: string) => {
            const button = container.querySelector(`.${iconClass}`)?.closest("button");
            if (!button) throw new Error(`no button with icon ${iconClass}`);
            act(() => { button.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
        };

        it("rotates in quarter turns, scaling the sideways ones down to fit", () => {
            const video = renderPlayer();

            clickButton("bx-rotate-right");
            expect(video.style.transform).toContain("rotate(90deg)");
            // A sideways video is scaled by the container's aspect ratio so it still fits.
            expect(video.style.transform).toContain("scale(");

            clickButton("bx-rotate-right");
            expect(video.style.transform).toBe("rotate(180deg)");

            clickButton("bx-rotate-right");
            expect(video.style.transform).toContain("rotate(270deg)");

            // Back to upright: the transform is dropped rather than left as rotate(0deg).
            clickButton("bx-rotate-right");
            expect(video.style.transform).toBe("");
        });

        it("toggles zoom-to-fit between cover and the default fit", () => {
            const video = renderPlayer();

            clickButton("bx-expand");
            expect(video.style.objectFit).toBe("cover");
            expect(container.querySelector(".bx-collapse")).not.toBeNull();

            clickButton("bx-collapse");
            expect(video.style.objectFit).toBe("");
            expect(container.querySelector(".bx-expand")).not.toBeNull();
        });

        it("swaps the fullscreen button for its exit form while fullscreen", async () => {
            renderPlayer();
            expect(container.querySelector(".bx-fullscreen")).not.toBeNull();

            setFullscreenElement(wrapper());
            await act(async () => { document.dispatchEvent(new Event("fullscreenchange")); });
            expect(container.querySelector(".bx-exit-fullscreen")).not.toBeNull();

            clickFullscreen();
            expect(document.exitFullscreen).toHaveBeenCalled();
        });

        it("offers picture-in-picture only where the browser supports it", async () => {
            renderPlayer();
            // happy-dom has no PiP, matching Firefox: the button is left out entirely.
            expect(container.querySelector(".bx-window-open")).toBeNull();

            const requestPictureInPicture = vi.fn(async () => ({}));
            Object.defineProperty(HTMLVideoElement.prototype, "requestPictureInPicture", { value: requestPictureInPicture, configurable: true });
            try {
                act(() => render(null, container));
                const video = renderPlayer();
                const button = container.querySelector(".bx-window-open")?.closest("button");
                expect(button).not.toBeNull();

                act(() => { button?.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
                expect(requestPictureInPicture).toHaveBeenCalled();

                // Entering PiP swaps the icon; clicking again leaves it.
                await act(async () => { video.dispatchEvent(new Event("enterpictureinpicture")); });
                const exitButton = container.querySelector(".bx-exit")?.closest("button");
                expect(exitButton).not.toBeNull();

                const exitPictureInPicture = vi.fn(async () => {});
                Object.defineProperty(document, "pictureInPictureElement", { value: video, configurable: true });
                document.exitPictureInPicture = exitPictureInPicture;
                act(() => { exitButton?.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
                expect(exitPictureInPicture).toHaveBeenCalled();

                await act(async () => { video.dispatchEvent(new Event("leavepictureinpicture")); });
                expect(container.querySelector(".bx-window-open")).not.toBeNull();
            } finally {
                Reflect.deleteProperty(HTMLVideoElement.prototype, "requestPictureInPicture");
                Reflect.deleteProperty(document, "pictureInPictureElement");
            }
        });

        function clickFullscreen() {
            const button = container.querySelector(".bx-exit-fullscreen, .bx-fullscreen")?.closest("button");
            act(() => { button?.dispatchEvent(new MouseEvent("click", { bubbles: true })); });
        }
    });

    it("replaces the player with an unsupported-format message when the media fails to load", async () => {
        const video = renderPlayer();

        await act(async () => { video.dispatchEvent(new Event("error")); });

        expect(container.querySelector("video")).toBeNull();
        expect(container.querySelector(".no-items")).not.toBeNull();
    });

    it("resets the error when a new media is shown in the same player", async () => {
        const video = renderPlayer();
        await act(async () => { video.dispatchEvent(new Event("error")); });
        expect(container.querySelector("video")).toBeNull();

        const nextSource = { ...source, id: "vid2", streamUrl: "api/notes/vid2/open-partial?v=blobW" };
        act(() => render(<VideoPreview entity={videoNote} source={nextSource} environment="standalone" />, container));
        expect(container.querySelector("video")?.getAttribute("src")).toBe(nextSource.streamUrl);
    });
});

/** `document.fullscreenElement` is a read-only getter, so the tests swap it out per case. */
function setFullscreenElement(element: Element | null) {
    Object.defineProperty(document, "fullscreenElement", { value: element, configurable: true });
}
