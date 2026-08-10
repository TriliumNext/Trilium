import { extractYouTubeVideoId } from "@triliumnext/commons";
import type { Request } from "express";
import { Jimp } from "jimp";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { ValidationError } from "../../errors.js";
import imageService from "../../services/image.js";
import { getImageProvider, type ImageProvider, initImageProvider } from "../../services/image_provider.js";
import { initRequest, readCappedResponse } from "../../services/request.js";
import { fakeRequestProvider } from "../../test/request_provider.js";

const safeFetch = vi.hoisted(() => vi.fn());
const saveImageToAttachment = vi.hoisted(() => vi.fn());
const awaitImageWrite = vi.hoisted(() => vi.fn(async () => {}));

import linkEmbedRoute from "./link_embed.js";

let attachmentCounter = 0;

/**
 * The route stores each picture it downloads as an attachment of the note the preview is going
 * into. What matters here is which picture was handed over, under which role and name — not that a
 * database took it — so the store is stood in for.
 *
 * Spied on the singleton rather than mocked as a module: the storing itself lives in core now, and
 * core reaches its image service by a relative import that a mock of the package barrel would never
 * intercept.
 */
beforeEach(() => {
    attachmentCounter = 0;
    saveImageToAttachment.mockReset();
    saveImageToAttachment.mockImplementation((_noteId: string, _bytes: Uint8Array, fileName: string) => ({
        attachmentId: `att${++attachmentCounter}`,
        title: fileName
    }));

    vi.spyOn(imageService, "saveImageToAttachment").mockImplementation(saveImageToAttachment);
    vi.spyOn(imageService, "awaitImageWrite").mockImplementation(awaitImageWrite);

    installResizer(resizeWithJimp);

    // The route reaches the network through the request provider, so that is where the network is
    // stood in for. Only the getting of the response is faked: what the tests hand back goes through
    // the real readCappedResponse, so the ceilings and the content-type handling under test here are
    // the ones that will run in production rather than a second implementation of them.
    initRequest(fakeRequestProvider({
        fetchResource: async (url, opts) => readCappedResponse(await safeFetch(url, opts), opts.maxBytes)
    }));
});

/** What was handed to the attachment store under a given role, if anything was. */
function stored(role: "favicon" | "coverImage") {
    const call = saveImageToAttachment.mock.calls.find((args: unknown[]) => args[5] === role);

    return call ? { buffer: Buffer.from(call[1] as Uint8Array), fileName: call[2] as string } : undefined;
}

/**
 * Puts a known resizer behind the route.
 *
 * This spec runs under both test projects, and they install different image providers — the server's
 * decodes, standalone's has no decoder at all. Left to whichever one the runtime bootstrapped, half
 * these tests would assert a resize under one and its absence under the other. So the provider is
 * chosen here instead, and what the route does with each kind of answer is tested deliberately
 * rather than by whichever project happened to run it.
 */
function installResizer(resizeForPreview: ImageProvider["resizeForPreview"]) {
    initImageProvider({ ...getImageProvider(), resizeForPreview });
}

/**
 * A resizer that really resizes, standing in for the platform implementation.
 *
 * Deliberately the same shape as the server's, since that is what the route is written against. It
 * is not the same code: the real one lives in the server package with Jimp, along with its own
 * tests. What is under test here is the route's handling of an answer, not the making of one.
 */
const resizeWithJimp: ImageProvider["resizeForPreview"] = async (bytes, { maxEdge, jpegQuality }) => {
    try {
        const image = await Jimp.fromBuffer(Buffer.from(bytes));

        if (image.bitmap.width > maxEdge || image.bitmap.height > maxEdge) {
            image.scaleToFit({ w: maxEdge, h: maxEdge });
        }

        return {
            resized: true,
            bytes: new Uint8Array(image.hasAlpha()
                ? await image.getBuffer("image/png")
                : await image.getBuffer("image/jpeg", { quality: jpegQuality }))
        };
    } catch {
        return { resized: false, reason: "undecodable" };
    }
};

/** What a runtime with no decoder answers — standalone, and the server for a format Jimp refuses. */
const noResizer: ImageProvider["resizeForPreview"] = async () => ({
    resized: false,
    reason: "unsupported-platform"
});

/**
 * What a site answers with, as a real `Response` — so the reading of it is the real reading of it.
 *
 * `json` is a convenience for an oEmbed answer: the payload *is* the JSON, since that is what the
 * route now parses rather than asking a response object to do it.
 */
function fakeResponse(payload: string | Buffer, opts: { ok?: boolean; contentType?: string; json?: unknown } = {}) {
    const body = opts.json !== undefined ? Buffer.from(JSON.stringify(opts.json)) : Buffer.from(payload);

    return new Response(body, {
        status: opts.ok === false ? 500 : 200,
        headers: {
            "content-type": opts.contentType ?? "text/html",
            "content-length": String(body.byteLength)
        }
    });
}

/** A real, decodable PNG so the image pipeline runs for true rather than against a mock. */
async function makePng(width: number, height: number, color: number) {
    const image = new Jimp({ width, height, color });
    return Buffer.from(await image.getBuffer("image/png"));
}

/**
 * A PNG that is genuinely large, for the ceilings that are about bytes rather than pixels.
 *
 * Noise, because a flat colour of any dimensions compresses to a few KB — a 2000x2000 one lands
 * under even the 100KB verbatim cap, so a test written with one would pass while proving nothing.
 */
async function makeNoisyPng(edge: number) {
    const image = new Jimp({ width: edge, height: edge, color: 0x000000ff });

    for (let i = 0; i < image.bitmap.data.length; i += 4) {
        image.bitmap.data[i] = (i * 7919) % 256;
        image.bitmap.data[i + 1] = (i * 104729) % 256;
        image.bitmap.data[i + 2] = (i * 15485863) % 256;
    }

    return Buffer.from(await image.getBuffer("image/png"));
}

/**
 * A real icon directory of one entry, since a favicon is now named by what its bytes say it is
 * rather than by the content type the site served it under.
 */
function makeIco(): Buffer {
    const directory = Buffer.alloc(22);
    directory.writeUInt16LE(1, 2); // type: icon
    directory.writeUInt16LE(1, 4); // one entry
    directory.writeUInt8(16, 6); // width
    directory.writeUInt8(16, 7); // height
    directory.writeUInt32LE(4, 14); // payload length
    directory.writeUInt32LE(directory.length, 18); // where the payload starts

    return Buffer.concat([ directory, Buffer.from([ 0, 0, 0, 0 ]) ]);
}

/**
 * An icon directory of several sizes, the shape a real site's icon takes — Trilium's own carries
 * six, of which only the smallest is ever drawn.
 */
function makeMultiSizeIco(sizes: { edge: number; bytes: number }[]): Buffer {
    const directory = Buffer.alloc(6 + sizes.length * 16);
    directory.writeUInt16LE(1, 2);
    directory.writeUInt16LE(sizes.length, 4);

    const payloads: Buffer[] = [];
    let offset = directory.length;

    for (const [ index, { edge, bytes } ] of sizes.entries()) {
        const at = 6 + index * 16;
        directory.writeUInt8(edge % 256, at); // 256 is written as 0
        directory.writeUInt8(edge % 256, at + 1);
        directory.writeUInt32LE(bytes, at + 8);
        directory.writeUInt32LE(offset, at + 12);
        payloads.push(Buffer.alloc(bytes, edge));
        offset += bytes;
    }

    return Buffer.concat([ directory, ...payloads ]);
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
    function req(url?: unknown, noteId: unknown = "note1") { return { body: { url, noteId } } as unknown as Request; }

    it("requires a url in the body", async () => {
        await expect(linkEmbedRoute.getMetadata(req())).rejects.toBeInstanceOf(ValidationError);
        await expect(linkEmbedRoute.getMetadata({} as unknown as Request)).rejects.toBeInstanceOf(ValidationError);
    });

    it("requires the note the preview is going into", async () => {
        // The pictures are stored as that note's attachments, so there is nowhere to put them
        // without it — and nothing to answer with, the metadata carrying their URLs.
        // Built directly rather than through req(), whose default would supply the very thing
        // these are checking the absence of.
        const withoutNote = { body: { url: "https://example.com" } } as unknown as Request;
        await expect(linkEmbedRoute.getMetadata(withoutNote)).rejects.toBeInstanceOf(ValidationError);
        await expect(linkEmbedRoute.getMetadata(req("https://example.com", 42))).rejects.toBeInstanceOf(ValidationError);
    });

    it("returns YouTube metadata via the oEmbed endpoint", async () => {
        safeFetch.mockImplementation(async (url: string) => {
            if (url.includes("favicon")) return fakeResponse(makeIco(), { contentType: "image/x-icon" });
            return fakeResponse("", { json: { title: "Cool Video", author_name: "Channel", thumbnail_url: "https://img/thumb.jpg" } });
        });

        const result = await linkEmbedRoute.getMetadata(req("https://www.youtube.com/watch?v=dQw4w9WgXcQ"));
        expect(result.embedType).toBe("youtube");
        expect(result.title).toBe("Cool Video");
        expect(result.description).toBe("Channel");
        // Stored as an attachment of the note, titled by the site it belongs to, and referenced
        // from the note by the URL the store answered with.
        expect(stored("favicon")?.fileName).toBe("www.youtube.com.ico");
        expect(result.favicon).toMatch(/^api\/attachments\/att\d+\/image\/www\.youtube\.com\.ico$/);
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
            if (url.includes("fav.ico")) return fakeResponse(makeIco(), { contentType: "image/x-icon" });
            if (url.includes("img.png")) return fakeResponse(png, { contentType: "image/png" });
            return fakeResponse(html, { contentType: "text/html" });
        });

        const result = await linkEmbedRoute.getMetadata(req("https://example.com/page"));
        expect(result.embedType).toBe("opengraph");
        expect(result.title).toBe("OG Title");
        expect(result.description).toBe("OG Desc");
        expect(result.siteName).toBe("Example");
        // Stored, not hotlinked; opaque, so re-encoded as JPEG. Named after the page it is a
        // picture of, which is what a second paste of the same URL reuses it by.
        expect(stored("coverImage")?.fileName).toMatch(/^example\.com-page-[0-9a-f]{8}\.jpeg$/);
        expect(result.image).toMatch(/^api\/attachments\/att\d+\/image\/example\.com-page-[0-9a-f]{8}\.jpeg$/);
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

        /**
         * Runs the route and answers with the cover picture it handed to the store, if any.
         * Earlier runs are forgotten first, so a test that fetches twice reads only the second.
         */
        async function imageOf() {
            saveImageToAttachment.mockClear();
            const result = await linkEmbedRoute.getMetadata(req("https://example.com/page"));
            // The rest of the preview must survive whatever happens to the image.
            expect(result.title).toBe("T");
            return stored("coverImage");
        }

        it("scales an oversized image down to the 256px limit, preserving the aspect ratio", async () => {
            serveImage({ payload: await makePng(1024, 512, 0x00ff00ff), contentType: "image/png" });

            const image = await imageOf();
            expect(image?.fileName).toMatch(/\.jpeg$/);

            const decoded = await Jimp.read(image?.buffer ?? Buffer.alloc(0));
            expect(decoded.bitmap.width).toBe(256);
            expect(decoded.bitmap.height).toBe(128);
        });

        it("keeps transparency by re-encoding a transparent image as PNG", async () => {
            serveImage({ payload: await makePng(400, 400, 0x00000000), contentType: "image/png" });

            const image = await imageOf();
            expect(image?.fileName).toMatch(/\.png$/);

            const decoded = await Jimp.read(image?.buffer ?? Buffer.alloc(0));
            expect(decoded.bitmap.width).toBe(256);
            expect(decoded.hasAlpha()).toBe(true);
        });

        it("does not enlarge an image that is already smaller than the limit", async () => {
            serveImage({ payload: await makePng(64, 32, 0xff0000ff), contentType: "image/png" });

            const decoded = await Jimp.read((await imageOf())?.buffer ?? Buffer.alloc(0));
            expect(decoded.bitmap.width).toBe(64);
            expect(decoded.bitmap.height).toBe(32);
        });

        it("stores an SVG verbatim, but drops one over 100KB", async () => {
            const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>`;
            serveImage({ payload: svg, contentType: "image/svg+xml" });
            expect((await imageOf())?.fileName).toMatch(/\.svg$/);

            const hugeSvg = svg.replace("<rect", `<!--${"x".repeat(100 * 1024)}--><rect`);
            serveImage({ payload: hugeSvg, contentType: "image/svg+xml" });
            expect(await imageOf()).toBeUndefined();
        });

        it("keeps an undecodable image format (WebP, AVIF) verbatim when it is small enough", async () => {
            // Jimp bundles no WebP decoder, so these bytes cannot be resized — but they must still not
            // be hotlinked. Anything over the verbatim cap is dropped instead.
            serveImage({ payload: Buffer.from("RIFF????WEBPVP8 not-really"), contentType: "image/webp" });
            expect((await imageOf())?.fileName).toMatch(/\.webp$/);

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

        /**
         * The runtime with no decoder — standalone, where there is no image library at all. The
         * preview must survive it: a cover small enough to keep is kept exactly as it arrived, which
         * is still stored rather than hotlinked, and one too large is dropped so a note does not
         * take a megabyte of someone else's picture to show a card.
         *
         * This is the same path the server already takes for a WebP its own decoder refuses, which
         * is why there is no third behaviour to write — only a second runtime reaching the second.
         */
        describe("where nothing can scale the picture", () => {
            beforeEach(() => installResizer(noResizer));

            it("keeps a cover image of a storable size exactly as it arrived", async () => {
                const png = await makePng(400, 400, 0x336699ff);
                serveImage({ payload: png, contentType: "image/png" });

                const image = await imageOf();
                expect(image?.fileName).toMatch(/\.png$/);
                // Unscaled and byte-for-byte what the site served.
                expect(image?.buffer.equals(png)).toBe(true);
            });

            it("drops a cover image too large to keep unscaled, leaving the rest of the preview", async () => {
                // Noise rather than a flat colour: a solid 2000x2000 PNG compresses to a few KB and
                // would sail under the verbatim cap this is about.
                serveImage({ payload: await makeNoisyPng(600), contentType: "image/png" });

                expect(await imageOf()).toBeUndefined();

                const result = await linkEmbedRoute.getMetadata(req("https://example.com/page"));
                expect(result.unresolved).toBeFalsy();
                expect(result.title).toBeTruthy();
            });
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

        const metadataFor = () => {
            saveImageToAttachment.mockClear();
            return linkEmbedRoute.getMetadata(req("https://example.com/page"));
        };

        it("uses a large apple-touch-icon as the image", async () => {
            servePage(`<link rel="apple-touch-icon" href="/touch.png">`, { "/touch.png": { width: 180, height: 180 } });

            await metadataFor();
            const decoded = await Jimp.read(stored("coverImage")?.buffer ?? Buffer.alloc(0));
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

            await metadataFor();
            const decoded = await Jimp.read(stored("coverImage")?.buffer ?? Buffer.alloc(0));
            expect(decoded.bitmap.width).toBe(192);
        });

        it("falls back to the conventional /apple-touch-icon.png when none is declared", async () => {
            servePage("", { "/apple-touch-icon.png": { width: 180, height: 180 } });

            await metadataFor();
            expect(stored("coverImage")).toBeDefined();
        });

        it("prefers a real og:image over the site icon", async () => {
            servePage(
                `<meta property="og:image" content="/cover.png"><link rel="apple-touch-icon" href="/touch.png">`,
                { "/cover.png": { width: 600, height: 300 }, "/touch.png": { width: 180, height: 180 } }
            );

            await metadataFor();
            const decoded = await Jimp.read(stored("coverImage")?.buffer ?? Buffer.alloc(0));
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
            if (url.includes("favicon")) return fakeResponse(makeIco(), { contentType: "image/x-icon" });
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
        // A lying content-length must not bypass the cap: the limit is enforced while streaming too,
        // so the read is abandoned partway rather than after the whole of it has arrived.
        const html = `<html><head><title>Plain</title><link rel="icon" href="/liar.ico"></head></html>`;
        const chunk = Buffer.alloc(64 * 1024, 7);
        // How far each read of the body got. One entry per fetch of it: the icon is a candidate for
        // the card's picture as well, and that one is allowed to read far more before it stops.
        const reads: number[] = [];
        let cancelled = false;
        safeFetch.mockImplementation(async (url: string) => {
            if (url.includes("liar.ico")) {
                return {
                    ok: true,
                    status: 200,
                    // No content-type either, exercising the caller-provided default.
                    headers: { get: (h: string) => (h.toLowerCase() === "content-length" ? "10" : null) },
                    body: {
                        getReader: () => {
                            const at = reads.push(0) - 1;

                            return {
                                async read() {
                                    reads[at]++;
                                    return { done: false, value: new Uint8Array(chunk) };
                                },
                                async cancel() {
                                    cancelled = true;
                                }
                            };
                        }
                    },
                    json: async () => undefined
                };
            }
            return fakeResponse(html, { contentType: "text/html" });
        });

        const result = await linkEmbedRoute.getMetadata(req("https://example.com/page"));
        expect(result.title).toBe("Plain");
        expect(result.favicon).toBeUndefined();
        // A body with no end to it: abandoned at the ceiling rather than read for as long as it
        // comes. Four 64KB chunks fit under the 256KB an icon may be fetched at; the fifth is what
        // carries the total past it.
        expect(cancelled).toBe(true);
        expect(reads[0]).toBe(5);
    });

    it("keeps nothing it cannot reference, when the store answers without an id", async () => {
        // Every picture is referenced by `api/attachments/<id>/…`, so a store that answers without
        // one leaves the preview naming an address that could not be built.
        const html = `<html><head><title>Plain</title><link rel="icon" href="/fav.ico"></head></html>`;
        saveImageToAttachment.mockImplementation((_noteId: string, _buffer: Buffer, fileName: string) => ({ title: fileName }));
        safeFetch.mockImplementation(async (url: string) => {
            if (url.includes("fav.ico")) return fakeResponse(makeIco(), { contentType: "image/x-icon" });
            return fakeResponse(html, { contentType: "text/html" });
        });

        const result = await linkEmbedRoute.getMetadata(req("https://example.com/page"));

        expect(result.title).toBe("Plain");
        expect(result.favicon).toBeUndefined();
    });

    it("names a favicon by its own bytes rather than by the content type it was served under", async () => {
        const html = `<html><head><title>Plain</title><link rel="icon" href="/fav.ico"></head></html>`;
        // Serving favicon.ico as an octet-stream is common enough to be the normal case on some
        // hosts. The media type names the extension the attachment is stored under and the type it
        // is later served as, so taking the header's word for it would file the icon as a `.dat`.
        safeFetch.mockImplementation(async (url: string) => {
            if (url.includes("fav.ico")) return fakeResponse(makeIco(), { contentType: "application/octet-stream" });
            return fakeResponse(html, { contentType: "text/html" });
        });

        let result = await linkEmbedRoute.getMetadata(req("https://example.com/page"));
        expect(stored("favicon")?.fileName).toBe("example.com.ico");

        // And the same reading in the other direction: an error page served where the icon should
        // be is not made into one by a content type claiming it is.
        safeFetch.mockImplementation(async (url: string) => {
            if (url.includes("fav.ico")) return fakeResponse("<html>Not found</html>", { contentType: "image/x-icon" });
            return fakeResponse(html, { contentType: "text/html" });
        });

        result = await linkEmbedRoute.getMetadata(req("https://example.com/page"));
        expect(result.favicon).toBeUndefined();
    });

    it("keeps one size out of an icon offering several, so a large file is not lost to the ceiling", async () => {
        // The exact shape that made triliumnotes.org show no icon at all: six sizes totalling
        // 114KB, over the ceiling a favicon is allowed. Fetched whole and stored trimmed, because
        // the sizes are what the choice is made from — enforcing the ceiling on the download
        // instead aborted the stream and threw the icon away.
        const html = `<html><head><title>Plain</title><link rel="icon" href="/fav.ico"></head></html>`;
        const fat = makeMultiSizeIco([
            { edge: 16, bytes: 1128 },
            { edge: 32, bytes: 4264 },
            { edge: 48, bytes: 9640 },
            { edge: 64, bytes: 16936 },
            { edge: 128, bytes: 67624 },
            { edge: 256, bytes: 14550 }
        ]);
        expect(fat.byteLength).toBeGreaterThan(64 * 1024);

        safeFetch.mockImplementation(async (url: string) => {
            if (url.includes("fav.ico")) return fakeResponse(fat, { contentType: "image/vnd.microsoft.icon" });
            return fakeResponse(html, { contentType: "text/html" });
        });

        const result = await linkEmbedRoute.getMetadata(req("https://example.com/page"));

        expect(result.favicon).toBeTruthy();
        expect(stored("favicon")?.fileName).toBe("example.com.ico");
        // The 48x48 entry and a one-entry directory to hold it — not the 16x16 one, which is what
        // a preview draws at and therefore exactly what a 2x or 3x display has to upscale.
        expect(stored("favicon")?.buffer.byteLength).toBe(22 + 9640);
    });

    it("drops an icon that is one picture too large to keep, having nothing to give up", async () => {
        const html = `<html><head><title>Plain</title><link rel="icon" href="/fav.ico"></head></html>`;
        const huge = makeMultiSizeIco([ { edge: 256, bytes: 100 * 1024 } ]);

        safeFetch.mockImplementation(async (url: string) => {
            if (url.includes("fav.ico")) return fakeResponse(huge, { contentType: "image/x-icon" });
            return fakeResponse(html, { contentType: "text/html" });
        });

        const result = await linkEmbedRoute.getMetadata(req("https://example.com/page"));

        expect(result.favicon).toBeUndefined();
        expect(stored("favicon")).toBeUndefined();
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

    it("reads every spelling of an icon rel, and tries them in the order a 16px icon wants", async () => {
        // A browser reads all of these as naming an icon. Asking for three exact spellings instead
        // read a site writing any of the others — `rel="icon shortcut"`, the precomposed
        // apple-touch-icon — as declaring no icon at all.
        const head = `<link rel="mask-icon" href="/pinned.svg">`
            + `<link rel="mask-icon" href="/pinned.png">`
            + `<link rel="ICON SHORTCUT" sizes="16x16" href="/tiny.png">`
            + `<link rel="icon" sizes="32x32" href="/small.png">`
            + `<link rel="apple-touch-icon-precomposed" sizes="180x180" href="/touch.png">`
            + `<link rel="icon" sizes="48x48" href="/right.png">`;
        const serve = (declared = head) => {
            safeFetch.mockReset();
            safeFetch.mockImplementation(async (url: string) => url.endsWith("/page")
                ? fakeResponse(`<html><head><title>T</title>${declared}</head></html>`, { contentType: "text/html" })
                : fakeResponse("", { ok: false }));
        };
        const iconsRequested = () => safeFetch.mock.calls
            .map((call) => String(call[0]))
            .filter((url) => !url.endsWith("/page"));

        serve();
        expect((await linkEmbedRoute.getMetadata(req("https://example.com/page"))).favicon).toBeUndefined();
        // All compressed here, so the size decides: the smallest that still covers a 3x display,
        // the larger one next, and the one that would have to be upscaled last — then /favicon.ico,
        // which no site has to declare. The mask-icon falls past the cap, being a silhouette meant
        // to be tinted rather than drawn.
        expect(iconsRequested().slice(0, 4)).toEqual([
            "https://example.com/right.png",
            "https://example.com/touch.png",
            // Of the two that would have to be upscaled, the larger — and both before the tinted
            // silhouette, which is past the cap.
            "https://example.com/small.png",
            "https://example.com/favicon.ico"
        ]);

        // An SVG — named by its type here, by its extension elsewhere — draws at every size for a
        // few hundred bytes, so it outranks anything a size can be declared for.
        serve(`<link rel="icon" type="image/svg+xml" href="/scalable.svg">${head}`);
        await linkEmbedRoute.getMetadata(req("https://example.com/page"));
        expect(iconsRequested()[0]).toBe("https://example.com/scalable.svg");

        // The same icon offered both ways, which many sites do. An `.ico` holds its pictures
        // uncompressed, so the other one is the same picture for a fraction of the bytes — and the
        // page says which is which before either is fetched.
        serve(`<link rel="icon" href="/fav.ico"><link rel="icon" href="/icon.png">`);
        await linkEmbedRoute.getMetadata(req("https://example.com/page"));
        expect(iconsRequested()[0]).toBe("https://example.com/icon.png");

        // Wikipedia's head exactly, where the compressed candidate is the home-screen icon and the
        // icon file is the site's own. The bytes decide: 1.3KB against 1.7KB there, 3.3KB against
        // 9.7KB on python.org, where the difference between two sizes of one mark drawn at 16
        // pixels is not one a reader can see.
        serve(`<link rel="apple-touch-icon" href="/touch.png"><link rel="icon" href="/fav.ico">`);
        await linkEmbedRoute.getMetadata(req("https://example.com/page"));
        expect(iconsRequested()[0]).toBe("https://example.com/touch.png");

        // A site naming the conventional path itself is not asked for it twice: it is appended only
        // where the ranked candidates do not already hold it. The page carries a picture of its own
        // so that the card never goes looking through the icons as well.
        const cover = await makePng(600, 300, 0xff0000ff);
        safeFetch.mockReset();
        safeFetch.mockImplementation(async (url: string) => {
            if (url.endsWith("/cover.png")) return fakeResponse(cover, { contentType: "image/png" });
            if (url.endsWith("/page")) {
                return fakeResponse(`<html><head><title>T</title><meta property="og:image" content="/cover.png">`
                    + `<link rel="icon" href="/favicon.ico"></head></html>`, { contentType: "text/html" });
            }
            return fakeResponse("", { ok: false });
        });

        await linkEmbedRoute.getMetadata(req("https://example.com/page"));
        expect(iconsRequested().filter((url) => url.endsWith("/favicon.ico"))).toEqual([ "https://example.com/favicon.ico" ]);
    });

    it("keeps trying after an icon that fails to arrive, down to the conventional path", async () => {
        // A declared icon is a promise, not a delivery — it 404s, it answers with an error page
        // under an image content type, it is one picture too large to keep. Taking the first one
        // and giving up cost the preview its icon in every one of those cases, even when the page
        // named a perfectly good second one.
        const twoIcons = `<html><head><title>T</title>`
            + `<link rel="icon" sizes="48x48" href="/gone.png">`
            + `<link rel="icon" sizes="64x64" href="/good.ico">`
            + `</head></html>`;
        safeFetch.mockImplementation(async (url: string) => {
            if (url.endsWith("/good.ico")) return fakeResponse(makeIco(), { contentType: "image/x-icon" });
            if (url.endsWith("/page")) return fakeResponse(twoIcons, { contentType: "text/html" });
            return fakeResponse("", { ok: false });
        });

        expect((await linkEmbedRoute.getMetadata(req("https://example.com/page"))).favicon).toBeTruthy();

        // And when every icon the page names fails, the path every site serves whether it says so
        // or not — appended after the cap, so it is never the candidate that gets dropped.
        const oneDeadIcon = `<html><head><title>T</title><link rel="icon" href="/gone.png"></head></html>`;
        safeFetch.mockImplementation(async (url: string) => {
            if (url.endsWith("/favicon.ico")) return fakeResponse(makeIco(), { contentType: "image/x-icon" });
            if (url.endsWith("/page")) return fakeResponse(oneDeadIcon, { contentType: "text/html" });
            return fakeResponse("", { ok: false });
        });

        expect((await linkEmbedRoute.getMetadata(req("https://example.com/page"))).favicon).toBeTruthy();
    });

    it("treats a bodyless or content-type-less page response as unresolved", async () => {
        // No body: there is no HTML to read, so the page names itself nowhere.
        safeFetch.mockResolvedValue(new Response(null, { headers: { "content-type": "text/html" } }));
        let result = await linkEmbedRoute.getMetadata(req("https://example.com/page"));
        expect(result.unresolved).toBe(true);

        // No content-type header at all: not provably HTML, same as a wrong content type. A byte
        // body is what makes that reachable — a string one would have fetch name it text/plain.
        safeFetch.mockResolvedValue(new Response(Buffer.from("<html><head><title>T</title></head></html>")));
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

        await linkEmbedRoute.getMetadata(req("https://example.com/page"));
        // "any" declares a scalable icon — the best possible candidate, tried (and kept) first.
        expect(stored("coverImage")?.fileName).toMatch(/\.svg$/);
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
            if (url.includes("favicon")) return fakeResponse(makeIco(), { contentType: "image/x-icon" });
            return fakeResponse("", { ok: false });
        });

        const result = await linkEmbedRoute.getMetadata(req("https://youtu.be/dQw4w9WgXcQ"));
        expect(result.embedType).toBe("youtube");
        // An empty payload is not an error: nothing throws, so the generic fallback title is not
        // used either, and the thumbnail comes from the conventional hqdefault URL.
        expect(result.title).toBeUndefined();
        expect(result.description).toBeUndefined();
        expect(stored("coverImage")?.fileName).toMatch(/\.jpeg$/);
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

    it("takes a Twitter card's description where a page offers no OpenGraph one", async () => {
        const describedBy = async (tags: string) => {
            safeFetch.mockResolvedValue(fakeResponse(
                `<html><head><title>T</title>${tags}</head></html>`,
                { contentType: "text/html" }
            ));
            return (await linkEmbedRoute.getMetadata(req("https://example.com/page"))).description;
        };

        // The card spec says `name`; plenty of sites write `property` regardless, and both are read.
        expect(await describedBy(`<meta name="twitter:description" content="From the card">`)).toBe("From the card");
        expect(await describedBy(`<meta property="twitter:description" content="From the card">`)).toBe("From the card");

        // Both of the first two are written to be read on a card, so they come before the one
        // written for a search result.
        expect(await describedBy(
            `<meta property="og:description" content="From OpenGraph">`
            + `<meta name="twitter:description" content="From the card">`
            + `<meta name="description" content="For a search result">`
        )).toBe("From OpenGraph");
        expect(await describedBy(
            `<meta name="twitter:description" content="From the card">`
            + `<meta name="description" content="For a search result">`
        )).toBe("From the card");

        // And a page carrying none of them still says nothing rather than something invented.
        expect(await describedBy("")).toBeUndefined();
    });

    it("falls back to the page's own opening sentence, but only where it says nothing itself", async () => {
        const article = `<article><p>Fowler–Noll–Vo is a non-cryptographic hash function created by Glenn Fowler and others.</p></article>`;
        const describedBy = async (head: string) => {
            safeFetch.mockResolvedValue(fakeResponse(
                `<html><head><title>T</title>${head}</head><body>${article}</body></html>`,
                { contentType: "text/html" }
            ));
            return (await linkEmbedRoute.getMetadata(req("https://example.com/page"))).description;
        };

        // What a Wikipedia article offers: a title and nothing else.
        expect(await describedBy("")).toBe("Fowler–Noll–Vo is a non-cryptographic hash function created by Glenn Fowler and others.");

        // A description the site wrote for the purpose is what it wants shown, so every one of them
        // comes first.
        expect(await describedBy(`<meta property="og:description" content="Written for the card">`)).toBe("Written for the card");
        expect(await describedBy(`<meta name="twitter:description" content="Written for the card">`)).toBe("Written for the card");
        expect(await describedBy(`<meta name="description" content="Written for a search result">`)).toBe("Written for a search result");
    });

    it("ignores a favicon that advertises a size over the limit", async () => {
        const html = `<html><head><title>Plain</title><link rel="icon" href="/big.ico"></head></html>`;
        safeFetch.mockImplementation(async (url: string) => {
            if (url.includes("big.ico")) {
                const big = fakeResponse(makeIco(), { contentType: "image/x-icon" });
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
