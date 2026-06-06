import { cls, options } from '@triliumnext/core';
import { Jimp } from 'jimp';
import { afterEach, beforeAll, describe, expect, it } from 'vitest';

import { serverImageProvider } from './image_provider.js';

// is-svg / image-type / is-animated / jimp are all loaded by spec/setup.ts (which
// imports serverImageProvider to initialise core), so they cannot be re-mocked
// reliably. Instead we exercise the real implementations end-to-end with real
// image buffers and drive behaviour through the real (in-memory DB) options.

function setOptions(values: Record<string, string>) {
    cls.init(() => {
        for (const [name, value] of Object.entries(values)) {
            options.setOption(name as Parameters<typeof options.setOption>[0], value);
        }
    });
}

// Real, deterministic image buffers built once.
let tallPng: Uint8Array; // 200x600 -> resized by height
let smallPng: Uint8Array; // 8x8 -> within bounds, jpeg ends up larger
let noisyPng: Uint8Array; // large noisy image where jpeg compression helps
let corruptPng: Uint8Array; // valid PNG signature but unreadable by jimp
const svgBuffer = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"></svg>');
const garbageBuffer = new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]);
const staticGif = Uint8Array.from(
    Buffer.from('R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7', 'base64')
);
const animatedGif = Uint8Array.from(
    Buffer.from(
        'R0lGODlhAQABAPABAP///wAAACH/C05FVFNDQVBFMi4wAwEAAAAh+QQFCgABACwAA' +
        'AAAAQABAAACAkQBACH5BAUKAAEALAAAAAABAAEAAAICRAEAOw==',
        'base64'
    )
);

async function makePng(width: number, height: number, noisy = false): Promise<Uint8Array> {
    const image = new Jimp({ width, height, color: 0x3366ccff });
    if (noisy) {
        for (let x = 0; x < width; x++) {
            for (let y = 0; y < height; y++) {
                const r = (x * 31 + y * 17) % 256;
                const g = (x * 13 + y * 7) % 256;
                const b = (x * 5 + y * 23) % 256;
                const color = (((r << 24) | (g << 16) | (b << 8) | 0xff) >>> 0);
                image.setPixelColor(color, x, y);
            }
        }
    }
    return new Uint8Array(await image.getBuffer('image/png'));
}

beforeAll(async () => {
    tallPng = await makePng(200, 600);
    smallPng = await makePng(8, 8);
    noisyPng = await makePng(600, 400, true);
    const valid = await makePng(8, 8);
    corruptPng = new Uint8Array(
        Buffer.concat([Buffer.from(valid.slice(0, 50)), Buffer.alloc(valid.length, 0xab)])
    );
}, 30000);

afterEach(() => {
    setOptions({ compressImages: 'true', imageJpegQuality: '75', imageMaxWidthHeight: '2000' });
});

describe('serverImageProvider.getImageType', () => {
    it('returns the SVG format for SVG buffers', () => {
        expect(serverImageProvider.getImageType(svgBuffer)).toEqual({
            ext: 'svg',
            mime: 'image/svg+xml'
        });
    });

    it('returns null for non-SVG buffers (async detection handled elsewhere)', () => {
        expect(serverImageProvider.getImageType(smallPng)).toBeNull();
    });
});

describe('serverImageProvider.processImage', () => {
    it('returns the original buffer and detected format when compression is disabled', async () => {
        setOptions({ compressImages: 'false' });

        const result = await serverImageProvider.processImage(smallPng, 'a.png', true);

        expect(result.buffer).toBe(smallPng);
        expect(result.format).toEqual({ ext: 'png', mime: 'image/png' });
    });

    it('uses the octet-stream fallback format when the type cannot be detected', async () => {
        setOptions({ compressImages: 'false' });

        const result = await serverImageProvider.processImage(garbageBuffer, 'unknown.bin', true);

        expect(result.format).toEqual({ ext: 'dat', mime: 'application/octet-stream' });
    });

    it('detects SVG content via getImageTypeFromBuffer', async () => {
        setOptions({ compressImages: 'false' });

        const result = await serverImageProvider.processImage(svgBuffer, 'a.svg', false);

        expect(result.format).toEqual({ ext: 'svg', mime: 'image/svg+xml' });
        expect(result.buffer).toBe(svgBuffer);
    });

    it('does not shrink unsupported (non jpg/png) formats even when shrink is requested', async () => {
        const result = await serverImageProvider.processImage(staticGif, 'a.gif', true);

        expect(result.buffer).toBe(staticGif);
        expect(result.format).toEqual({ ext: 'gif', mime: 'image/gif' });
    });

    it('leaves an animated GIF untouched (skipped at the non-jpg/png format gate)', async () => {
        // image-type classifies an animated GIF as { ext: "gif" }, so it is excluded
        // by the format check BEFORE the isAnimated() guard is ever consulted — the
        // buffer and detected format must be returned unchanged.
        const result = await serverImageProvider.processImage(animatedGif, 'a.gif', true);

        expect(result.buffer).toBe(animatedGif);
        expect(result.format).toEqual({ ext: 'gif', mime: 'image/gif' });
    });

    it('does not shrink when shrink is not requested', async () => {
        const result = await serverImageProvider.processImage(smallPng, 'a.png', false);

        expect(result.buffer).toBe(smallPng);
    });

    it('shrinks a wide image by width', async () => {
        setOptions({ imageMaxWidthHeight: '100' });

        const result = await serverImageProvider.processImage(noisyPng, 'wide.png', true);

        // Noisy 600x400 -> resized to width 100, re-encoded as JPEG (smaller).
        expect(result.buffer.byteLength).toBeLessThan(noisyPng.byteLength);
        expect(result.format).toEqual({ ext: 'jpg', mime: 'image/jpeg' });
    });

    it('resizes a tall image by height', async () => {
        setOptions({ imageMaxWidthHeight: '100' });

        // tallPng (200x600) is taller than wide, so the height-resize branch runs.
        const result = await serverImageProvider.processImage(tallPng, 'tall.png', true);

        expect(result.format).toEqual({ ext: 'jpg', mime: 'image/jpeg' });
        expect(result.buffer.byteLength).toBeLessThan(tallPng.byteLength);
    });

    it('keeps the original buffer when shrinking does not reduce the size', async () => {
        setOptions({ imageMaxWidthHeight: '2000' });

        // A small solid-colour PNG re-encodes to a larger JPEG, so the original wins.
        const result = await serverImageProvider.processImage(smallPng, 'small.png', true);

        expect(result.buffer).toBe(smallPng);
        expect(result.format).toEqual({ ext: 'png', mime: 'image/png' });
    });

    it('falls back to the original buffer when resizing throws', async () => {
        setOptions({ imageMaxWidthHeight: '100' });

        // corruptPng passes image-type detection as PNG but Jimp cannot decode it,
        // so resize() throws and shrinkImage() falls back to the original buffer.
        const result = await serverImageProvider.processImage(corruptPng, 'broken.png', true);

        expect(result.buffer).toBe(corruptPng);
        expect(result.format).toEqual({ ext: 'png', mime: 'image/png' });
    });

    async function shrunkSize(jpegQuality: string): Promise<number> {
        setOptions({ imageMaxWidthHeight: '100', imageJpegQuality: jpegQuality });
        const result = await serverImageProvider.processImage(noisyPng, 'wide.png', true);
        expect(result.format).toEqual({ ext: 'jpg', mime: 'image/jpeg' });
        return result.buffer.byteLength;
    }

    it('clamps out-of-range JPEG quality to the default (75)', async () => {
        // An out-of-range quality must produce byte-identical output to an explicit
        // quality of 75, and differ from a valid in-range quality — proving the clamp
        // actually ran (and the bad value was not passed through).
        const at75 = await shrunkSize('75');
        const valid = await shrunkSize('30');
        const tooLow = await shrunkSize('5');
        const tooHigh = await shrunkSize('150');

        expect(tooLow).toBe(at75);
        expect(tooHigh).toBe(at75);
        expect(valid).not.toBe(at75);
    });
});
