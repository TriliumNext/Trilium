import { describe, expect, it, vi } from "vitest";

import { stopBackgroundMedia } from "./media_playback.js";

/** Tracks assignments to `iframe.src`, returning a getter for the count. */
function trackSrc(iframe: HTMLIFrameElement) {
    let value = iframe.getAttribute("src") ?? "";
    let setCount = 0;
    Object.defineProperty(iframe, "src", {
        get: () => value,
        set: (v: string) => {
            value = v;
            setCount++;
        },
        configurable: true
    });
    return () => setCount;
}

describe("stopBackgroundMedia", () => {
    it("pauses HTML5 media and reloads only known video-embed iframes", () => {
        const container = document.createElement("div");
        container.innerHTML = `
            <video></video>
            <audio></audio>
            <figure class="media"><div data-oembed-url="x"><iframe src="https://www.youtube.com/embed/a"></iframe></div></figure>
            <div class="link-embed-video"><iframe src="https://www.youtube-nocookie.com/embed/b"></iframe></div>
            <iframe class="pdf" src="blob:pdf"></iframe>
        `;

        const video = container.querySelector("video")!;
        const audio = container.querySelector("audio")!;
        video.pause = vi.fn();
        audio.pause = vi.fn();

        const mediaIframe = container.querySelector("figure.media iframe") as HTMLIFrameElement;
        const linkEmbedIframe = container.querySelector(".link-embed-video iframe") as HTMLIFrameElement;
        const pdfIframe = container.querySelector("iframe.pdf") as HTMLIFrameElement;
        const mediaSets = trackSrc(mediaIframe);
        const linkSets = trackSrc(linkEmbedIframe);
        const pdfSets = trackSrc(pdfIframe);

        stopBackgroundMedia(container);

        expect(video.pause).toHaveBeenCalledTimes(1);
        expect(audio.pause).toHaveBeenCalledTimes(1);
        // Embed iframes reloaded (src reassigned), unrelated PDF iframe untouched.
        expect(mediaSets()).toBe(1);
        expect(linkSets()).toBe(1);
        expect(pdfSets()).toBe(0);
    });

    it("is a no-op for null/empty containers", () => {
        expect(() => stopBackgroundMedia(null)).not.toThrow();
        expect(() => stopBackgroundMedia(document.createElement("div"))).not.toThrow();
    });
});
