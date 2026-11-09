import { initLog } from "@triliumnext/core/src/services/log.js";
import { Jimp } from "jimp";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { resizePreviewImage } from "./image_codec.js";
import { compressInWorker, resizePreviewInWorker, shutdownImageWorkers } from "./image_worker_pool.js";

/**
 * One image through a real forked worker — no mocks, the actual child process, channel and codec.
 *
 * This is the only automated coverage the transport has: the spec beside this one pins the pool's
 * semantics through a fake spawner, so a renamed message field, a broken ready gate or a
 * serialization change would pass there.
 */
let jpeg: Uint8Array;
let previousNodeOptions: string | undefined;

beforeAll(async () => {
    initLog();

    // The child is plain Node and the worker entry here is TypeScript, so the loader has to reach
    // it through the environment — exactly the road the desktop's dev launcher takes.
    previousNodeOptions = process.env.NODE_OPTIONS;
    process.env.NODE_OPTIONS = [ previousNodeOptions, "--import tsx" ].filter(Boolean).join(" ");

    const photo = new Jimp({ width: 200, height: 150 });
    const { data, width } = photo.bitmap;

    for (let index = 0; index < data.length; index += 4) {
        data[index] = (index / 4) % width;
        data[index + 1] = 128;
        data[index + 2] = 255 - ((index / 4) % width);
        data[index + 3] = 255;
    }

    jpeg = new Uint8Array(await photo.getBuffer("image/jpeg", { quality: 95 }));
});

afterAll(() => {
    shutdownImageWorkers();

    if (previousNodeOptions === undefined) {
        delete process.env.NODE_OPTIONS;
    } else {
        process.env.NODE_OPTIONS = previousNodeOptions;
    }
});

describe("image worker fork round-trip", () => {
    it("compresses an image in a real child process and hands the bytes back", { timeout: 30000 }, async () => {
        const outcome = await compressInWorker(jpeg, {
            resize: true,
            maxWidthHeight: 100,
            jpegHandling: "compress",
            pngHandling: "optimize",
            quality: 75,
            conversionQuality: 85
        }, 1024);

        // Null would mean the pool disabled itself: the child never came up at all.
        expect(outcome).not.toBeNull();

        if (!outcome || !outcome.compressed) {
            throw new Error(`expected the worker to compress the image, got ${JSON.stringify(outcome)}`);
        }

        expect(outcome.format.mime).toBe("image/jpeg");
        expect(outcome.buffer.byteLength).toBeGreaterThan(0);
        expect(outcome.buffer.byteLength).toBeLessThan(jpeg.byteLength);
    });

    it("resizes a preview in a real child process to the same bytes as in-process", { timeout: 30000 }, async () => {
        const request = { maxEdge: 64, jpegQuality: 80 };
        const offThread = await resizePreviewInWorker(jpeg, request);
        const inProcess = await resizePreviewImage(jpeg, request);

        expect(offThread).not.toBeNull();

        if (!offThread?.resized || !inProcess.resized) {
            throw new Error(`expected both to resize, got ${JSON.stringify({ offThread, inProcess })}`);
        }

        expect(offThread.bytes).toBeInstanceOf(Uint8Array);
        expect(Buffer.from(offThread.bytes).equals(Buffer.from(inProcess.bytes))).toBe(true);
    });
});
