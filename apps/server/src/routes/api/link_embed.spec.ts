import { extractYouTubeVideoId } from "@triliumnext/commons";
import { ValidationError } from "@triliumnext/core";
import type { Request } from "express";
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

describe("extractYouTubeVideoId", () => {
    it("extracts ids and rejects non-YouTube URLs", () => {
        expect(extractYouTubeVideoId("https://www.youtube.com/watch?v=dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
        expect(extractYouTubeVideoId("https://youtu.be/dQw4w9WgXcQ")).toBe("dQw4w9WgXcQ");
        expect(extractYouTubeVideoId("https://example.com")).toBeNull();
    });
});

describe("link-embed getMetadata", () => {
    function req(url?: unknown) { return { query: { url } } as unknown as Request; }

    it("requires a url query parameter", async () => {
        await expect(linkEmbedRoute.getMetadata(req())).rejects.toBeInstanceOf(ValidationError);
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
        safeFetch.mockImplementation(async (url: string) => {
            if (url.includes("fav.ico")) return fakeResponse(Buffer.from([9, 9]), { contentType: "image/x-icon" });
            return fakeResponse(html, { contentType: "text/html" });
        });

        const result = await linkEmbedRoute.getMetadata(req("https://example.com/page"));
        expect(result.embedType).toBe("opengraph");
        expect(result.title).toBe("OG Title");
        expect(result.description).toBe("OG Desc");
        expect(result.siteName).toBe("Example");
    });

    it("falls back to the hostname when the fetch fails", async () => {
        safeFetch.mockResolvedValue(fakeResponse("", { ok: false }));
        const result = await linkEmbedRoute.getMetadata(req("https://broken.example.com/x"));
        expect(result).toEqual({ url: "https://broken.example.com/x", title: "broken.example.com", embedType: "opengraph" });
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
        expect(result).toEqual({ url: "https://example.com/data.json", title: "example.com", embedType: "opengraph" });
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
