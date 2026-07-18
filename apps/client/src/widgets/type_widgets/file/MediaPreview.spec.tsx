import { render } from "preact";
import { act } from "preact/test-utils";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// The audio player's extras reach for the network and the Web Audio API, neither of which exists here —
// and neither is what these tests are about (they're covered by audio_waveform.spec / audio_visualizer.spec).
// Hoisted: Audio.tsx imports the visualizer statically, so the factory runs before this module's body.
const { audioVisualizer } = vi.hoisted(() => ({ audioVisualizer: vi.fn((_props: { compact?: boolean }) => null) }));
vi.mock("./audio_waveform", () => ({ loadWaveform: vi.fn(async () => null) }));
vi.mock("./AudioVisualizer", () => ({ AudioVisualizer: audioVisualizer }));

import type FAttachment from "../../../entities/fattachment";
import type FNote from "../../../entities/fnote";
import MediaPreview from "./MediaPreview";

const videoNote = { noteId: "vid1", title: "Holiday", mime: "video/mp4" } as FNote;
const audioNote = { noteId: "snd1", title: "Podcast", mime: "audio/mpeg" } as FNote;
const audioAttachment = { attachmentId: "att1", title: "Recording", mime: "audio/mpeg" } as FAttachment;

describe("MediaPreview", () => {
    let container: HTMLElement;
    let play: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        container = document.createElement("div");
        document.body.appendChild(container);
        // happy-dom doesn't implement playback; the player calls play() when a preview is activated.
        play = vi.fn(async () => {});
        HTMLMediaElement.prototype.play = play as unknown as HTMLMediaElement["play"];
    });

    afterEach(() => {
        render(null, container);
        container.remove();
    });

    const mediaElement = () => container.querySelector("video, audio") as HTMLMediaElement | null;
    const proxyPlayButton = () => container.querySelector(".media-proxy .media-proxy-play") as HTMLElement | null;

    describe("preview (lazy)", () => {
        it("shows the placeholder and creates no media element, so nothing is streamed", async () => {
            await act(async () => render(<MediaPreview entity={videoNote} environment="preview" />, container));

            expect(container.querySelector(".media-proxy")).not.toBeNull();
            expect(proxyPlayButton()).not.toBeNull();
            // The whole point: no <video>/<audio> exists, so the server is never asked for the media.
            expect(mediaElement()).toBeNull();
            expect(play).not.toHaveBeenCalled();
        });

        it("mounts the player on the media itself, and starts playing, once the user presses play", async () => {
            await act(async () => render(<MediaPreview entity={videoNote} environment="preview" />, container));
            await act(async () => proxyPlayButton()?.click());

            expect(container.querySelector(".media-proxy")).toBeNull();
            const media = mediaElement();
            expect(media?.tagName).toBe("VIDEO");
            expect(media?.getAttribute("src")).toBe("api/notes/vid1/open-partial");

            // The media is only just being fetched, so playback waits for it to become playable.
            expect(play).not.toHaveBeenCalled();
            await act(async () => { media?.dispatchEvent(new Event("canplay")); });
            expect(play).toHaveBeenCalled();
        });

        it("plays an attachment through the same placeholder", async () => {
            await act(async () => render(<MediaPreview entity={audioAttachment} environment="preview" />, container));
            expect(mediaElement()).toBeNull();

            await act(async () => proxyPlayButton()?.click());

            const media = mediaElement();
            expect(media?.tagName).toBe("AUDIO");
            expect(media?.getAttribute("src")).toBe("api/attachments/att1/open-partial");
        });
    });

    describe("eager environments", () => {
        it("mounts an embedded player straight away, without auto-playing it", async () => {
            await act(async () => render(<MediaPreview entity={videoNote} environment="embedded" />, container));

            expect(container.querySelector(".media-proxy")).toBeNull();
            const media = mediaElement();
            expect(media?.getAttribute("src")).toBe("api/notes/vid1/open-partial");
            // Embedded is "ready to play", not "playing".
            expect(media?.getAttribute("preload")).toBe("metadata");
            expect(play).not.toHaveBeenCalled();
        });

        it("mounts the standalone player, which may buffer ahead in full", async () => {
            await act(async () => render(<MediaPreview entity={audioNote} environment="standalone" />, container));

            const media = mediaElement();
            expect(media?.tagName).toBe("AUDIO");
            expect(media?.getAttribute("preload")).toBe("auto");
            expect(play).not.toHaveBeenCalled();
        });
    });

    it("picks the player from the mime type and tags the wrapper with its environment", async () => {
        await act(async () => render(<MediaPreview entity={videoNote} environment="embedded" />, container));
        expect(container.querySelector(".video-preview-wrapper.media-env-embedded")).not.toBeNull();

        await act(async () => render(<MediaPreview entity={audioNote} environment="standalone" />, container));
        expect(container.querySelector(".audio-preview-wrapper.media-env-standalone")).not.toBeNull();
    });

    it("hides the folder play mode outside the note detail, where there is no folder to set it on", async () => {
        await act(async () => render(<MediaPreview entity={videoNote} environment="embedded" />, container));
        expect(container.querySelector(".play-mode-dropdown")).toBeNull();
    });

    describe("compact audio chrome", () => {
        /** The compact chrome is worn everywhere but the note detail — an activated preview and an embed alike. */
        const renderCompactAudio = async (environment: "preview" | "embedded") => {
            await act(async () => render(<MediaPreview entity={audioNote} environment={environment} />, container));
            if (environment === "preview") {
                await act(async () => proxyPlayButton()?.click());
            }
        };

        it.each([ "preview", "embedded" ] as const)("lays %s out as a single play / seek / volume row", async (environment) => {
            await renderCompactAudio(environment);

            expect(container.querySelector(".audio-preview-wrapper.media-compact")).not.toBeNull();
            const row = container.querySelector(".media-compact-row");
            expect(row).not.toBeNull();
            expect(row?.querySelector(".play-button")).not.toBeNull();
            expect(row?.querySelector(".waveform-seekbar")).not.toBeNull();
            expect(row?.querySelector(".media-volume-row")).not.toBeNull();

            // Everything a small host has no room for is gone, along with the full player's stacked rows.
            expect(container.querySelector(".speed-dropdown")).toBeNull();
            expect(container.querySelector(".media-buttons-row")).toBeNull();
        });

        it.each([ "preview", "embedded" ] as const)("gives %s's whole band to a half-scale visualizer, dropping the music icon", async (environment) => {
            await renderCompactAudio(environment);

            expect(container.querySelector(".audio-preview-icon")).toBeNull();
            expect(audioVisualizer).toHaveBeenCalledWith(
                expect.objectContaining({ compact: true }), expect.anything());
        });

        it("leaves the note detail with the full controls and the icon", async () => {
            await act(async () => render(<MediaPreview entity={audioNote} environment="standalone" />, container));

            expect(container.querySelector(".media-compact")).toBeNull();
            expect(container.querySelector(".media-compact-row")).toBeNull();
            expect(container.querySelector(".media-buttons-row")).not.toBeNull();
            expect(container.querySelector(".speed-dropdown")).not.toBeNull();
            expect(container.querySelector(".audio-preview-icon")).not.toBeNull();
            expect(audioVisualizer).toHaveBeenCalledWith(
                expect.objectContaining({ compact: false }), expect.anything());
        });
    });

    describe("compact video chrome", () => {
        const renderCompactVideo = async (environment: "preview" | "embedded") => {
            await act(async () => render(<MediaPreview entity={videoNote} environment={environment} />, container));
            if (environment === "preview") {
                await act(async () => proxyPlayButton()?.click());
            }
        };

        it.each([ "preview", "embedded" ] as const)("collapses %s's overlay to a single play / seek / volume row", async (environment) => {
            await renderCompactVideo(environment);

            const row = container.querySelector(".video-preview-wrapper.media-compact .media-compact-row");
            expect(row).not.toBeNull();
            expect(row?.querySelector(".play-button")).not.toBeNull();
            expect(row?.querySelector(".media-seekbar-row")).not.toBeNull();
            expect(row?.querySelector(".media-volume-row")).not.toBeNull();

            // Speed, rotate and the ±10s skips are gone, along with the full player's stacked rows.
            expect(container.querySelector(".speed-dropdown")).toBeNull();
            expect(container.querySelector(".bx-rotate-right")).toBeNull();
            expect(container.querySelector(".bx-rewind")).toBeNull();
            expect(container.querySelector(".bx-fast-forward")).toBeNull();
            expect(container.querySelector(".media-buttons-row")).toBeNull();
        });

        it("offers fullscreen from an embed, but not from a preview tile", async () => {
            await renderCompactVideo("embedded");
            expect(container.querySelector(".bx-fullscreen")).not.toBeNull();

            await renderCompactVideo("preview");
            expect(container.querySelector(".bx-fullscreen")).toBeNull();
        });

        it("leaves the note detail with the full overlay", async () => {
            await act(async () => render(<MediaPreview entity={videoNote} environment="standalone" />, container));

            expect(container.querySelector(".media-compact-row")).toBeNull();
            expect(container.querySelector(".media-buttons-row")).not.toBeNull();
            expect(container.querySelector(".speed-dropdown")).not.toBeNull();
            expect(container.querySelector(".bx-rotate-right")).not.toBeNull();
            expect(container.querySelector(".bx-fullscreen")).not.toBeNull();
        });
    });

    describe("file actions", () => {
        const fileActions = () => ({
            download: container.querySelector(".media-compact-row .bx-download"),
            open: container.querySelector(".media-compact-row .bx-link-external")
        });

        it.each([ "audio", "video" ] as const)("puts Download / Open at the end of an embedded %s player's controls", async (kind) => {
            const entity = kind === "audio" ? audioNote : videoNote;
            await act(async () => render(<MediaPreview entity={entity} environment="embedded" />, container));

            const { download, open } = fileActions();
            expect(download).not.toBeNull();
            expect(open).not.toBeNull();
            // They come last, after the playback controls.
            expect(download?.previousElementSibling).not.toBeNull();
        });

        it("leaves them out of a preview, which keeps the renderer's footer below the player instead", async () => {
            await act(async () => render(<MediaPreview entity={audioNote} environment="preview" />, container));
            await act(async () => proxyPlayButton()?.click());

            const { download, open } = fileActions();
            expect(download).toBeNull();
            expect(open).toBeNull();
        });
    });

    it("keeps a preview's clicks to itself, so pressing play in a collection card doesn't open the note", async () => {
        // Both the placeholder and the player it becomes opt out of link navigation (see services/link.ts).
        await act(async () => render(<MediaPreview entity={videoNote} environment="preview" />, container));
        expect(container.querySelector(".media-proxy.no-link-navigation")).not.toBeNull();

        await act(async () => proxyPlayButton()?.click());
        expect(container.querySelector(".video-preview-wrapper.no-link-navigation")).not.toBeNull();

        // An embedded player isn't inside a link, and must not suppress navigation.
        await act(async () => render(<MediaPreview entity={videoNote} environment="embedded" />, container));
        expect(container.querySelector(".no-link-navigation")).toBeNull();
    });
});
