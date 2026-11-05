// @vitest-environment happy-dom
// @vitest-environment-options {"settings":{"disableIframePageLoading":true}}
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { measureFaviconVisibility } from "./favicon_contrast.js";
import { enhanceLinkPreviews } from "./link_embed_dom.js";
import { renderLinkEmbedHtml, renderLinkMentionHtml } from "./link_embed_markup.js";

vi.mock("./favicon_contrast.js", async (importOriginal) => ({
    ...await importOriginal<typeof import("./favicon_contrast.js")>(),
    measureFaviconVisibility: vi.fn()
}));

const OPTIONS = { playVideoLabel: "Play video", playAudioLabel: "Play audio" };

/** The icon loaded for measuring, with its `load` or `error` left for the test to fire. */
class FakeImage {
    static instances: FakeImage[] = [];

    src = "";
    private handlers: Record<string, () => void> = {};

    constructor() {
        FakeImage.instances.push(this);
    }

    addEventListener(type: string, handler: () => void) {
        this.handlers[type] = handler;
    }

    fire(type: "load" | "error") {
        this.handlers[type]();
    }
}

/**
 * Measurements are cached for the life of the page, so every test names an icon of its own rather
 * than reusing the previous test's.
 */
let iconCount = 0;
const freshIcon = () => `data:image/png;base64,ICON${++iconCount}`;

/** A preview drawn into the document and enhanced, as the app and the share theme do. */
function render(html: string) {
    const container = document.createElement("div");
    container.innerHTML = html;
    document.body.append(container);
    enhanceLinkPreviews(container);
    return container;
}

/** Lets the measurement's promise settle. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

/** A 16:9 PNG header as a data URL, enough for happy-dom to read the picture's size. */
function pngOfWidth(width: number) {
    const header = new Uint8Array(24);
    // The PNG signature, then the length and name of the IHDR chunk.
    header.set([ 0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a ]);
    header.set([ 0, 0, 0, 13, 0x49, 0x48, 0x44, 0x52 ], 8);
    const view = new DataView(header.buffer);
    view.setUint32(16, width);
    view.setUint32(20, Math.round(width * 9 / 16));
    return `data:image/png;base64,${btoa(String.fromCharCode(...header))}`;
}

beforeEach(() => {
    FakeImage.instances = [];
    vi.stubGlobal("Image", FakeImage);
});

afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    document.body.innerHTML = "";
});

describe("enhanceLinkPreviews", () => {
    const VIDEO = { url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ", embedType: "youtube" };

    it("loads the player under the facade once clicked, with the page's web origin", () => {
        const fade = new EventTarget() as Animation;
        const animate = vi.spyOn(Element.prototype, "animate").mockReturnValue(fade);
        const container = render(renderLinkEmbedHtml(VIDEO, OPTIONS));
        const facade = container.querySelector<HTMLButtonElement>(".link-embed-video-facade");
        expect(container.querySelector("iframe")).toBeNull();

        facade?.click();

        const iframe = container.querySelector("iframe");
        expect(iframe?.getAttribute("src")).toBe("https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ"
            + `?rel=0&autoplay=1&origin=${encodeURIComponent(location.origin)}`);
        expect(iframe?.parentElement?.className).toBe("link-embed-video");
        expect(iframe?.nextElementSibling).toBe(facade);
        expect(facade?.classList.contains("link-embed-video-facade-loading")).toBe(true);
        expect(animate).not.toHaveBeenCalled();

        // Fades out once the player has loaded, and is removed once faded.
        iframe?.dispatchEvent(new Event("load"));
        expect(animate).toHaveBeenCalledExactlyOnceWith(
            { opacity: [ 1, 0 ] }, expect.objectContaining({ duration: 300 })
        );
        expect(animate.mock.contexts[0]).toBe(facade);
        expect(facade?.isConnected).toBe(true);
        fade.dispatchEvent(new Event("finish"));
        expect(facade?.isConnected).toBe(false);
        expect(iframe?.isConnected).toBe(true);
    });

    it("replaces the facade of a video or audio file with a player of its URL once clicked", () => {
        const container = render(renderLinkEmbedHtml({
            url: "https://example.com/a.mp4", embedType: "video", image: "data:image/png;base64,AAA"
        }, OPTIONS) + renderLinkEmbedHtml({
            url: "https://example.com/a.mp3", embedType: "audio"
        }, OPTIONS));
        expect(container.querySelector("video, audio")).toBeNull();

        container.querySelector<HTMLButtonElement>(".link-embed-video-facade")?.click();
        container.querySelector<HTMLButtonElement>(".link-embed-audio-facade")?.click();

        const video = container.querySelector("video");
        expect(video?.parentElement?.className).toBe("link-embed-video");
        expect([ video?.src, video?.poster, video?.controls, video?.autoplay ])
            .toEqual([ "https://example.com/a.mp4", "data:image/png;base64,AAA", true, true ]);
        const audio = container.querySelector("audio");
        expect(audio?.parentElement?.className).toBe("link-embed-audio");
        expect([ audio?.src, audio?.controls, audio?.autoplay ])
            .toEqual([ "https://example.com/a.mp3", true, true ]);
        expect(container.querySelector("button")).toBeNull();
    });

    it("leaves the facade of a file whose stored URL is no web address", () => {
        const container = render(renderLinkEmbedHtml({
            url: "https://example.com/a.mp3", embedType: "audio"
        }, OPTIONS));
        const facade = container.querySelector<HTMLButtonElement>(".link-embed-audio-facade");
        facade?.setAttribute("data-media-url", "javascript:alert(1)");

        facade?.click();

        expect(container.querySelector("audio")).toBeNull();
        expect(facade?.isConnected).toBe(true);
    });

    it("gives the player the focus of the clicked facade, while the facade still has it", () => {
        vi.spyOn(Element.prototype, "animate").mockReturnValue(new EventTarget() as Animation);
        // A click in happy-dom focuses nothing, as in Safari and Firefox on macOS.
        const play = () => {
            const container = render(renderLinkEmbedHtml(VIDEO, OPTIONS));
            container.querySelector<HTMLButtonElement>(".link-embed-video-facade")?.click();
            return container.querySelector("iframe");
        };

        const player = play();
        player?.dispatchEvent(new Event("load"));
        expect(document.activeElement).toBe(player);

        const otherPlayer = play();
        const input = document.createElement("input");
        document.body.append(input);
        input.focus();
        otherPlayer?.dispatchEvent(new Event("load"));
        expect(document.activeElement).toBe(input);
    });

    it("removes the facade without fading it for a user who asks for reduced motion", () => {
        vi.spyOn(window, "matchMedia").mockReturnValue({ matches: true } as MediaQueryList);
        const animate = vi.spyOn(Element.prototype, "animate");
        const container = render(renderLinkEmbedHtml(VIDEO, OPTIONS));
        const facade = container.querySelector<HTMLButtonElement>(".link-embed-video-facade");

        facade?.click();
        expect(facade?.isConnected).toBe(true);
        container.querySelector("iframe")?.dispatchEvent(new Event("load"));

        expect(window.matchMedia).toHaveBeenCalledWith("(prefers-reduced-motion: reduce)");
        expect(animate).not.toHaveBeenCalled();
        expect(facade?.isConnected).toBe(false);
    });

    it("leaves the origin out on the desktop app's custom protocol", () => {
        const happyDOM = (window as unknown as { happyDOM: { setURL(url: string): void } }).happyDOM;
        const previousUrl = location.href;
        happyDOM.setURL("trilium-app://app/index.html");

        try {
            const container = render(renderLinkEmbedHtml(VIDEO, OPTIONS));
            container.querySelector<HTMLButtonElement>(".link-embed-video-facade")?.click();

            expect(container.querySelector("iframe")?.getAttribute("src"))
                .toBe("https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?rel=0&autoplay=1");
        } finally {
            happyDOM.setURL(previousUrl);
        }
    });

    it("replaces a broken cover with the placeholder and drops a broken favicon", () => {
        const container = render(renderLinkEmbedHtml({
            url: "https://example.com",
            embedType: "opengraph",
            image: "api/attachments/deleted1/image/broken.png",
            favicon: freshIcon()
        }, OPTIONS));

        container.querySelector("img.link-embed-card-image")?.dispatchEvent(new Event("error"));
        container.querySelector("img.link-embed-mention-favicon")?.dispatchEvent(new Event("error"));

        expect(container.querySelector("img")).toBeNull();
        expect(container.querySelector(".link-embed-card-image-placeholder")).not.toBeNull();
        expect(container.querySelector(".link-embed-card-url")?.textContent).toBe("example.com");
    });

    it("marks a video thumbnail narrower than 480 pixels as low resolution", () => {
        const LOW_RES = "link-embed-video-thumbnail-lowres";
        const widths = [ 256, 480, 1280 ];
        const measured = render(widths.map((width) => renderLinkEmbedHtml({
            ...VIDEO,
            image: pngOfWidth(width)
        }, OPTIONS)).join(""));
        const thumbnails = [
            ...measured.querySelectorAll<HTMLImageElement>("img.link-embed-video-thumbnail")
        ];

        // happy-dom measures a data: image while parsing, before enhanceLinkPreviews() runs.
        expect(thumbnails.map((thumbnail) => thumbnail.naturalWidth)).toEqual(widths);
        expect(thumbnails.map((thumbnail) => thumbnail.classList.contains(LOW_RES)))
            .toEqual([ true, false, false ]);

        // An attachment URL is not loaded by happy-dom, so its width stays 0 until `load`.
        const loading = render(renderLinkEmbedHtml({
            ...VIDEO,
            image: "api/attachments/thumb1/image/youtube-dQw4w9WgXcQ.jpg"
        }, OPTIONS)).querySelector<HTMLImageElement>("img.link-embed-video-thumbnail");
        expect(loading?.classList.contains(LOW_RES)).toBe(false);

        if (loading) {
            Object.defineProperty(loading, "naturalWidth", { value: 256 });
            loading.dispatchEvent(new Event("load"));
        }
        expect(loading?.classList.contains(LOW_RES)).toBe(true);
    });

    it("marks a favicon the page has to correct, measuring each icon once", async () => {
        vi.mocked(measureFaviconVisibility).mockReturnValue({ onDark: 0, onLight: 1, hasContent: true });
        const icon = freshIcon();
        const container = render(renderLinkMentionHtml({ url: "https://github.com", favicon: icon }, OPTIONS)
            + renderLinkMentionHtml({ url: "https://github.com/x", favicon: icon }, OPTIONS));

        expect(FakeImage.instances).toHaveLength(1);
        expect(FakeImage.instances[0].src).toBe(icon);
        FakeImage.instances[0].fire("load");
        await settle();

        for (const favicon of container.querySelectorAll("img.link-embed-mention-favicon")) {
            expect(favicon.classList.contains("link-embed-favicon-dark")).toBe(true);
        }
    });

    it("leaves a favicon alone when it reads on both backgrounds, or cannot be read", async () => {
        vi.mocked(measureFaviconVisibility).mockReturnValue(undefined);
        const unreadable = render(renderLinkMentionHtml({ url: "https://a.test", favicon: freshIcon() }, OPTIONS));
        const unloadable = render(renderLinkMentionHtml({ url: "https://b.test", favicon: freshIcon() }, OPTIONS));

        FakeImage.instances[0].fire("load");
        FakeImage.instances[1].fire("error");
        await settle();

        for (const container of [ unreadable, unloadable ]) {
            expect(container.querySelector("img.link-embed-mention-favicon")?.className)
                .toBe("link-embed-mention-favicon");
        }
    });
});
