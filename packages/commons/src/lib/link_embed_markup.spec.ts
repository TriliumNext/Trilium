import { describe, expect, it } from "vitest";

import {
    LINK_EMBED_CARD_IMAGE_PLACEHOLDER, readLinkPreviewData, renderLinkEmbedHtml,
    renderLinkMentionHtml
} from "./link_embed_markup.js";

const OPTIONS = { playVideoLabel: "Play \"video\"" };
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
