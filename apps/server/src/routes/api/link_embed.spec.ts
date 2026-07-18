import { extractYouTubeVideoId } from "@triliumnext/commons";
import { ValidationError } from "@triliumnext/core";
import type { Request } from "express";
import { Jimp } from "jimp";
import { describe, expect, it, vi } from "vitest";

const safeFetch = vi.hoisted(() => vi.fn());

vi.mock("../../services/safe_fetch.js", () => ({
    // Bypass SSRF/DNS checks in tests — just parse the URL.
    validateUrl: (u: string) => new URL(u),
    safeFetch: (...args: unknown[]) => safeFetch(...args)
}));

import linkEmbedRoute from "./link_embed.js";

function oneShotReader(bytes: Buffer) {
    let sent = false;
    return {
        async read() {
            if (sent) return { done: true, value: undefined };
            sent = true;
            return { done: false, value: new Uint8Array(bytes) };
        },
        async cancel() {}
    };
}

function fakeResponse(payload: string | Buffer, opts: { ok?: boolean; contentType?: string; json?: unknown } = {}) {
    const buf = Buffer.isBuffer(payload) ? payload : Buffer.from(payload);
    const headers: Record<string, string | null> = {
        "content-type": opts.contentType ?? "text/html",
        "content-length": String(buf.byteLength)
    };
    return {
        ok: opts.ok ?? true,
        status: opts.ok === false ? 500 : 200,
        headers: { get: (h: string) => headers[h.toLowerCase()] ?? null },
        body: { getReader: () => oneShotReader(buf) },
        json: async () => opts.json
    };
}

/** A real, decodable PNG so the image pipeline runs for true rather than against a mock. */
async function makePng(width: number, height: number, color: number) {
    const image = new Jimp({ width, height, color });
    return Buffer.from(await image.getBuffer("image/png"));
}

/** Decodes a `data:` URI back into its media type and bytes. */
function parseDataUri(dataUri: string) {
    const match = /^data:([^;]+);base64,(.+)$/.exec(dataUri);
    if (!match) throw new Error(`Not a base64 data URI: ${dataUri.slice(0, 40)}`);
    return { contentType: match[1], buffer: Buffer.from(match[2], "base64") };
}

describe("extractYouTubeVideoId", () => {
    it("extracts ids and rejects non-YouTube URLs", () => {
        expect(extractYouTubeVideoId("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
        expect(extractYouTubeVideoId("https://youtu.be/dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
        expect(extractYouTubeVideoId("https://example.com")).toBeNull();
    });
});

describe("link-embed getMetadata", () => {
    // The URL is POSTed in the body, never in the query string: a query string ends up in every
    // access log along the way, and a pasted URL can carry a one-time token or a signature.
    function req(url?: unknown) { return { body: { url } } as unknown as Request; }

    it("requires a url in the body", async () => {
        await expect(linkEmbedRoute.getMetadata(req())).rejects.toBeInstanceOf(ValidationError);
        await expect(linkEmbedRoute.getMetadata({} as unknown as Request)).rejects.toBeInstanceOf(ValidationError);
    });

    it("returns YouTube metadata via the oEmbed endpoint", async () => {
        safeFetch.mockImplementation(async (url: string) => {
            if (url.includes("favicon")) return fakeResponse(Buffer.from([1, 2, 3]), { contentType: "image/x-icon" });
            return fakeResponse("", { json: { title: "Cool Video", author_name: "Channel", thumbnail_url: "https://img/thumb.jpg" } });
        });

        const result = await linkEmbedRoute.getMetadata(req("https://www.youtube.com/watch?v=dQw4w9WgXcQ"));
        expect(result.embedType).toBe("youtube");
        expect(result.title).toBe("Cool Video");
        expect(result.description).toBe("Channel");
        expect(result.favicon).toMatch(/^data:image\//);
    });

    it("parses OpenGraph metadata from an HTML page", async () => {
        const html = `<html><head>
            <meta property="og:title" content="OG Title">
            <meta property="og:description" content="OG Desc">
            <meta property="og:image" content="https://site/img.png">
            <meta property="og:site_name" content="Example">
            <link rel="icon" href="/fav.ico">
        </head></html>`;
        const png = await makePng(40, 20, 0xff0000ff);
        safeFetch.mockImplementation(async (url: string) => {
            if (url.includes("fav.ico")) return fakeResponse(Buffer.from([9, 9]), { contentType: "image/x-icon" });
            if (url.includes("img.png")) return fakeResponse(png, { contentType: "image/png" });
            return fakeResponse(html, { contentType: "text/html" });
        });

        const result = await linkEmbedRoute.getMetadata(req("https://example.com/page"));
        expect(result.embedType).toBe("opengraph");
        expect(result.title).toBe("OG Title");
        expect(result.description).toBe("OG Desc");
        expect(result.siteName).toBe("Example");
        // Embedded, not hotlinked; opaque, so re-encoded as JPEG.
        expect(result.image).toMatch(/^data:image\/jpeg;base64,/);
    });

    it("resolves a relative og:image against the page URL before downloading it", async () => {
        // A relative or protocol-relative og:image would otherwise be resolved against Trilium's own
        // origin, so the image would be downloaded from the wrong place (or not at all).
        const page = (image: string) => `<html><head><title>T</title><meta property="og:image" content="${image}"></head></html>`;
        const png = await makePng(10, 10, 0xff0000ff);

        const requestedImageUrl = async (image: string) => {
            safeFetch.mockReset();
            safeFetch.mockImplementation(async (url: string) => {
                if (url.endsWith(".png")) return fakeResponse(png, { contentType: "image/png" });
                return fakeResponse(page(image), { contentType: "text/html" });
            });
            await linkEmbedRoute.getMetadata(req("https://example.com/blog/post"));
            // Ignore the site-icon fallback, which kicks in whenever the og:image yields nothing.
            return safeFetch.mock.calls
                .map((call) => call[0])
                .find((url: string) => url.endsWith(".png") && !url.includes("apple-touch-icon"));
        };

        expect(await requestedImageUrl("/img/cover.png")).toBe("https://example.com/img/cover.png");
        expect(await requestedImageUrl("cover.png")).toBe("https://example.com/blog/cover.png");
        expect(await requestedImageUrl("//cdn.example.com/cover.png")).toBe("https://cdn.example.com/cover.png");
        expect(await requestedImageUrl("https://cdn.example.com/cover.png")).toBe("https://cdn.example.com/cover.png");
        // Malformed enough that it cannot form a URL even against a valid base: never downloaded.
        expect(await requestedImageUrl("http://[")).toBeUndefined();
    });

    describe("preview image embedding", () => {
        /** Serves `image` for the og:image URL, and a minimal page pointing at it for anything else. */
        function serveImage(image: { payload: string | Buffer; contentType: string; ok?: boolean }) {
            const html = `<html><head><title>T</title><meta property="og:image" content="/cover"></head></html>`;
            safeFetch.mockImplementation(async (url: string) => {
                if (url.endsWith("/cover")) return fakeResponse(image.payload, { contentType: image.contentType, ok: image.ok });
                return fakeResponse(html, { contentType: "text/html" });
            });
        }

        async function imageOf() {
            const result = await linkEmbedRoute.getMetadata(req("https://example.com/page"));
            // The rest of the preview must survive whatever happens to the image.
            expect(result.title).toBe("T");
            return result.image;
        }

        it("scales an oversized image down to the 256px limit, preserving the aspect ratio", async () => {
            serveImage({ payload: await makePng(1024, 512, 0x00ff00ff), contentType: "image/png" });

            const image = await imageOf();
            expect(image).toMatch(/^data:image\/jpeg;base64,/);

            const decoded = await Jimp.read(parseDataUri(image ?? "").buffer);
            expect(decoded.bitmap.width).toBe(256);
            expect(decoded.bitmap.height).toBe(128);
        });

        it("keeps transparency by re-encoding a transparent image as PNG", async () => {
            serveImage({ payload: await makePng(400, 400, 0x00000000), contentType: "image/png" });

            const image = await imageOf();
            expect(image).toMatch(/^data:image\/png;base64,/);

            const decoded = await Jimp.read(parseDataUri(image ?? "").buffer);
            expect(decoded.bitmap.width).toBe(256);
            expect(decoded.hasAlpha()).toBe(true);
        });

        it("does not enlarge an image that is already smaller than the limit", async () => {
            serveImage({ payload: await makePng(64, 32, 0xff0000ff), contentType: "image/png" });

            const decoded = await Jimp.read(parseDataUri(await imageOf() ?? "").buffer);
            expect(decoded.bitmap.width).toBe(64);
            expect(decoded.bitmap.height).toBe(32);
        });

        it("embeds an SVG verbatim, but drops one over 100KB", async () => {
            const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>`;
            serveImage({ payload: svg, contentType: "image/svg+xml" });
            expect(parseDataUri(await imageOf() ?? "")).toMatchObject({ contentType: "image/svg+xml" });

            const hugeSvg = svg.replace("<rect", `<!--${"x".repeat(100 * 1024)}--><rect`);
            serveImage({ payload: hugeSvg, contentType: "image/svg+xml" });
            expect(await imageOf()).toBeUndefined();
        });

        it("keeps an undecodable image format (WebP, AVIF) verbatim when it is small enough", async () => {
            // Jimp bundles no WebP decoder, so these bytes cannot be resized — but they must still not
            // be hotlinked. Anything over the verbatim cap is dropped instead.
            serveImage({ payload: Buffer.from("RIFF????WEBPVP8 not-really"), contentType: "image/webp" });
            expect(await imageOf()).toMatch(/^data:image\/webp;base64,/);

            serveImage({ payload: Buffer.alloc(150 * 1024, 1), contentType: "image/webp" });
            expect(await imageOf()).toBeUndefined();
        });

        it("drops the image, keeping the rest of the preview, when it cannot be fetched", async () => {
            serveImage({ payload: "", contentType: "image/png", ok: false });
            expect(await imageOf()).toBeUndefined();
        });

        it("does not embed a non-image response served in place of the image", async () => {
            serveImage({ payload: "<html>404</html>", contentType: "text/html" });
            expect(await imageOf()).toBeUndefined();
        });
    });

    describe("falling back to the site icon when there is no og:image", () => {
        /** Serves a page whose <head> is `head`, plus a PNG of the given size for every icon URL. */
        function servePage(head: string, icons: Record<string, { width: number; height: number }>) {
            const html = `<html><head><title>T</title>${head}</head></html>`;
            safeFetch.mockImplementation(async (url: string) => {
                for (const [path, size] of Object.entries(icons)) {
                    if (url.endsWith(path)) {
                        return fakeResponse(await makePng(size.width, size.height, 0xff0000ff), { contentType: "image/png" });
                    }
                }
                if (url.endsWith("/page")) return fakeResponse(html, { contentType: "text/html" });
                return fakeResponse("", { ok: false });
            });
        }

        const metadataFor = () => linkEmbedRoute.getMetadata(req("https://example.com/page"));

        it("uses a large apple-touch-icon as the image", async () => {
            servePage(`<link rel="apple-touch-icon" href="/touch.png">`, { "/touch.png": { width: 180, height: 180 } });

            const result = await metadataFor();
            expect(result.image).toMatch(/^data:image\//);

            const decoded = await Jimp.read(parseDataUri(result.image ?? "").buffer);
            expect(decoded.bitmap.width).toBe(180);
        });

        it("ignores an icon that is too small to serve as a card image", async () => {
            servePage(`<link rel="icon" sizes="32x32" href="/small.png">`, { "/small.png": { width: 32, height: 32 } });

            // The declared size rules it out without even downloading it, and the undeclared
            // /apple-touch-icon.png convention is not served here either.
            expect((await metadataFor()).image).toBeUndefined();
        });

        it("rejects an icon whose real size is below the floor even when it claims otherwise", async () => {
            // The `sizes` attribute is a hint, not a fact: the decoded bytes decide.
            servePage(`<link rel="icon" sizes="192x192" href="/lying.png">`, { "/lying.png": { width: 48, height: 48 } });

            expect((await metadataFor()).image).toBeUndefined();
        });

        it("tries the largest declared icon first", async () => {
            servePage(
                `<link rel="icon" sizes="96x96" href="/medium.png">`
                + `<link rel="icon" sizes="192x192" href="/large.png">`,
                { "/medium.png": { width: 96, height: 96 }, "/large.png": { width: 192, height: 192 } }
            );

            const decoded = await Jimp.read(parseDataUri((await metadataFor()).image ?? "").buffer);
            expect(decoded.bitmap.width).toBe(192);
        });

        it("falls back to the conventional /apple-touch-icon.png when none is declared", async () => {
            servePage("", { "/apple-touch-icon.png": { width: 180, height: 180 } });

            expect((await metadataFor()).image).toMatch(/^data:image\//);
        });

        it("prefers a real og:image over the site icon", async () => {
            servePage(
                `<meta property="og:image" content="/cover.png"><link rel="apple-touch-icon" href="/touch.png">`,
                { "/cover.png": { width: 600, height: 300 }, "/touch.png": { width: 180, height: 180 } }
            );

            const decoded = await Jimp.read(parseDataUri((await metadataFor()).image ?? "").buffer);
            // The og:image is 2:1, the icon is square — the aspect ratio identifies which one was used.
            expect(decoded.bitmap.width).toBe(256);
            expect(decoded.bitmap.height).toBe(128);
        });
    });

    it("falls back to the hostname when the fetch fails, flagging the result unresolved", async () => {
        safeFetch.mockResolvedValue(fakeResponse("", { ok: false }));
        const result = await linkEmbedRoute.getMetadata(req("https://broken.example.com/x"));
        expect(result).toEqual({ url: "https://broken.example.com/x", title: "broken.example.com", embedType: "opengraph", unresolved: true });
    });

    it("treats a page carrying no title of its own as unresolved", async () => {
        // A bot-challenge interstitial (or any titleless page) answers 200 with HTML but names
        // nothing, leaving us with the hostname we already had.
        safeFetch.mockResolvedValue(fakeResponse("<html><head></head><body>nope</body></html>", { contentType: "text/html" }));
        const result = await linkEmbedRoute.getMetadata(req("https://example.com/page"));
        expect(result).toEqual({ url: "https://example.com/page", title: "example.com", embedType: "opengraph", unresolved: true });
    });

    it("does not flag a successfully scraped page", async () => {
        const html = `<html><head><title>Real Page</title></head></html>`;
        safeFetch.mockResolvedValue(fakeResponse(html, { contentType: "text/html" }));
        const result = await linkEmbedRoute.getMetadata(req("https://example.com/page"));
        expect(result.title).toBe("Real Page");
        expect(result.unresolved).toBeUndefined();
    });

    it("uses a generic YouTube title when oEmbed is unavailable", async () => {
        safeFetch.mockImplementation(async (url: string) => {
            if (url.includes("favicon")) return fakeResponse(Buffer.from([1]), { contentType: "image/x-icon" });
            return fakeResponse("", { ok: false }); // oembed fails
        });
        const result = await linkEmbedRoute.getMetadata(req("https://youtu.be/dQw4w9WgXcQ"));
        expect(result.embedType).toBe("youtube");
        expect(result.title).toBe("YouTube Video");
    });

    it("falls back when the page is not HTML", async () => {
        safeFetch.mockResolvedValue(fakeResponse("not html", { contentType: "application/json" }));
        const result = await linkEmbedRoute.getMetadata(req("https://example.com/data.json"));
        expect(result).toEqual({ url: "https://example.com/data.json", title: "example.com", embedType: "opengraph", unresolved: true });
    });

    it("keeps a YouTube link resolved even when oEmbed fails, since the player needs no metadata", async () => {
        safeFetch.mockResolvedValue(fakeResponse("", { ok: false }));
        const result = await linkEmbedRoute.getMetadata(req("https://youtu.be/dQw4w9WgXcQ"));
        expect(result.unresolved).toBeUndefined();
    });

    it("drops a favicon whose stream exceeds the limit despite a smaller advertised size", async () => {
        // A lying content-length must not bypass the cap: the limit is enforced while streaming too.
        const html = `<html><head><title>Plain</title><link rel="icon" href="/liar.ico"></head></html>`;
        const chunk = Buffer.alloc(40 * 1024, 7);
        safeFetch.mockImplementation(async (url: string) => {
            if (url.includes("liar.ico")) {
                let sent = 0;
                return {
                    ok: true,
                    status: 200,
                    // No content-type either, exercising the caller-provided default.
                    headers: { get: (h: string) => (h.toLowerCase() === "content-length" ? "10" : null) },
                    body: {
                        getReader: () => ({
                            async read() {
                                if (sent >= 2) return { done: true, value: undefined };
                                sent++;
                                return { done: false, value: new Uint8Array(chunk) };
                            },
                            async cancel() {}
                        })
                    },
                    json: async () => undefined
                };
            }
            return fakeResponse(html, { contentType: "text/html" });
        });

        const result = await linkEmbedRoute.getMetadata(req("https://example.com/page"));
        expect(result.title).toBe("Plain");
        expect(result.favicon).toBeUndefined();
    });

    it("keeps the preview when the favicon download throws or has no body", async () => {
        const html = `<html><head><title>Plain</title><link rel="icon" href="/fav.ico"></head></html>`;

        // The favicon fetch itself throws (network error): swallowed, the preview survives.
        safeFetch.mockImplementation(async (url: string) => {
            if (url.includes("fav.ico")) throw new Error("network down");
            return fakeResponse(html, { contentType: "text/html" });
        });
        let result = await linkEmbedRoute.getMetadata(req("https://example.com/page"));
        expect(result.title).toBe("Plain");
        expect(result.favicon).toBeUndefined();

        // A bodyless favicon response: nothing to stream, same graceful outcome.
        safeFetch.mockImplementation(async (url: string) => {
            if (url.includes("fav.ico")) return { ...fakeResponse(""), body: undefined };
            return fakeResponse(html, { contentType: "text/html" });
        });
        result = await linkEmbedRoute.getMetadata(req("https://example.com/page"));
        expect(result.favicon).toBeUndefined();
    });

    it("treats a bodyless or content-type-less page response as unresolved", async () => {
        // No body: there is no HTML to read, so the page names itself nowhere.
        safeFetch.mockResolvedValue({ ...fakeResponse("<html><head><title>T</title></head></html>"), body: undefined });
        let result = await linkEmbedRoute.getMetadata(req("https://example.com/page"));
        expect(result.unresolved).toBe(true);

        // No content-type header at all: not provably HTML, same as a wrong content type.
        const response = fakeResponse("<html><head><title>T</title></head></html>");
        response.headers = { get: () => null };
        safeFetch.mockResolvedValue(response);
        result = await linkEmbedRoute.getMetadata(req("https://example.com/page"));
        expect(result.unresolved).toBe(true);
    });

    it("skips icon links it cannot use, ranks a scalable 'any' icon first and dedupes the conventional path", async () => {
        const html = `<html><head><title>T</title>
            <link href="/no-rel.png">
            <link rel="stylesheet" href="/style.css">
            <link rel="icon">
            <link rel="icon" sizes="garbage" href="/undeclared.png">
            <link rel="icon" sizes="any" href="/scalable.svg">
            <link rel="apple-touch-icon" href="/apple-touch-icon.png">
        </head></html>`;
        const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>`;
        // The call log is inspected below, so drop the calls accumulated by earlier tests.
        safeFetch.mockReset();
        safeFetch.mockImplementation(async (url: string) => {
            if (url.endsWith("/scalable.svg")) return fakeResponse(svg, { contentType: "image/svg+xml" });
            if (url.endsWith("/page")) return fakeResponse(html, { contentType: "text/html" });
            return fakeResponse("", { ok: false });
        });

        const result = await linkEmbedRoute.getMetadata(req("https://example.com/page"));
        // "any" declares a scalable icon — the best possible candidate, tried (and kept) first.
        expect(result.image).toMatch(/^data:image\/svg\+xml;base64,/);
        // The declared apple-touch-icon href dedupes against the conventional fallback path, so it
        // is never requested twice.
        const touchIconRequests = safeFetch.mock.calls
            .map((call) => String(call[0]))
            .filter((url) => url.includes("apple-touch-icon"));
        expect(touchIconRequests.length).toBeLessThanOrEqual(1);
    });

    it("sets no title or thumbnail override when oEmbed answers with an empty payload", async () => {
        const thumb = await makePng(120, 90, 0xff0000ff);
        safeFetch.mockImplementation(async (url: string) => {
            if (url.includes("oembed")) return fakeResponse("", { json: {} });
            if (url.includes("hqdefault.jpg")) return fakeResponse(thumb, { contentType: "image/jpeg" });
            if (url.includes("favicon")) return fakeResponse(Buffer.from([1]), { contentType: "image/x-icon" });
            return fakeResponse("", { ok: false });
        });

        const result = await linkEmbedRoute.getMetadata(req("https://youtu.be/dQw4w9WgXcQ"));
        expect(result.embedType).toBe("youtube");
        // An empty payload is not an error: nothing throws, so the generic fallback title is not
        // used either, and the thumbnail comes from the conventional hqdefault URL.
        expect(result.title).toBeUndefined();
        expect(result.description).toBeUndefined();
        expect(result.image).toMatch(/^data:image\/jpeg;base64,/);
    });

    it("ignores meta tags whose content is empty, falling back to the document title", async () => {
        const html = `<html><head>
            <meta property="og:title" content="">
            <meta name="description" content="">
            <title>Doc Title</title>
        </head></html>`;
        safeFetch.mockResolvedValue(fakeResponse(html, { contentType: "text/html" }));

        const result = await linkEmbedRoute.getMetadata(req("https://example.com/page"));
        expect(result.title).toBe("Doc Title");
        expect(result.description).toBeUndefined();
    });

    it("ignores a favicon that advertises a size over the limit", async () => {
        const html = `<html><head><title>Plain</title><link rel="icon" href="/big.ico"></head></html>`;
        safeFetch.mockImplementation(async (url: string) => {
            if (url.includes("big.ico")) {
                const big = fakeResponse(Buffer.from([1, 2, 3]), { contentType: "image/x-icon" });
                (big.headers as { get: (h: string) => string | null }).get = (h: string) =>
                    h.toLowerCase() === "content-length" ? String(1024 * 1024) : "image/x-icon";
                return big;
            }
            return fakeResponse(html, { contentType: "text/html" });
        });
        const result = await linkEmbedRoute.getMetadata(req("https://example.com/page"));
        expect(result.title).toBe("Plain");
        expect(result.favicon).toBeUndefined();
    });
});
