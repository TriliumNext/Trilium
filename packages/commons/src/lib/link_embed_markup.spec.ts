import { describe, expect, it } from "vitest";

import {
    getLinkPreviewPlayer, getLinkPreviewVideoId, getVideoAspectRatio,
    LINK_EMBED_CARD_IMAGE_PLACEHOLDER, LINK_PREVIEW_DATA_ATTRIBUTES, readLinkPreviewData,
    readMediaEmbedBox, renderLinkEmbedHtml, renderLinkMentionHtml
} from "./link_embed_markup.js";

const OPTIONS = { playVideoLabel: "Play \"video\"", playAudioLabel: "Play audio" };
const VIDEO_URL = "https://www.youtube.com/watch?v=dQw4w9WgXcQ";

describe("readLinkPreviewData", () => {
    it("reads the stored attributes, an absent embed type as a card, nothing without a URL", () => {
        const attributes: Record<string, string> = {
            "data-url": "https://example.com",
            "data-title": "Title",
            "data-site-name": "Example"
        };

        expect(readLinkPreviewData((name) => attributes[name])).toEqual({
            url: "https://example.com",
            embedType: "opengraph",
            title: "Title",
            description: undefined,
            image: undefined,
            favicon: undefined,
            siteName: "Example"
        });
        expect(readLinkPreviewData(() => null)).toBeNull();
    });

    it("reads every field from the attribute that LINK_PREVIEW_DATA_ATTRIBUTES names", () => {
        const data = readLinkPreviewData((name) => `value of ${name}`);

        expect(data).toEqual(Object.fromEntries(Object.entries(LINK_PREVIEW_DATA_ATTRIBUTES)
            .map(([ field, attribute ]) => [ field, `value of ${attribute}` ])));
    });
});

describe("readMediaEmbedBox", () => {
    it("reads an audio file as Small, the one size of its box", () => {
        const read = (attributes: Record<string, string>) =>
            readMediaEmbedBox((name) => attributes[name], { type: "audio" });

        expect(read({ "data-box-size": "small" }))
            .toEqual({ boxSize: "small", isTitleHidden: false });
        expect(read({ "data-box-size": "medium" }))
            .toEqual({ boxSize: "small", isTitleHidden: false });
    });

    it("reads the box size and the title, Full and untitled for a video saved before", () => {
        const read = (attributes: Record<string, string>) =>
            readMediaEmbedBox((name) => attributes[name], { type: "youtube", videoId: "id" });

        expect(read({ "data-box-size": "medium" }))
            .toEqual({ boxSize: "medium", isTitleHidden: false });
        expect(read({ "data-box-size": "full", "data-hide-title": "true" }))
            .toEqual({ boxSize: "full", isTitleHidden: true });
        expect(read({ "data-box-size": "tiny" }))
            .toEqual({ boxSize: "full", isTitleHidden: false });
        expect(read({})).toEqual({ boxSize: "full", isTitleHidden: true });
    });
});

describe("getLinkPreviewVideoId", () => {
    it("gives the ID of a video that plays, and nothing for a card, a page or a file", () => {
        expect(getLinkPreviewVideoId({ url: VIDEO_URL, embedType: "youtube" })).toBe("dQw4w9WgXcQ");
        expect(getLinkPreviewVideoId({ url: VIDEO_URL })).toBe("dQw4w9WgXcQ");
        expect(getLinkPreviewVideoId({ url: VIDEO_URL, embedType: "opengraph" })).toBeNull();
        expect(getLinkPreviewVideoId({ url: VIDEO_URL, embedType: "video" })).toBeNull();
        expect(getLinkPreviewVideoId({ url: "https://example.com", embedType: "youtube" }))
            .toBeNull();
    });
});

describe("getLinkPreviewPlayer", () => {
    it("plays a YouTube video, or a video or audio file at an http(s) URL", () => {
        expect(getLinkPreviewPlayer({ url: VIDEO_URL, embedType: "youtube" }))
            .toEqual({ type: "youtube", videoId: "dQw4w9WgXcQ" });
        expect(getLinkPreviewPlayer({ url: "https://example.com/a.mp4", embedType: "video" }))
            .toEqual({ type: "video" });
        expect(getLinkPreviewPlayer({ url: "http://nas/a", embedType: "audio" }))
            .toEqual({ type: "audio" });
        expect(getLinkPreviewPlayer({ url: "javascript:alert(1)", embedType: "video" }))
            .toBeNull();
        expect(getLinkPreviewPlayer({ url: "https://example.com/a.mp4", embedType: "opengraph" }))
            .toBeNull();
    });
});

describe("getVideoAspectRatio", () => {
    it("reads a width and a height in whole numbers, and nothing else", () => {
        expect([ "9/16", "16/9", "4/3" ].map((aspectRatio) => getVideoAspectRatio({ aspectRatio })))
            .toEqual([ 9 / 16, 16 / 9, 4 / 3 ]);
        expect([ undefined, null, "", "1.5", "0/9", "9/0", "9 / 16", "1/2/3", "12345/1", "-9/16" ]
            .map((aspectRatio) => getVideoAspectRatio({ aspectRatio })))
            .toEqual(Array(10).fill(null));
    });
});

describe("renderLinkMentionHtml", () => {
    it("links the favicon and title, escaped, in a new tab unless editable", () => {
        expect(renderLinkMentionHtml({
            url: "https://example.com/?a=1&b=2",
            title: "<Tom & Jerry's>",
            favicon: "data:image/png;base64,AAA"
        }, OPTIONS)).toBe(
            `<a class="link-embed-mention" href="https://example.com/?a=1&amp;b=2" target="_blank"`
            + ` rel="noopener noreferrer"><img class="link-embed-mention-favicon"`
            + ` src="data:image/png;base64,AAA" alt="" loading="lazy" draggable="false" width="16"`
            + ` height="16"><span class="link-embed-mention-title">`
            + `&lt;Tom &amp; Jerry&#39;s&gt;</span></a>`);

        const editable = { ...OPTIONS, editable: true };
        expect(renderLinkMentionHtml({ url: "https://fallback.example.com/x" }, editable))
            .toBe(`<a class="link-embed-mention" href="https://fallback.example.com/x"`
                + ` rel="noopener noreferrer"><span class="link-embed-mention-title">`
                + `fallback.example.com</span></a>`);
    });

    it("renders a hostile scheme inert and never loads a remote favicon", () => {
        const html = renderLinkMentionHtml({
            url: "javascript:alert(1)",
            favicon: "https://tracker.test/favicon.ico"
        }, OPTIONS);

        expect(html).toContain(`href="about:blank"`);
        expect(html).not.toContain("<img");
    });
});

describe("renderLinkEmbedHtml", () => {
    it("draws a video as a facade holding the stored thumbnail", () => {
        expect(renderLinkEmbedHtml({
            url: VIDEO_URL,
            embedType: "youtube",
            image: "data:image/jpeg;base64,AAA"
        }, OPTIONS)).toBe(
            `<div class="link-embed-video"><button type="button" class="link-embed-video-facade"`
            + ` data-video-id="dQw4w9WgXcQ" aria-label="Play &quot;video&quot;"`
            + ` title="Play &quot;video&quot;">`
            + `<img class="link-embed-video-thumbnail" src="data:image/jpeg;base64,AAA" alt=""`
            + ` loading="lazy" draggable="false">`
            + `<span class="link-embed-video-play" aria-hidden="true">`
            + `</span></button></div>`);
    });

    it("gives the player the shape of its video, when the preview stores a valid one", () => {
        const render = (aspectRatio: string) => renderLinkEmbedHtml({
            url: VIDEO_URL, embedType: "youtube", aspectRatio
        }, OPTIONS);

        expect(render("9/16")).toMatch(
            /^<div class="link-embed-video" style="--video-aspect-ratio:0\.5625"><button /);
        expect(render("9/16\"><script>")).toMatch(/^<div class="link-embed-video"><button /);
    });

    it("draws a video file as a facade that plays its URL, with its thumbnail and shape", () => {
        expect(renderLinkEmbedHtml({
            url: "https://example.com/a&b.mp4",
            embedType: "video",
            image: "api/attachments/abc/image/a.jpg",
            aspectRatio: "4/3"
        }, OPTIONS)).toBe(
            `<div class="link-embed-video" style="--video-aspect-ratio:${4 / 3}">`
            + `<button type="button" class="link-embed-video-facade"`
            + ` data-media-url="https://example.com/a&amp;b.mp4"`
            + ` aria-label="Play &quot;video&quot;" title="Play &quot;video&quot;">`
            + `<img class="link-embed-video-thumbnail" src="api/attachments/abc/image/a.jpg"`
            + ` alt="" loading="lazy" draggable="false">`
            + `<span class="link-embed-video-file-play bx bx-play" aria-hidden="true">`
            + `</span></button></div>`);
    });

    it("draws an audio file as a play button named by its title, else its file name", () => {
        const render = (title?: string) => renderLinkEmbedHtml({
            url: "https://example.com/music/Song%201.mp3", embedType: "audio", title
        }, OPTIONS);

        expect(render("<Song>")).toBe(
            `<div class="link-embed-audio"><button type="button" class="link-embed-audio-facade"`
            + ` data-media-url="https://example.com/music/Song%201.mp3" aria-label="Play audio"`
            + ` title="Play audio"><span class="link-embed-audio-play" aria-hidden="true"></span>`
            + `<span class="link-embed-audio-title">&lt;Song&gt;</span></button></div>`);
        expect(render()).toContain(`<span class="link-embed-audio-title">Song 1.mp3</span>`);
    });

    it("draws a card for a video URL stored as a card, and for an embed that is no video", () => {
        expect(renderLinkEmbedHtml({ url: VIDEO_URL, embedType: "opengraph" }, OPTIONS))
            .toContain(`<a class="link-embed-card"`);
        expect(renderLinkEmbedHtml({ url: "https://example.com", embedType: "youtube" }, OPTIONS))
            .toContain(`<a class="link-embed-card"`);
    });

    it("draws a card with its title, description, cover and site line", () => {
        expect(renderLinkEmbedHtml({
            url: "https://example.com/page",
            embedType: "opengraph",
            title: "A title",
            description: "A description",
            image: "api/attachments/abc123/image/x.png",
            favicon: "data:image/png;base64,AAA",
            siteName: "Example"
        }, OPTIONS)).toBe(
            `<a class="link-embed-card" href="https://example.com/page" target="_blank"`
            + ` rel="noopener noreferrer"><div class="link-embed-card-image-wrapper">`
            + `<img class="link-embed-card-image" src="api/attachments/abc123/image/x.png" alt=""`
            + ` loading="lazy" draggable="false"></div><div class="link-embed-card-content">`
            + `<div class="link-embed-card-title">A title</div>`
            + `<div class="link-embed-card-description">A description</div>`
            + `<div class="link-embed-card-url"><img class="link-embed-mention-favicon"`
            + ` src="data:image/png;base64,AAA" alt="" loading="lazy" draggable="false" width="16"`
            + ` height="16"><span>Example</span></div></div></a>`);
    });

    it("leaves out what the note does not store, falling back to the host and placeholder", () => {
        const html = renderLinkEmbedHtml({
            url: "https://no-meta.example.com/page",
            embedType: "opengraph",
            image: "https://tracker.test/pixel.gif"
        }, { ...OPTIONS, editable: true });

        expect(html).toBe(
            `<a class="link-embed-card" href="https://no-meta.example.com/page"`
            + ` rel="noopener noreferrer"><div class="link-embed-card-image-wrapper">`
            + `${LINK_EMBED_CARD_IMAGE_PLACEHOLDER}</div>`
            + `<div class="link-embed-card-content"><div class="link-embed-card-url">`
            + `<span>no-meta.example.com</span></div></div></a>`);
    });
});
