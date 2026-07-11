import { afterEach, describe, expect, it, vi } from "vitest";

import server from "./server.js";
import {
    applyLinkEmbeds,
    detectEmbedType,
    fetchMetadata,
    renderEmbedPreview,
    renderMentionPreview,
    safeHostname
} from "./link_embed.js";

let container: HTMLDivElement | undefined;

function makeContainer() {
    container = document.createElement("div");
    document.body.appendChild(container);
    return container;
}

afterEach(() => {
    if (container) {
        container.remove();
        container = undefined;
    }
    vi.restoreAllMocks();
});

/** Dispatches a native `error` event on an element and flushes Preact's state update. */
async function fireError(el: Element) {
    el.dispatchEvent(new Event("error", { bubbles: false }));
    // Allow Preact's batched setState rerender to flush.
    await new Promise((resolve) => setTimeout(resolve, 0));
}

describe("detectEmbedType", () => {
    it("detects YouTube URLs", () => {
        expect(detectEmbedType("https://youtu.be/fV16ck4Bgc0")).toBe("youtube");
        expect(detectEmbedType("https://www.youtube.com/watch?v=abc12345678")).toBe("youtube");
    });

    it("returns opengraph for non-YouTube URLs", () => {
        expect(detectEmbedType("https://example.com")).toBe("opengraph");
        expect(detectEmbedType("https://github.com/TriliumNext/Notes")).toBe("opengraph");
    });
});

describe("safeHostname", () => {
    it("extracts hostname from valid URL", () => {
        expect(safeHostname("https://www.example.com/page")).toBe("www.example.com");
    });

    it("returns raw string for invalid URL", () => {
        expect(safeHostname("not-a-url")).toBe("not-a-url");
    });

    it("handles URLs with ports", () => {
        expect(safeHostname("http://localhost:8080/api")).toBe("localhost");
    });
});

describe("fetchMetadata", () => {
    it("maps server metadata into the embed shape and encodes the URL", async () => {
        const url = "https://example.com/path?a=b&c=d";
        const fromServer = {
            url: "https://canonical.example.com",
            embedType: "opengraph",
            title: "Title",
            description: "Desc",
            favicon: "https://example.com/favicon.ico",
            siteName: "Example",
            image: "https://example.com/img.png"
        };
        server.get = vi.fn(async () => fromServer) as typeof server.get;

        const result = await fetchMetadata(url);

        expect(server.get).toHaveBeenCalledWith(
            `link-embed/metadata?url=${encodeURIComponent(url)}`
        );
        expect(result).toEqual(fromServer);
    });

    it("falls back to local detection when the server request fails", async () => {
        server.get = vi.fn(async () => {
            throw new Error("network down");
        }) as typeof server.get;

        const result = await fetchMetadata("https://youtu.be/abcdefghijk");
        expect(result).toEqual({
            url: "https://youtu.be/abcdefghijk",
            embedType: "youtube",
            title: "youtu.be"
        });
    });
});

describe("renderEmbedPreview", () => {
    it("renders a YouTube iframe when embedType is not opengraph and the URL is a video", () => {
        const root = makeContainer();
        renderEmbedPreview(root, {
            url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
            embedType: "youtube"
        });

        const iframe = root.querySelector("iframe");
        expect(iframe).not.toBeNull();
        expect(iframe!.getAttribute("src")).toContain("youtube-nocookie.com/embed/dQw4w9WgXcQ");
        expect(root.querySelector("a.link-embed-card")).toBeNull();
    });

    it("renders a card (not an iframe) for a YouTube URL forced to opengraph", () => {
        const root = makeContainer();
        renderEmbedPreview(root, {
            url: "https://www.youtube.com/watch?v=dQw4w9WgXcQ",
            embedType: "opengraph",
            title: "A title",
            description: "A description",
            siteName: "YouTube",
            image: "https://img.example/x.png"
        });

        expect(root.querySelector("iframe")).toBeNull();
        const card = root.querySelector("a.link-embed-card")!;
        expect(card.getAttribute("target")).toBe("_blank");
        expect(card.querySelector(".link-embed-card-title")!.textContent).toBe("A title");
        expect(card.querySelector(".link-embed-card-description")!.textContent).toBe("A description");
        expect(card.querySelector(".link-embed-card-url")!.textContent).toBe("YouTube");
        // image present -> real <img>, no placeholder
        expect(root.querySelector("img.link-embed-card-image")).not.toBeNull();
        expect(root.querySelector(".link-embed-card-image-placeholder")).toBeNull();
    });

    it("omits optional fields and falls back to hostname, and drops target when editable", () => {
        const root = makeContainer();
        renderEmbedPreview(
            root,
            {
                url: "https://no-meta.example.com/page",
                embedType: "opengraph"
            },
            true
        );

        const card = root.querySelector("a.link-embed-card")!;
        expect(card.getAttribute("target")).toBeNull();
        expect(root.querySelector(".link-embed-card-title")).toBeNull();
        expect(root.querySelector(".link-embed-card-description")).toBeNull();
        // siteName missing -> safeHostname(url)
        expect(root.querySelector(".link-embed-card-url")!.textContent).toBe("no-meta.example.com");
        // image missing -> placeholder, no real <img>
        expect(root.querySelector(".link-embed-card-image-placeholder")).not.toBeNull();
        expect(root.querySelector("img.link-embed-card-image")).toBeNull();
    });

    it("replaces a broken card image with the placeholder on error", async () => {
        const root = makeContainer();
        renderEmbedPreview(root, {
            url: "https://example.com",
            embedType: "opengraph",
            image: "https://img.example/broken.png"
        });

        const img = root.querySelector("img.link-embed-card-image")!;
        expect(img).not.toBeNull();
        await fireError(img);

        expect(root.querySelector("img.link-embed-card-image")).toBeNull();
        expect(root.querySelector(".link-embed-card-image-placeholder")).not.toBeNull();
    });
});

describe("renderMentionPreview", () => {
    it("renders favicon img + title, with target=_blank by default", () => {
        const root = makeContainer();
        renderMentionPreview(root, {
            url: "https://example.com",
            title: "Example site",
            favicon: "https://example.com/favicon.ico"
        });

        const anchor = root.querySelector("a.link-embed-mention")!;
        expect(anchor.getAttribute("target")).toBe("_blank");
        expect(anchor.querySelector("img.link-embed-mention-favicon")).not.toBeNull();
        expect(root.querySelector(".link-embed-mention-dot")).toBeNull();
        expect(anchor.querySelector(".link-embed-mention-title")!.textContent).toBe("Example site");
    });

    it("falls back to a dot favicon and hostname title; drops target when editable", () => {
        const root = makeContainer();
        renderMentionPreview(
            root,
            { url: "https://fallback.example.com/x" },
            true
        );

        const anchor = root.querySelector("a.link-embed-mention")!;
        expect(anchor.getAttribute("target")).toBeNull();
        expect(root.querySelector("img.link-embed-mention-favicon")).toBeNull();
        expect(root.querySelector(".link-embed-mention-dot")).not.toBeNull();
        expect(anchor.querySelector(".link-embed-mention-title")!.textContent).toBe("fallback.example.com");
    });

    it("replaces a broken favicon with the dot on error", async () => {
        const root = makeContainer();
        renderMentionPreview(root, {
            url: "https://example.com",
            favicon: "https://example.com/broken.ico"
        });

        const img = root.querySelector("img.link-embed-mention-favicon")!;
        expect(img).not.toBeNull();
        await fireError(img);

        expect(root.querySelector("img.link-embed-mention-favicon")).toBeNull();
        expect(root.querySelector(".link-embed-mention-dot")).not.toBeNull();
    });
});

describe("applyLinkEmbeds", () => {
    it("renders previews from data attributes and skips elements without a url", () => {
        const root = makeContainer();
        root.innerHTML = `
            <section class="link-embed" data-url="https://full.example.com"
                data-embed-type="opengraph" data-title="T" data-description="D"
                data-site-name="Site" data-image="https://img.example/x.png"></section>
            <section class="link-embed"></section>
            <span class="link-mention" data-url="https://m.example.com"
                data-title="MT" data-favicon="https://m.example.com/fav.ico"></span>
            <span class="link-mention"></span>
        `;

        applyLinkEmbeds(root);

        const embeds = root.querySelectorAll("section.link-embed");
        // First embed got rendered into a card; second (no url) stayed empty.
        expect(embeds[0].querySelector("a.link-embed-card")).not.toBeNull();
        expect(embeds[0].querySelector(".link-embed-card-title")!.textContent).toBe("T");
        expect(embeds[1].innerHTML).toBe("");

        const mentions = root.querySelectorAll("span.link-mention");
        expect(mentions[0].querySelector("a.link-embed-mention")).not.toBeNull();
        expect(mentions[0].querySelector(".link-embed-mention-title")!.textContent).toBe("MT");
        expect(mentions[1].innerHTML).toBe("");
    });

    it("defaults embedType to opengraph when the data attribute is absent", () => {
        const root = makeContainer();
        root.innerHTML = `<section class="link-embed" data-url="https://www.youtube.com/watch?v=dQw4w9WgXcQ"></section>`;

        applyLinkEmbeds(root);

        // No embed-type attr -> defaults to "opengraph" -> renders a card, not an iframe.
        const embed = root.querySelector("section.link-embed")!;
        expect(embed.querySelector("iframe")).toBeNull();
        expect(embed.querySelector("a.link-embed-card")).not.toBeNull();
    });
});
