import { cls, estimateJpegQuality, type ImageCompressionRequest, options } from '@triliumnext/core';
import { Jimp } from 'jimp';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';

import { serverImageProvider } from './image_provider.js';
import { compressionConcurrency } from './image_worker_pool.js';

// Four Jimp re-encodes intentionally exercise the JPEG quality clamp. Under the
// full server coverage suite, worker contention can exceed Vitest's 40-second default.
const JPEG_QUALITY_TEST_TIMEOUT = 120_000;

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
let transparentPng: Uint8Array; // 600x400 noisy, every pixel half-transparent
let noisyJpeg: Uint8Array; // 600x400 noisy jpeg stored at high quality
let tinyJpeg: Uint8Array; // 8x8 jpeg that cannot get any smaller
/**
 * A photograph already saved cheaply, which is what most JPEGs in a note are. Re-encoding one of
 * these at a fixed high quality costs more bytes per pixel than a modest resize removes, so it is
 * the case that catches a "keep" path which does not honour the source's own quality.
 */
let lowQualityJpeg: Uint8Array;
/**
 * A photograph's shape rather than a photograph: smooth, spatially correlated colour over
 * thousands of distinct values. PNG stores that poorly and JPEG stores it well, which is the
 * relationship that makes converting worth doing at all.
 *
 * The `noisy` fixtures above are the opposite — pixel-level uncorrelated noise, which JPEG is bad
 * at and which therefore cannot show conversion in a favourable light however high the quality.
 */
let photoPng: Uint8Array;
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

function makeImage(width: number, height: number, { noisy = false, alpha = 0xff } = {}): InstanceType<typeof Jimp> {
    const image = new Jimp({ width, height, color: (0x3366cc00 | alpha) >>> 0 });
    if (noisy) {
        for (let x = 0; x < width; x++) {
            for (let y = 0; y < height; y++) {
                const r = (x * 31 + y * 17) % 256;
                const g = (x * 13 + y * 7) % 256;
                const b = (x * 5 + y * 23) % 256;
                const color = (((r << 24) | (g << 16) | (b << 8) | alpha) >>> 0);
                image.setPixelColor(color, x, y);
            }
        }
    }
    return image;
}

async function makePng(width: number, height: number, noisy = false): Promise<Uint8Array> {
    return new Uint8Array(await makeImage(width, height, { noisy }).getBuffer('image/png'));
}

beforeAll(async () => {
    tallPng = await makePng(200, 600);
    smallPng = await makePng(8, 8);
    noisyPng = await makePng(600, 400, true);
    const valid = await makePng(8, 8);
    corruptPng = new Uint8Array(
        Buffer.concat([Buffer.from(valid.slice(0, 50)), Buffer.alloc(valid.length, 0xab)])
    );
    transparentPng = new Uint8Array(
        await makeImage(600, 400, { noisy: true, alpha: 0x80 }).getBuffer('image/png')
    );
    noisyJpeg = new Uint8Array(
        await makeImage(600, 400, { noisy: true }).getBuffer('image/jpeg', { quality: 100 })
    );
    tinyJpeg = new Uint8Array(await makeImage(8, 8).getBuffer('image/jpeg', { quality: 10 }));

    const photo = new Jimp({ width: 600, height: 400, color: 0x000000ff });
    for (let x = 0; x < 600; x++) {
        for (let y = 0; y < 400; y++) {
            const r = Math.round(128 + 127 * Math.sin(x / 40));
            const g = Math.round(128 + 127 * Math.sin(y / 30));
            const b = Math.round(128 + 127 * Math.sin((x + y) / 50));
            photo.setPixelColor((((r << 24) | (g << 16) | (b << 8) | 0xff) >>> 0), x, y);
        }
    }
    photoPng = new Uint8Array(await photo.getBuffer('image/png'));
    lowQualityJpeg = new Uint8Array(await photo.getBuffer('image/jpeg', { quality: 40 }));
}, 30000);

afterEach(() => {
    setOptions({
        compressImages: 'true',
        imageJpegQuality: '75',
        imageConversionQuality: '75',
        imageMaxWidthHeight: '2000',
        imageResize: 'true',
        imageJpegHandling: 'compress',
        imagePngHandling: 'optimize'
    });
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

    // Recognising an SVG means reading the whole file as a string, which is only worth doing for a
    // buffer that opens like a document — so what counts as "opens like one" has to cover every way
    // a real file starts, not just the bare root element the case above uses.
    it('still recognises an SVG behind a declaration, leading whitespace or a byte-order mark', () => {
        const svg = '<svg xmlns="http://www.w3.org/2000/svg"></svg>';
        const variants = {
            declaration: new TextEncoder().encode(`<?xml version="1.0" encoding="UTF-8"?>\n${svg}`),
            whitespace: new TextEncoder().encode(`\n\n  \t${svg}`),
            comment: new TextEncoder().encode(`<!-- drawn by hand -->\n${svg}`),
            byteOrderMark: Uint8Array.from([ 0xef, 0xbb, 0xbf, ...new TextEncoder().encode(svg) ])
        };

        for (const [ name, buffer ] of Object.entries(variants)) {
            expect(serverImageProvider.getImageType(buffer), name)
                .toEqual({ ext: 'svg', mime: 'image/svg+xml' });
        }
    });
});

describe('serverImageProvider.processImage', () => {
    it('compresses no more arriving images at once than it has room for', async () => {
        // An import hands over one image per note as it reads them, hundreds at a time, from calls
        // that know nothing of each other. Nothing there says how many may be acted on at once, so
        // the provider has to — or, on an installation with no workers to take them, that is
        // hundreds of decodes interleaved on the thread serving the application.
        const inFlight = { now: 0, most: 0 };
        const compressing = vi.spyOn(serverImageProvider, 'compressImage').mockImplementation(async () => {
            inFlight.now++;
            inFlight.most = Math.max(inFlight.most, inFlight.now);
            await new Promise((resolve) => setTimeout(resolve, 5));
            inFlight.now--;

            return { compressed: false, reason: 'no-gain' };
        });

        try {
            const answered = await Promise.all(Array.from({ length: 20 },
                () => serverImageProvider.processImage(smallPng, 'a.png', true)));

            // Every one of them answered, and never more than the pool's own figure at a time.
            expect(answered).toHaveLength(20);
            expect(inFlight.most).toBeLessThanOrEqual(compressionConcurrency());
        } finally {
            compressing.mockRestore();
        }
    });

    it('returns the original buffer and detected format when compression is disabled', async () => {
        // An image that genuinely does compress when the option is on, so what this proves is the
        // switch rather than the image: a picture nothing could shrink comes back untouched either
        // way, and would pass this whether or not the option was ever read.
        setOptions({ compressImages: 'false', imageMaxWidthHeight: '100' });

        const result = await serverImageProvider.processImage(noisyPng, 'a.png', true);

        expect(result.buffer).toBe(noisyPng);
        expect(result.format).toEqual({ ext: 'png', mime: 'image/png' });

        setOptions({ compressImages: 'true' });
        expect((await serverImageProvider.processImage(noisyPng, 'a.png', true)).buffer).not.toBe(noisyPng);
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

        // Noisy 600x400 -> resized to width 100, and written back as the same kind of image:
        // the default handling optimizes a PNG rather than turning it into a JPEG.
        expect(result.buffer.byteLength).toBeLessThan(noisyPng.byteLength);
        expect(result.format).toEqual({ ext: 'png', mime: 'image/png' });
    });

    it('resizes a tall image by height', async () => {
        setOptions({ imageMaxWidthHeight: '100' });

        // tallPng (200x600) is taller than wide, so the height-resize branch runs.
        const result = await serverImageProvider.processImage(tallPng, 'tall.png', true);

        expect(result.format).toEqual({ ext: 'png', mime: 'image/png' });
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

    /**
      * Shrinks the noisy PNG under the given settings, converting it — which the default handling
      * does not do, so the two tests below that are about conversion ask for it by name.
      */
    async function shrunkSize(values: Record<string, string>): Promise<number> {
        setOptions({ imageMaxWidthHeight: '100', imagePngHandling: 'jpeg', ...values });
        const result = await serverImageProvider.processImage(noisyPng, 'wide.png', true);
        expect(result.format).toEqual({ ext: 'jpg', mime: 'image/jpeg' });
        return result.buffer.byteLength;
    }

    it('clamps an out-of-range quality to the default (75)', async () => {
        // An out-of-range quality must produce byte-identical output to an explicit
        // quality of 75, and differ from a valid in-range quality — proving the clamp
        // actually ran (and the bad value was not passed through).
        const at75 = await shrunkSize({ imageConversionQuality: '75' });
        const valid = await shrunkSize({ imageConversionQuality: '30' });
        const tooLow = await shrunkSize({ imageConversionQuality: '5' });
        const tooHigh = await shrunkSize({ imageConversionQuality: '150' });

        expect(tooLow).toBe(at75);
        expect(tooHigh).toBe(at75);
        expect(valid).not.toBe(at75);
    }, JPEG_QUALITY_TEST_TIMEOUT);

    it('writes a PNG it converts at the conversion quality, not the recompression one', async () => {
        // The two were one setting: automatic shrinking wrote every image it touched, whatever it
        // started as, at imageJpegQuality. They are now the same two qualities the tool has —
        // giving up detail a lossless original genuinely holds is a different bet from squeezing
        // an already-lossy one, and the settings say so.
        const at75 = await shrunkSize({ imageConversionQuality: '75', imageJpegQuality: '75' });

        expect(await shrunkSize({ imageConversionQuality: '75', imageJpegQuality: '30' })).toBe(at75);
        expect(await shrunkSize({ imageConversionQuality: '30', imageJpegQuality: '75' })).not.toBe(at75);
    });

    it('honours each handling on the way in, the same choices the tool offers', async () => {
        // "keep" is the setting the automatic path never had: before this, a PNG arriving here
        // could only ever leave as a JPEG.
        setOptions({ imagePngHandling: 'keep', imageMaxWidthHeight: '2000' });
        expect((await serverImageProvider.processImage(noisyPng, 'wide.png', true)).buffer).toBe(noisyPng);

        setOptions({ imagePngHandling: 'optimize' });
        const optimized = await serverImageProvider.processImage(photoPng, 'photo.png', true);
        expect(optimized.format).toEqual({ ext: 'png', mime: 'image/png' });

        // And resizing can be switched off on its own, leaving the re-encodings to do what they can.
        setOptions({ imageResize: 'false', imagePngHandling: 'jpeg', imageMaxWidthHeight: '100' });
        const unresized = await serverImageProvider.processImage(photoPng, 'photo.png', true);
        expect(unresized.format).toEqual({ ext: 'jpg', mime: 'image/jpeg' });
    });

    it('bakes EXIF orientation into the pixels when shrinking a rotated photo (#4254)', async () => {
        setOptions({ compressImages: 'true', imageMaxWidthHeight: '100' });

        // A 600x400 landscape JPEG tagged "rotate 90 CW" (orientation 6) is how a portrait photo
        // shot on a rotated camera is stored. Shrinking re-encodes to JPEG and drops the EXIF tag,
        // so the rotation must be baked into the pixels — otherwise the saved image is displayed
        // sideways (the original bug). Re-decoding the shrunk output must therefore be portrait.
        const oriented = await makeOrientedJpeg(600, 400, 6);
        const result = await serverImageProvider.processImage(oriented, 'portrait.jpg', true);

        expect(result.format).toEqual({ ext: 'jpg', mime: 'image/jpeg' });
        // Smaller than the original proves the resize/re-encode path actually ran (where the bug lived).
        expect(result.buffer.byteLength).toBeLessThan(oriented.byteLength);

        const decoded = await Jimp.read(Buffer.from(result.buffer));
        expect(decoded.bitmap.height).toBeGreaterThan(decoded.bitmap.width);
    });

    it('leaves a genuinely landscape photo landscape after shrinking (#4254 control)', async () => {
        setOptions({ compressImages: 'true', imageMaxWidthHeight: '100' });

        // Identical pixels with a normal orientation tag (1) must stay landscape — proving the
        // portrait result above comes from honouring EXIF, not an unconditional rotation.
        const landscape = await makeOrientedJpeg(600, 400, 1);
        const result = await serverImageProvider.processImage(landscape, 'landscape.jpg', true);

        const decoded = await Jimp.read(Buffer.from(result.buffer));
        expect(decoded.bitmap.width).toBeGreaterThan(decoded.bitmap.height);
    });
});

describe('serverImageProvider.compressImage', () => {
    /** Every parameter is explicit, so nothing here depends on the stored options. */
    function request(overrides: Partial<ImageCompressionRequest> = {}): ImageCompressionRequest {
        return {
            resize: true, maxWidthHeight: 2000, jpegHandling: "compress", pngHandling: "optimize",
            quality: 75, conversionQuality: 85, ...overrides
        };
    }

    it.each([
        ['an SVG', () => svgBuffer],
        ['a GIF', () => staticGif],
        ['an animated GIF', () => animatedGif],
        ['an unrecognisable buffer', () => garbageBuffer]
    ])('leaves %s alone as an unsupported format', async (_label, getBuffer) => {
        const outcome = await serverImageProvider.compressImage(getBuffer(), request());

        expect(outcome).toEqual({ compressed: false, reason: 'unsupported-format' });
    });

    it('reads an image that is a window onto a larger buffer, not the buffer behind it', async () => {
        // The bytes handed around are Uint8Arrays, which the libraries below want as Buffers. Taking
        // a view rather than a copy is what keeps a run from duplicating every photograph in a tree
        // — but a view carries an offset, and forgetting it would read whatever sits in front of the
        // image. Every other fixture here starts at zero, where that mistake looks like it works.
        const padded = new Uint8Array(64 + noisyPng.byteLength + 64).fill(0xab);
        padded.set(noisyPng, 64);

        const outcome = await serverImageProvider.compressImage(
            padded.subarray(64, 64 + noisyPng.byteLength), request({ maxWidthHeight: 100 }));

        expect(outcome).toMatchObject({ compressed: true });
    });

    it('ignores the compressImages option, which only governs automatic shrinking', async () => {
        setOptions({ compressImages: 'false' });

        const outcome = await serverImageProvider.compressImage(noisyPng, request({ maxWidthHeight: 100 }));

        expect(outcome.compressed).toBe(true);
    });

    describe('what becomes of a PNG, one handling at a time', () => {
        it('leaves it entirely alone on "keep", so only scaling can reach it', async () => {
            const outcome = await serverImageProvider.compressImage(
                noisyPng, request({ pngHandling: 'keep' }));

            expect(outcome).toEqual({ compressed: false, reason: 'no-gain' });
        });

        it('scales it on "keep" but writes it back as the same kind of image', async () => {
            const outcome = await serverImageProvider.compressImage(
                noisyPng, request({ maxWidthHeight: 100, pngHandling: 'keep' }));

            expect(outcome).toMatchObject({ compressed: true, format: { ext: 'png', mime: 'image/png' } });
            if (!outcome.compressed) return;

            const decoded = await Jimp.read(Buffer.from(outcome.buffer));
            expect([decoded.bitmap.width, decoded.bitmap.height]).toEqual([100, 67]);
        });

        it('quantizes it on "optimize", staying a PNG and needing nothing to scale', async () => {
            const outcome = await serverImageProvider.compressImage(
                noisyPng, request({ pngHandling: 'optimize' }));

            expect(outcome).toMatchObject({ compressed: true, format: { ext: 'png', mime: 'image/png' } });
            if (!outcome.compressed) return;
            expect(outcome.buffer.byteLength).toBeLessThan(noisyPng.byteLength);

            // Still 600x400: optimizing reaches an image already inside the bound.
            const decoded = await Jimp.read(Buffer.from(outcome.buffer));
            expect([decoded.bitmap.width, decoded.bitmap.height]).toEqual([600, 400]);
        });

        it('converts it on "jpeg", needing nothing to scale either', async () => {
            const outcome = await serverImageProvider.compressImage(
                photoPng, request({ pngHandling: 'jpeg' }));

            expect(outcome).toMatchObject({ compressed: true, format: { ext: 'jpg', mime: 'image/jpeg' } });
            if (!outcome.compressed) return;

            const decoded = await Jimp.read(Buffer.from(outcome.buffer));
            expect([decoded.bitmap.width, decoded.bitmap.height]).toEqual([600, 400]);
        });

        it('quantizes rather than converting a transparent image, JPEG having no alpha to keep', async () => {
            // The fallback that makes "convert to JPEG" mean "make these as small as you can":
            // answering a transparent image with nothing at all would be the perverse reading.
            const outcome = await serverImageProvider.compressImage(
                transparentPng, request({ pngHandling: 'jpeg' }));

            expect(outcome).toMatchObject({ compressed: true, format: { ext: 'png', mime: 'image/png' } });
            if (!outcome.compressed) return;
            expect(outcome.buffer.byteLength).toBeLessThan(transparentPng.byteLength);

            const decoded = await Jimp.read(Buffer.from(outcome.buffer));
            expect(decoded.bitmap.data.some((byte, i) => i % 4 === 3 && byte !== 255)).toBe(true);
        });

        it('converts one whose alpha channel is merely all-opaque', async () => {
            // Detection reads the decoded pixels, so an alpha channel that happens to be all-255
            // is correctly treated as no transparency at all rather than assumed dangerous.
            const opaqueWithAlpha = new Uint8Array(
                await Jimp.read(Buffer.from(photoPng)).then((image) => image.getBuffer('image/png'))
            );

            const outcome = await serverImageProvider.compressImage(
                opaqueWithAlpha, request({ pngHandling: 'jpeg' }));

            expect(outcome).toMatchObject({ compressed: true, format: { ext: 'jpg', mime: 'image/jpeg' } });
        });

        it('scales first and then quantizes, so both land on the stored image', async () => {
            const outcome = await serverImageProvider.compressImage(
                transparentPng, request({ maxWidthHeight: 100 }));

            expect(outcome).toMatchObject({ compressed: true, format: { ext: 'png', mime: 'image/png' } });
            if (!outcome.compressed) return;

            const decoded = await Jimp.read(Buffer.from(outcome.buffer));
            expect([decoded.bitmap.width, decoded.bitmap.height]).toEqual([100, 67]);
            expect(decoded.bitmap.data.some((byte, i) => i % 4 === 3 && byte !== 255)).toBe(true);
        });

        it('never touches a JPEG, whichever handling is chosen', async () => {
            for (const pngHandling of [ 'keep', 'optimize', 'jpeg' ] as const) {
                const outcome = await serverImageProvider.compressImage(
                    noisyJpeg, request({ jpegHandling: "keep", pngHandling }));

                expect(outcome).toEqual({ compressed: false, reason: 'no-gain' });
            }
        });
    });

    describe('the two qualities', () => {
        it('writes a converted PNG at the conversion quality, not the recompression one', async () => {
            // The point of their being separate: converting a pristine original is a different
            // trade from recompressing something already lossy, so one knob must not move both.
            const converting = { pngHandling: 'jpeg' as const, quality: 20 };
            const coarse = await serverImageProvider.compressImage(
                photoPng, request({ ...converting, conversionQuality: 20 }));
            const fine = await serverImageProvider.compressImage(
                photoPng, request({ ...converting, conversionQuality: 90 }));

            if (!coarse.compressed || !fine.compressed) throw new Error('expected both to compress');
            expect(coarse.buffer.byteLength).toBeLessThan(fine.buffer.byteLength);
        });

        it('writes a recompressed JPEG at the recompression quality, not the conversion one', async () => {
            const recompressing = { conversionQuality: 20 };
            const coarse = await serverImageProvider.compressImage(
                noisyJpeg, request({ ...recompressing, quality: 20 }));
            const fine = await serverImageProvider.compressImage(
                noisyJpeg, request({ ...recompressing, quality: 80 }));

            if (!coarse.compressed || !fine.compressed) throw new Error('expected both to compress');
            expect(coarse.buffer.byteLength).toBeLessThan(fine.buffer.byteLength);
        });

        it('writes a scaled JPEG near-losslessly when its handling is "keep"', async () => {
            // Scaling has to write a JPEG back whatever the settings say, but "keep" is not a place
            // to quietly apply a quality nobody asked for — the slider is hidden under it in the
            // dialog, so it must not be in force either. Moving it changes nothing here.
            const kept = { jpegHandling: 'keep' as const, maxWidthHeight: 300 };
            const atLow = await serverImageProvider.compressImage(noisyJpeg, request({ ...kept, quality: 20 }));
            const atHigh = await serverImageProvider.compressImage(noisyJpeg, request({ ...kept, quality: 80 }));

            if (!atLow.compressed || !atHigh.compressed) throw new Error('expected both to compress');
            expect(atLow.buffer.byteLength).toBe(atHigh.buffer.byteLength);

            // And it comes out above what recompressing at a high quality would have chosen, so
            // "keep" gives up the scaling and nothing else.
            const compressed = await serverImageProvider.compressImage(
                noisyJpeg, request({ jpegHandling: 'compress', maxWidthHeight: 300, quality: 80 }));

            if (!compressed.compressed) throw new Error('expected it to compress');
            expect(atLow.buffer.byteLength).toBeGreaterThan(compressed.buffer.byteLength);
        });

        it('re-encodes a scaled "keep" JPEG at the quality it already had', async () => {
            const outcome = await serverImageProvider.compressImage(
                lowQualityJpeg, request({ jpegHandling: 'keep', maxWidthHeight: 400 }));

            if (!outcome.compressed) throw new Error('expected it to compress');

            // Read back off the result's own quantization table: "keep" means the image comes out
            // encoded as it went in, the scaling being the only thing given up.
            const estimate = estimateJpegQuality(outcome.buffer) ?? 0;
            expect(Math.abs(estimate - 40)).toBeLessThanOrEqual(8);
        });

        it('actually shrinks a modest resize of a cheaply saved JPEG', async () => {
            // The regression this is all for. Re-encoding at a fixed high quality costs more bytes
            // per pixel than a 16% reduction removes, so the result grows, the size guard rejects
            // it, and the resize the user asked for silently does not happen.
            const outcome = await serverImageProvider.compressImage(
                lowQualityJpeg, request({ jpegHandling: 'keep', maxWidthHeight: 550 }));

            expect(outcome.compressed).toBe(true);
            if (!outcome.compressed) return;
            expect(outcome.buffer.byteLength).toBeLessThan(lowQualityJpeg.byteLength);

            const decoded = await Jimp.read(Buffer.from(outcome.buffer));
            expect([ decoded.bitmap.width, decoded.bitmap.height ]).toEqual([ 550, 367 ]);
        });
    });

    it.each([
        [ 'a PNG', () => noisyPng ],
        [ 'a JPEG', () => noisyJpeg ]
    ])('changes nothing about %s when every step is off', async (_label, getBuffer) => {
        const outcome = await serverImageProvider.compressImage(
            getBuffer(),
            request({ resize: false, jpegHandling: "keep", pngHandling: 'keep', maxWidthHeight: 10 })
        );

        expect(outcome).toEqual({ compressed: false, reason: 'no-gain' });
    });

    describe('lossy sources', () => {
        it('recompresses a JPEG at the requested quality without resizing it', async () => {
            const outcome = await serverImageProvider.compressImage(noisyJpeg, request({ quality: 40 }));

            expect(outcome).toMatchObject({ compressed: true, format: { ext: 'jpg', mime: 'image/jpeg' } });
            if (!outcome.compressed) return;
            expect(outcome.buffer.byteLength).toBeLessThan(noisyJpeg.byteLength);
        });

        it('produces a smaller file at a lower quality', async () => {
            const at80 = await serverImageProvider.compressImage(noisyJpeg, request({ quality: 80 }));
            const at20 = await serverImageProvider.compressImage(noisyJpeg, request({ quality: 20 }));

            if (!at80.compressed || !at20.compressed) throw new Error('expected both to compress');
            expect(at20.buffer.byteLength).toBeLessThan(at80.buffer.byteLength);
        });

        it('keeps the original when recompressing would not save anything', async () => {
            const outcome = await serverImageProvider.compressImage(tinyJpeg, request());

            expect(outcome).toEqual({ compressed: false, reason: 'no-gain' });
        });
    });

    describe('resizing', () => {
        it('scales a wide image by its width', async () => {
            const outcome = await serverImageProvider.compressImage(noisyJpeg, request({ maxWidthHeight: 120 }));

            if (!outcome.compressed) throw new Error('expected compression');
            const decoded = await Jimp.read(Buffer.from(outcome.buffer));
            expect([decoded.bitmap.width, decoded.bitmap.height]).toEqual([120, 80]);
        });

        it('scales a tall image by its height', async () => {
            const outcome = await serverImageProvider.compressImage(
                tallPng,
                request({ maxWidthHeight: 120 })
            );

            if (!outcome.compressed) throw new Error('expected compression');
            const decoded = await Jimp.read(Buffer.from(outcome.buffer));
            expect([decoded.bitmap.width, decoded.bitmap.height]).toEqual([40, 120]);
        });

        it('leaves an image already within bounds at its size', async () => {
            const outcome = await serverImageProvider.compressImage(noisyJpeg, request({ maxWidthHeight: 600 }));

            if (!outcome.compressed) throw new Error('expected compression');
            const decoded = await Jimp.read(Buffer.from(outcome.buffer));
            expect([decoded.bitmap.width, decoded.bitmap.height]).toEqual([600, 400]);
        });
    });

    it('propagates a decode failure rather than reporting a bogus result', async () => {
        // corruptPng passes format detection as PNG but Jimp cannot read it. The caller turns this
        // into a logged, per-image "error" skip; swallowing it here would hide the failure instead.
        await expect(serverImageProvider.compressImage(corruptPng, request({ maxWidthHeight: 100 }))).rejects.toThrow();
    });
});

/**
 * Builds a noisy `width`x`height` JPEG (stored at those dimensions) carrying an EXIF Orientation
 * tag. Orientation 6 ("rotate 90 CW") means a 600x400 stored image should be displayed as 400x600
 * portrait; orientation 1 means no rotation. Used to reproduce the rotated-on-import bug (#4254).
 */
async function makeOrientedJpeg(width: number, height: number, orientation: number): Promise<Uint8Array> {
    const image = new Jimp({ width, height, color: 0x3366ccff });
    for (let x = 0; x < width; x++) {
        for (let y = 0; y < height; y++) {
            const r = (x * 31 + y * 17) % 256;
            const g = (x * 13 + y * 7) % 256;
            const b = (x * 5 + y * 23) % 256;
            image.setPixelColor((((r << 24) | (g << 16) | (b << 8) | 0xff) >>> 0), x, y);
        }
    }
    const jpeg = Buffer.from(await image.getBuffer('image/jpeg', { quality: 90 }));
    const tiff = Buffer.from([
        0x4d, 0x4d, 0x00, 0x2a, 0x00, 0x00, 0x00, 0x08, // "MM" (big-endian), magic 42, IFD0 offset 8
        0x00, 0x01,                                     // one directory entry
        0x01, 0x12, 0x00, 0x03, 0x00, 0x00, 0x00, 0x01, // Orientation tag (0x0112), type SHORT, count 1
        0x00, orientation, 0x00, 0x00,                  // value: big-endian SHORT, right-padded
        0x00, 0x00, 0x00, 0x00                          // next-IFD offset (none)
    ]);
    const payload = Buffer.concat([Buffer.from('Exif\0\0', 'latin1'), tiff]);
    const length = payload.length + 2;
    const app1 = Buffer.concat([Buffer.from([0xff, 0xe1, (length >> 8) & 0xff, length & 0xff]), payload]);
    // The APP1/EXIF segment must sit immediately after the SOI marker (0xFFD8).
    return new Uint8Array(Buffer.concat([jpeg.subarray(0, 2), app1, jpeg.subarray(2)]));
}
