import { describe, expect, it } from "vitest";

import { standaloneImageProvider } from "./image_provider.js";

/** Build a 12+ byte buffer starting with the given magic bytes. */
function withMagic(magic: number[], totalLength = 16): Uint8Array {
    const buf = new Uint8Array(totalLength);
    buf.set(magic);
    return buf;
}

function fromString(str: string): Uint8Array {
    const buf = new Uint8Array(Math.max(str.length, 16));
    for (let i = 0; i < str.length; i++) {
        buf[i] = str.charCodeAt(i);
    }
    return buf;
}

describe("standaloneImageProvider.getImageType", () => {
    it("returns null for buffers shorter than 12 bytes", () => {
        expect(standaloneImageProvider.getImageType(new Uint8Array([0xff, 0xd8, 0xff]))).toBeNull();
    });

    it("detects JPEG", () => {
        expect(standaloneImageProvider.getImageType(withMagic([0xff, 0xd8, 0xff]))).toEqual({ ext: "jpg", mime: "image/jpeg" });
    });

    it("detects PNG", () => {
        expect(standaloneImageProvider.getImageType(withMagic([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))).toEqual({ ext: "png", mime: "image/png" });
    });

    it("detects GIF", () => {
        expect(standaloneImageProvider.getImageType(withMagic([0x47, 0x49, 0x46]))).toEqual({ ext: "gif", mime: "image/gif" });
    });

    it("detects WebP (RIFF....WEBP)", () => {
        const buf = withMagic([0x52, 0x49, 0x46, 0x46]);
        buf[8] = 0x57; buf[9] = 0x45; buf[10] = 0x42; buf[11] = 0x50;
        expect(standaloneImageProvider.getImageType(buf)).toEqual({ ext: "webp", mime: "image/webp" });
    });

    it("detects BMP", () => {
        expect(standaloneImageProvider.getImageType(withMagic([0x42, 0x4d]))).toEqual({ ext: "bmp", mime: "image/bmp" });
    });

    it("detects SVG starting with <svg", () => {
        expect(standaloneImageProvider.getImageType(fromString("<svg width='1'></svg>"))).toEqual({ ext: "svg", mime: "image/svg+xml" });
    });

    it("detects SVG declared via XML prolog", () => {
        expect(standaloneImageProvider.getImageType(fromString("<?xml version='1.0'?><svg></svg>"))).toEqual({ ext: "svg", mime: "image/svg+xml" });
    });

    it("does not treat a plain XML prolog without <svg as SVG", () => {
        expect(standaloneImageProvider.getImageType(fromString("<?xml version='1.0'?><html></html>"))).toBeNull();
    });

    it("returns null for unrecognized content", () => {
        expect(standaloneImageProvider.getImageType(new Uint8Array(16))).toBeNull();
    });
});

describe("standaloneImageProvider.processImage", () => {
    it("returns the original buffer with the detected format", async () => {
        const buffer = withMagic([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
        const result = await standaloneImageProvider.processImage(buffer, "x.png", true);
        expect(result.buffer).toBe(buffer);
        expect(result.format).toEqual({ ext: "png", mime: "image/png" });
    });

    it("falls back to octet-stream for unrecognized content", async () => {
        const buffer = new Uint8Array(16);
        const result = await standaloneImageProvider.processImage(buffer, "x.bin", false);
        expect(result.buffer).toBe(buffer);
        expect(result.format).toEqual({ ext: "dat", mime: "application/octet-stream" });
    });
});
