import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The visualizer needs the Web Audio API and the waveform loader fetches the whole file; neither exists
// here, and both have specs of their own. Hoisted: Audio.tsx imports them statically.
const { loadWaveform, audioVisualizer } = vi.hoisted(() => ({
    loadWaveform: vi.fn(async (_url: string, _options?: { signal?: AbortSignal }) => null as { peaks: number[] } | null),
    audioVisualizer: vi.fn(() => null)
}));
vi.mock("./audio_waveform", () => ({ loadWaveform }));
vi.mock("./AudioVisualizer", () => ({ AudioVisualizer: audioVisualizer }));

import AudioPreview from "./Audio";
import type FNote from "../../../entities/fnote";
import type { MediaSource } from "./media_source";

const source: MediaSource = {
    id: "snd1",
    title: "Podcast",
    mime: "audio/mpeg",
    streamUrl: "api/notes/snd1/open-partial?v=blobA",
    fullUrl: "api/notes/snd1/open?v=blobA"
};
const audioNote = { noteId: "snd1", title: "Podcast", mime: "audio/mpeg", blobId: "blobA" } as FNote;

describe("AudioPreview", () => {
    let container: HTMLElement;

    beforeEach(() => {
        loadWaveform.mockClear();
        loadWaveform.mockResolvedValue(null);
        container = document.createElement("div");
        document.body.appendChild(container);
        HTMLMediaElement.prototype.play = vi.fn(async () => {}) as unknown as HTMLMediaElement["play"];
        HTMLMediaElement.prototype.pause = vi.fn();
    });

    afterEach(() => {
        act(() => render(null, container));
        container.remove();
    });

    const renderPlayer = (overrides: Partial<MediaSource> = {}) => {
        act(() => render(<AudioPreview entity={audioNote} source={{ ...source, ...overrides }} environment="standalone" />, container));
        const audio = container.querySelector("audio");
        if (!audio) throw new Error("no audio element rendered");
        return audio;
    };

    const wrapper = () => {
        const el = container.querySelector(".audio-preview-wrapper");
        if (!el) throw new Error("no wrapper rendered");
        return el as HTMLElement;
    };

    /** `duration` is read-only on a media element, and happy-dom leaves it NaN — seeking needs a real one. */
    const setDuration = (audio: HTMLAudioElement, duration: number) =>
        Object.defineProperty(audio, "duration", { value: duration, configurable: true });

    const press = (key: string, init: KeyboardEventInit = {}) =>
        act(() => { wrapper().dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true, ...init })); });

    describe("keyboard shortcuts", () => {
        it("seeks by 10s, or a minute with Ctrl, and clamps to the media's bounds", async () => {
            const audio = renderPlayer();
            setDuration(audio, 120);
            audio.currentTime = 60;

            await press("ArrowRight");
            expect(audio.currentTime).toBe(70);
            await press("ArrowLeft");
            expect(audio.currentTime).toBe(60);
            await press("ArrowLeft", { ctrlKey: true });
            expect(audio.currentTime).toBe(0);
            // Already at the start: another jump back can't go negative.
            await press("ArrowLeft");
            expect(audio.currentTime).toBe(0);

            await press("End");
            expect(audio.currentTime).toBe(120);
            await press("ArrowRight");
            expect(audio.currentTime).toBe(120);
            await press("Home");
            expect(audio.currentTime).toBe(0);
        });

        it("toggles playback with Space, following the element's own state", async () => {
            const audio = renderPlayer();

            await press(" ");
            expect(audio.play).toHaveBeenCalledTimes(1);

            Object.defineProperty(audio, "paused", { value: false, configurable: true });
            await press(" ");
            expect(audio.pause).toHaveBeenCalledTimes(1);
        });

        it("toggles mute and steps the volume within range", async () => {
            const audio = renderPlayer();
            audio.volume = 0.5;

            await press("m");
            expect(audio.muted).toBe(true);
            await press("M");
            expect(audio.muted).toBe(false);

            await press("ArrowUp");
            expect(audio.volume).toBeCloseTo(0.55);
            await press("ArrowDown");
            expect(audio.volume).toBeCloseTo(0.5);

            audio.volume = 1;
            await press("ArrowUp");
            expect(audio.volume).toBe(1);
            audio.volume = 0;
            await press("ArrowDown");
            expect(audio.volume).toBe(0);
        });

        it("has no fullscreen to toggle, and ignores keys it doesn't bind", async () => {
            const audio = renderPlayer();
            setDuration(audio, 100);
            audio.currentTime = 20;

            await press("f");
            await press("k");
            expect(audio.currentTime).toBe(20);
            expect(audio.play).not.toHaveBeenCalled();
        });

        it("stands aside for the application's own chords", async () => {
            const audio = renderPlayer();
            setDuration(audio, 100);
            audio.currentTime = 20;

            await press(" ", { ctrlKey: true });
            await press("m", { ctrlKey: true });
            await press("End", { metaKey: true });

            expect(audio.play).not.toHaveBeenCalled();
            expect(audio.muted).toBe(false);
            expect(audio.currentTime).toBe(20);

            // Its own Ctrl+Left/Right minute jump still belongs to the player.
            await press("ArrowRight", { ctrlKey: true });
            expect(audio.currentTime).toBe(80);
        });
    });

    describe("waveform", () => {
        it("decodes the whole file for the current media only, abandoning a previous decode", async () => {
            let firstSignal: AbortSignal | undefined;
            loadWaveform.mockImplementation(async (_url, options) => {
                firstSignal ??= options?.signal;
                return null;
            });

            renderPlayer();
            expect(loadWaveform).toHaveBeenCalledWith(source.fullUrl, expect.objectContaining({ signal: expect.anything() }));
            expect(firstSignal?.aborted).toBe(false);

            // Switching media abandons the in-flight decode, so a slow one can't paint over the new track.
            await act(async () => { renderPlayer({ id: "snd2", fullUrl: "api/notes/snd2/open?v=blobB" }); });
            expect(firstSignal?.aborted).toBe(true);
            expect(loadWaveform).toHaveBeenLastCalledWith("api/notes/snd2/open?v=blobB", expect.objectContaining({ signal: expect.anything() }));
        });

        it("keeps a plain seek bar when the file has no usable waveform", async () => {
            loadWaveform.mockResolvedValue(null);
            await act(async () => { renderPlayer(); });

            expect(container.querySelector(".waveform-seekbar")).not.toBeNull();
        });

        it("survives a decode that fails outright", async () => {
            loadWaveform.mockRejectedValue(new Error("decode failed"));
            await act(async () => { renderPlayer(); });

            expect(container.querySelector(".waveform-seekbar")).not.toBeNull();
            expect(container.querySelector(".no-items")).toBeNull();
        });
    });

    it("gives the whole visualizer band to the full player, alongside the music icon", () => {
        renderPlayer();

        expect(container.querySelector(".audio-preview-icon")).not.toBeNull();
        expect(audioVisualizer).toHaveBeenCalledWith(expect.objectContaining({ compact: false }), expect.anything());
    });

    it("replaces the player with an unsupported-format message when the media fails to load", async () => {
        const audio = renderPlayer();

        await act(async () => { audio.dispatchEvent(new Event("error")); });

        expect(container.querySelector("audio")).toBeNull();
        expect(container.querySelector(".no-items")).not.toBeNull();
    });

    it("resets the error when a new media is shown in the same player", async () => {
        const audio = renderPlayer();
        await act(async () => { audio.dispatchEvent(new Event("error")); });
        expect(container.querySelector("audio")).toBeNull();

        renderPlayer({ id: "snd2", streamUrl: "api/notes/snd2/open-partial?v=blobB" });
        expect(container.querySelector("audio")?.getAttribute("src")).toBe("api/notes/snd2/open-partial?v=blobB");
    });
});
