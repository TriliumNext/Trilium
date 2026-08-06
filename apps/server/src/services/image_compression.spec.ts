import type { ImageCompressionResponse } from "@triliumnext/commons";
import { becca, cls, getSql, options } from "@triliumnext/core";
import { automaticCompressionRequest, cancelImageCompression, collectNoteTargets, HEADER_BYTES, writeImage } from "@triliumnext/core/src/services/image_compression.js";
import { getImageProvider, initImageProvider } from "@triliumnext/core/src/services/image_provider.js";
import { createTextNote } from "@triliumnext/core/src/test/api_fixtures.js";
import { CoreApiTester } from "@triliumnext/core/src/test/api_tester.js";
import { Jimp } from "jimp";
import { afterEach, beforeAll, describe, expect, it } from "vitest";

/**
 * Drives the on-demand image compression endpoints end to end: real notes and attachments in the
 * in-memory database, the real core service, and the real JIMP-backed provider. Nothing is mocked,
 * so what these assert is what a caller actually gets back — and, just as importantly, what is left
 * behind in the database afterwards.
 *
 * This spec lives under `apps/server` rather than in core because compression only exists on this
 * runtime; the standalone (WASM) build has no decoder, and core specs run under both.
 */
let api: CoreApiTester;

/**
 * A large photograph-shaped PNG: smooth, spatially correlated colour over thousands of distinct
 * values, which is what makes every step worth doing to it — PNG stores it poorly, JPEG stores it
 * well, and a palette of 256 is a real reduction. Uncorrelated noise would be the opposite on all
 * three counts and could not show any of them working.
 */
let noisyPng: Uint8Array;
/** An 8x8 solid PNG, which nothing can make smaller. */
let smallPng: Uint8Array;
/** A PNG signature followed by garbage: passes format detection, fails to decode. */
let corruptPng: Uint8Array;
/** The same picture stored lossily, for telling the two re-encoding switches apart. */
let noisyJpeg: Uint8Array;
/** Half-transparent throughout: the image nothing but PNG optimization can reach. */
let transparentPng: Uint8Array;

beforeAll(async () => {
    api = CoreApiTester.build();

    const noisy = new Jimp({ width: 600, height: 400, color: 0x3366ccff });
    paintPhoto(noisy, 0xff);
    noisyPng = new Uint8Array(await noisy.getBuffer("image/png"));
    noisyJpeg = new Uint8Array(await noisy.getBuffer("image/jpeg", { quality: 100 }));

    const translucent = new Jimp({ width: 600, height: 400, color: 0x3366cc80 });
    paintPhoto(translucent, 0x80);
    transparentPng = new Uint8Array(await translucent.getBuffer("image/png"));

    const small = new Jimp({ width: 8, height: 8, color: 0x3366ccff });
    smallPng = new Uint8Array(await small.getBuffer("image/png"));

    corruptPng = new Uint8Array(Buffer.concat([ Buffer.from(smallPng.slice(0, 50)), Buffer.alloc(400, 0xab) ]));
}, 60000);

afterEach(() => {
    setImageOptions({
        imageMaxWidthHeight: "2000",
        imageJpegQuality: "75",
        imageConversionQuality: "75",
        imageResize: "true",
        imageJpegHandling: "compress",
        imagePngHandling: "optimize"
    });
});

/** Writes image options as the strings they are stored as, valid or otherwise. */
function setImageOptions(values: Record<string, string>) {
    cls.init(() => {
        for (const [ name, value ] of Object.entries(values)) {
            options.setOption(name as Parameters<typeof options.setOption>[0], value);
        }
    });
}

describe("compress note images (POST /api/notes/:noteId/compress-images)", () => {
    it("404s for a note that does not exist", async () => {
        const res = await api.post("/api/notes/missingNote123/compress-images");

        expect(res.status).toBe(404);
    });

    it("compresses an image note's own content and writes the new bytes and mime back", async () => {
        const noteId = await createImageNote(noisyPng);

        const res = await api.post<ImageCompressionResponse>(`/api/notes/${noteId}/compress-images`, {
            body: { pngHandling: "jpeg" }
        });

        expect(res.status).toBe(200);
        expect(res.body.compressedCount).toBe(1);
        expect(res.body.skippedCount).toBe(0);
        expect(res.body.savedSize).toBe(res.body.originalSize - res.body.newSize);
        expect(res.body.savedSize).toBeGreaterThan(0);
        expect(res.body.items[0]).toMatchObject({
            entityType: "note",
            entityId: noteId,
            mime: "image/jpeg",
            compressed: true
        });

        const stored = readNote(noteId);
        expect(stored.mime).toBe("image/jpeg");
        expect(stored.size).toBe(res.body.newSize);
        expect(stored.size).toBeLessThan(noisyPng.byteLength);
    });

    it("leaves a PNG within the bound untouched once converting is switched off", async () => {
        const noteId = await createImageNote(noisyPng);

        // Scaling is then the only step that can reach a PNG, and there is nothing oversized to
        // scale. Recompressing lossy images stays on, and has no business with a PNG.
        const res = await api.post<ImageCompressionResponse>(`/api/notes/${noteId}/compress-images`, {
            body: { pngHandling: "keep" }
        });

        expect(res.body.compressedCount).toBe(0);
        expect(res.body.items[0]).toMatchObject({ compressed: false, skipReason: "no-gain", mime: "image/png" });
        // A skipped image weighs the same on both sides, so the run reports no saving at all.
        expect(res.body.originalSize).toBe(noisyPng.byteLength);
        expect(res.body.newSize).toBe(noisyPng.byteLength);
        expect(res.body.savedSize).toBe(0);
        expect(readNote(noteId).size).toBe(noisyPng.byteLength);
    });

    it("visits every image attachment of a text note and reports each one", async () => {
        const { noteId } = await createTextNote(api);
        const big = await addAttachment(noteId, "big.png", noisyPng);
        const small = await addAttachment(noteId, "small.png", smallPng);
        // Not an image: attachments of other roles are not part of the run at all.
        await addAttachment(noteId, "notes.txt", new Uint8Array([ 1, 2, 3 ]), { role: "file", mime: "text/plain" });

        const res = await api.post<ImageCompressionResponse>(`/api/notes/${noteId}/compress-images`, {
            body: { pngHandling: "jpeg" }
        });

        expect(res.body.items.map((item) => item.entityId).sort()).toEqual([ big, small ].sort());
        expect(res.body.compressedCount).toBe(1);
        expect(res.body.skippedCount).toBe(1);

        expect(itemFor(res.body, big)).toMatchObject({ entityType: "attachment", compressed: true, mime: "image/jpeg" });
        expect(itemFor(res.body, small)).toMatchObject({ compressed: false, skipReason: "no-gain", mime: "image/png" });

        expect(readAttachment(big).mime).toBe("image/jpeg");
        // The title is deliberately left alone: elsewhere it is a reference, and download and export
        // filenames already take their extension from the mime.
        expect(readAttachment(big).title).toBe("big.png");
        expect(readAttachment(small).size).toBe(smallPng.byteLength);
    });

    it("keeps each note's images with that note, in the order that note holds them", async () => {
        const { noteId: parentId } = await createTextNote(api);
        const { noteId: firstId } = await createTextNote(api, { parentNoteId: parentId });
        const { noteId: secondId } = await createTextNote(api, { parentNoteId: parentId });

        // Positions deliberately at odds with the order they are created in, so the run has to be
        // following the note's own ordering rather than whatever the database hands back.
        const firstLate = await addAttachment(firstId, "a.png", smallPng, { position: 20 });
        const firstEarly = await addAttachment(firstId, "b.png", smallPng, { position: 10 });
        const second = [
            await addAttachment(secondId, "c.png", smallPng, { position: 10 }),
            await addAttachment(secondId, "d.png", smallPng, { position: 20 })
        ];
        const first = [ firstEarly, firstLate ];

        const res = await api.post<ImageCompressionResponse>(`/api/notes/${parentId}/compress-images`, {
            body: { recursive: true }
        });

        // The subtree's attachments are fetched in one query and grouped back by owner, so this is
        // what says the grouping is right: every image with the note that holds it, notes in the
        // order the subtree gave them, images in the order the note keeps them.
        expect(res.body.items.map((item) => item.entityId)).toEqual([ ...first, ...second ]);
    });

    it("reports an empty run for a note holding no images", async () => {
        const { noteId } = await createTextNote(api);

        const res = await api.post<ImageCompressionResponse>(`/api/notes/${noteId}/compress-images`);

        expect(res.body).toMatchObject({ items: [], compressedCount: 0, skippedCount: 0, savedSize: 0 });
    });

    it("does not follow child notes unless asked to, they may be clones shared elsewhere", async () => {
        const { noteId } = await createTextNote(api);
        const childId = await createImageNote(noisyPng, noteId);

        const res = await api.post<ImageCompressionResponse>(`/api/notes/${noteId}/compress-images`, {
            body: { pngHandling: "jpeg" }
        });

        expect(res.body.items).toHaveLength(0);
        expect(readNote(childId).size).toBe(noisyPng.byteLength);
    });

    it("descends the whole subtree when asked, visiting a clone once however often it is placed", async () => {
        const { noteId } = await createTextNote(api);
        const ownAttachment = await addAttachment(noteId, "own.png", noisyPng);
        const childId = await createImageNote(noisyPng, noteId);
        const grandchildId = await createImageNote(noisyPng, childId);
        // The same note placed a second time inside the subtree: it holds one image, and the run
        // must not compress it twice (nor report it twice).
        await api.put(`/api/notes/${grandchildId}/clone-to-note/${noteId}`);

        const res = await api.post<ImageCompressionResponse>(`/api/notes/${noteId}/compress-images`, {
            body: { pngHandling: "jpeg", recursive: true }
        });

        expect(res.body.items.map((item) => item.entityId).sort())
            .toEqual([ ownAttachment, childId, grandchildId ].sort());
        expect(res.body.compressedCount).toBe(3);
        expect(readNote(childId).mime).toBe("image/jpeg");
        expect(readNote(grandchildId).mime).toBe("image/jpeg");
    });

    it("400s on a non-boolean recursive", async () => {
        const { noteId } = await createTextNote(api);

        const res = await api.post(`/api/notes/${noteId}/compress-images`, { body: { recursive: "deep" } });

        expect(res.status).toBe(400);
    });

    it("skips the generated picture of a spreadsheet note, which is rebuilt on every save", async () => {
        const { noteId } = await createTextNote(api);
        const attachmentId = await addAttachment(noteId, "spreadsheet-export.png", noisyPng);
        setNoteType(noteId, "spreadsheet", "application/json");

        const res = await api.post<ImageCompressionResponse>(`/api/notes/${noteId}/compress-images`, {
            body: { pngHandling: "jpeg" }
        });

        expect(res.body.items[0]).toMatchObject({
            entityId: attachmentId,
            compressed: false,
            skipReason: "generated",
            // Reported at its real weight even though it was never touched.
            originalSize: noisyPng.byteLength
        });
        expect(readAttachment(attachmentId).mime).toBe("image/png");
    });

    it("skips a protected image when no protected session is open", async () => {
        const noteId = await createImageNote(noisyPng);
        cls.init(() => { becca.getNoteOrThrow(noteId).isProtected = true; });

        const res = await api.post<ImageCompressionResponse>(`/api/notes/${noteId}/compress-images`, {
            body: { pngHandling: "jpeg" }
        });

        expect(res.body.items[0]).toMatchObject({ compressed: false, skipReason: "protected", originalSize: 0 });

        cls.init(() => { becca.getNoteOrThrow(noteId).isProtected = false; });
    });

    it("reports an undecodable image as an error and leaves it alone", async () => {
        const noteId = await createImageNote(corruptPng);

        const res = await api.post<ImageCompressionResponse>(`/api/notes/${noteId}/compress-images`, {
            body: { pngHandling: "jpeg", maxWidthHeight: 100 }
        });

        expect(res.status).toBe(200);
        expect(res.body.items[0]).toMatchObject({ compressed: false, skipReason: "error", originalSize: corruptPng.byteLength });
        expect(readNote(noteId).size).toBe(corruptPng.byteLength);
    });

    it("carries on past a failing image to the ones after it", async () => {
        const { noteId } = await createTextNote(api);
        const broken = await addAttachment(noteId, "broken.png", corruptPng);
        const good = await addAttachment(noteId, "good.png", noisyPng);

        const res = await api.post<ImageCompressionResponse>(`/api/notes/${noteId}/compress-images`, {
            body: { pngHandling: "jpeg" }
        });

        expect(itemFor(res.body, broken).skipReason).toBe("error");
        expect(itemFor(res.body, good).compressed).toBe(true);
    });
});

describe("what automatic compression is set to do", () => {
    it("reads the image options as one request, disregarding any value it could not act on", () => {
        setImageOptions({
            imageResize: "false",
            imageMaxWidthHeight: "1280",
            imageJpegHandling: "keep",
            imagePngHandling: "optimize",
            imageJpegQuality: "60",
            imageConversionQuality: "90"
        });

        // Everything the settings page can say, said back — this is what an uploaded image is put
        // through, and the two qualities are separate here as they are everywhere else.
        expect(automaticCompressionRequest()).toEqual({
            resize: false,
            maxWidthHeight: 1280,
            jpegHandling: "keep",
            pngHandling: "optimize",
            quality: 60,
            conversionQuality: 90
        });

        setImageOptions({
            imageMaxWidthHeight: "0",
            imageJpegHandling: "squeeze",
            imagePngHandling: "",
            imageJpegQuality: "500",
            imageConversionQuality: "not a number"
        });

        // None of which throws. A stored setting is not a validated one — it arrives by
        // synchronisation from another instance, or from a database edited by hand — and this is
        // read on the way into an upload, where refusing the settings would mean refusing the
        // image. Each unusable value falls back to what its option ships as.
        expect(automaticCompressionRequest()).toMatchObject({
            maxWidthHeight: 2000,
            jpegHandling: "compress",
            pngHandling: "optimize",
            quality: 75,
            conversionQuality: 75
        });
    });
});

describe("compression parameters", () => {
    it("resizes to the requested bound rather than the option's", async () => {
        const noteId = await createImageNote(noisyPng);

        await api.post(`/api/notes/${noteId}/compress-images`, { body: { maxWidthHeight: 100 } });

        expect(await decodedSize(noteId)).toEqual([ 100, 67 ]);
    });

    it("falls back to the imageMaxWidthHeight option when no bound is given", async () => {
        cls.init(() => options.setOption("imageMaxWidthHeight", "150"));
        const noteId = await createImageNote(noisyPng);

        await api.post(`/api/notes/${noteId}/compress-images`, { body: { pngHandling: "jpeg" } });

        expect(await decodedSize(noteId)).toEqual([ 150, 100 ]);
    });

    it("honours the recompression quality, falling back to the imageJpegQuality option", async () => {
        const explicitLow = await compressedSize({ quality: 20 }, noisyJpeg);
        const explicitHigh = await compressedSize({ quality: 70 }, noisyJpeg);
        expect(explicitLow).toBeLessThan(explicitHigh);

        cls.init(() => options.setOption("imageJpegQuality", "20"));
        expect(await compressedSize({}, noisyJpeg)).toBe(explicitLow);
    });

    it("leaves the cached format alone when the image behind it could not be written", () => {
        // The write is wrapped in a transaction, so a failure takes the database back — but the
        // entity is a cached object no rollback touches. Left changed, it would advertise a format
        // whose bytes were never written, and hand that mime to whatever saved the note next.
        const entity = {
            mime: "image/png",
            setContent() {
                throw new Error("content is too large to store");
            }
        };

        expect(() => writeImage(entity, smallPng, "image/jpeg")).toThrow(/too large/);
        expect(entity.mime).toBe("image/png");
    });

    it("falls back to a usable bound when the stored one could not be resized to", async () => {
        const noteId = await createImageNote(noisyPng);

        // A stored option is not a validated one — it arrives by synchronisation from another
        // instance, or from a database edited by hand. Zero would reach the encoder as "scale every
        // image to nothing", and a value that is not a number would abort the request where it was
        // read, so neither is allowed to stand in for a bound the request did not name.
        for (const stored of [ "0", "-100", "not a number" ]) {
            cls.init(() => options.setOption("imageMaxWidthHeight", stored));

            const res = await api.post<ImageCompressionResponse>(`/api/notes/${noteId}/compress-images`, {
                body: { resize: true, pngHandling: "keep", jpegHandling: "keep" }
            });

            // 600x400 sits inside the 2000 fallback, so nothing is resized and the image is left be
            // — where a bound of zero would have made every image oversized.
            expect(res.status, stored).toBe(200);
            expect(res.body.items[0], stored).toMatchObject({ compressed: false, skipReason: "no-gain" });
        }

        expect(readNote(noteId).size).toBe(noisyPng.byteLength);
    });

    it("falls back to the default recompression quality when the stored option is out of range", async () => {
        cls.init(() => options.setOption("imageJpegQuality", "75"));
        const at75 = await compressedSize({}, noisyJpeg);

        // An option the caller did not choose and cannot fix from here must not fail the request.
        cls.init(() => options.setOption("imageJpegQuality", "500"));
        expect(await compressedSize({}, noisyJpeg)).toBe(at75);
    });

    it("honours the conversion quality, which follows no option and no other quality", async () => {
        const converting = { pngHandling: "jpeg" };
        const low = await compressedSize({ ...converting, conversionQuality: 20 });
        const high = await compressedSize({ ...converting, conversionQuality: 70 });
        expect(low).toBeLessThan(high);

        // The image option governs recompressing, not converting: a lossless original is a
        // different trade, so its quality keeps a default of its own and is unmoved by either.
        cls.init(() => options.setOption("imageJpegQuality", "20"));
        const atDefault = await compressedSize(converting);
        expect(await compressedSize({ ...converting, quality: 20 })).toBe(atDefault);
        expect(atDefault).toBeGreaterThan(high);
    });

    it.each([
        [ "a fractional maxWidthHeight", { maxWidthHeight: 10.5 } ],
        [ "a zero maxWidthHeight", { maxWidthHeight: 0 } ],
        [ "a quality below the minimum", { quality: 5 } ],
        [ "a quality above the maximum", { quality: 101 } ],
        [ "a non-integer quality", { quality: 75.5 } ],
        [ "a non-boolean resize", { resize: "yes" } ],
        [ "an unknown jpegHandling", { jpegHandling: "loads" } ],
        [ "an unknown pngHandling", { pngHandling: "shrink" } ],
        [ "a conversion quality out of range", { conversionQuality: 5 } ]
    ])("400s on %s", async (_label, body) => {
        const noteId = await createImageNote(smallPng);

        const res = await api.post(`/api/notes/${noteId}/compress-images`, { body });

        expect(res.status).toBe(400);
    });

    it("400s on a body that is not an object of options", async () => {
        const noteId = await createImageNote(smallPng);

        expect((await api.post(`/api/notes/${noteId}/compress-images`, { body: [ 1, 2 ] })).status).toBe(400);
        expect((await api.post(`/api/notes/${noteId}/compress-images`, { body: "jpegHandling" })).status).toBe(400);
    });

    it("treats a missing body as a request to compress without changing formats", async () => {
        const noteId = await createImageNote(noisyPng);

        const res = await api.post<ImageCompressionResponse>(`/api/notes/${noteId}/compress-images`);

        expect(res.status).toBe(200);
        // A request that named nothing asked for the images to be compressed, so answering with a
        // no-op would be the surprising reading — but it did not ask for the format to change.
        expect(res.body.items[0]).toMatchObject({ compressed: true, mime: "image/png" });
    });

    it("changes nothing at all when every step is switched off", async () => {
        const noteId = await createImageNote(noisyPng);

        const res = await api.post<ImageCompressionResponse>(`/api/notes/${noteId}/compress-images`, {
            body: {
                resize: false, jpegHandling: "keep", pngHandling: "keep", maxWidthHeight: 10
            }
        });

        // Oversized by a long way, and still untouched: with nothing switched on, the bound is
        // never measured against.
        expect(res.body.items[0]).toMatchObject({ compressed: false, skipReason: "no-gain" });
        expect(readNote(noteId).size).toBe(noisyPng.byteLength);
    });

    it.each([
        [ "the lossy one", { jpegHandling: "compress", pngHandling: "keep" }, "jpeg.jpg" ],
        [ "the lossless one", { jpegHandling: "keep", pngHandling: "jpeg" }, "png.png" ]
    ])("reaches only its own kind of image with %s switched on", async (_label, body, expected) => {
        const { noteId } = await createTextNote(api);
        await addAttachment(noteId, "png.png", noisyPng);
        await addAttachment(noteId, "jpeg.jpg", noisyJpeg, { mime: "image/jpeg" });

        const res = await api.post<ImageCompressionResponse>(`/api/notes/${noteId}/compress-images`, { body });

        // Squeezing the JPEGs harder is no reason to stop a PNG being a PNG, and vice versa: each
        // switch answers for its own kind and leaves the other exactly as it was.
        expect(res.body.items.filter((item) => item.compressed).map((item) => item.title)).toEqual([ expected ]);
    });

    it("settles an image it has nothing to do to without ever decoding it", async () => {
        const { noteId } = await createTextNote(api);
        // Undecodable on purpose: reaching the decoder at all would report this as an error, so
        // "no-gain" is proof that the run answered from the header alone. That matters for what a
        // decode costs — a large photograph wants most of a gigabyte to say it needed nothing.
        const attachmentId = await addAttachment(noteId, "corrupt.png", corruptPng);

        const res = await api.post<ImageCompressionResponse>(`/api/notes/${noteId}/compress-images`, {
            body: { resize: true, maxWidthHeight: 1920, jpegHandling: "keep", pngHandling: "keep" }
        });

        expect(res.body.items[0]).toMatchObject({ compressed: false, skipReason: "no-gain" });
        expect(readAttachment(attachmentId).size).toBe(corruptPng.byteLength);
    });

    it("reads the front of an image and its weight, leaving the body of it in the database", async () => {
        const { noteId } = await createTextNote(api);
        const attachmentId = await addAttachment(noteId, "big.png", noisyPng);

        const peeked = cls.init(() => {
            const target = collectNoteTargets(becca.getNoteOrThrow(noteId), false)
                .find((candidate) => candidate.entityId === attachmentId);

            return target?.peek();
        });

        // The weight is the whole image's, counted by the database; the bytes are only its front.
        expect(peeked?.size).toBe(noisyPng.byteLength);
        expect(noisyPng.byteLength).toBeGreaterThan(HEADER_BYTES);
        expect(peeked?.header.byteLength).toBe(HEADER_BYTES);
        expect(Array.from(peeked?.header.slice(0, 8) ?? [])).toEqual(Array.from(noisyPng.slice(0, 8)));
    });

    it("still compresses a JPEG whose dimensions sit past the front of the file", async () => {
        const { noteId } = await createTextNote(api);
        // Metadata ahead of the frame header, as a camera's thumbnail or a colour profile leaves it:
        // nothing in the peeked bytes says how large the image is, so the run has to read it in full
        // rather than assume. Getting that wrong would silently stop resizing such photographs.
        const padded = withLeadingMetadata(noisyJpeg);
        const attachmentId = await addAttachment(noteId, "padded.jpg", padded, { mime: "image/jpeg" });

        const res = await api.post<ImageCompressionResponse>(`/api/notes/${noteId}/compress-images`, {
            body: { resize: true, maxWidthHeight: 200, jpegHandling: "keep", pngHandling: "keep" }
        });

        expect(res.body.items[0]).toMatchObject({ entityId: attachmentId, compressed: true });
        expect(readAttachment(attachmentId).size).toBeLessThan(padded.byteLength);
    });

    it("falls back to reading an image in full when it cannot be judged from its header", async () => {
        const { noteId } = await createTextNote(api);
        const attachmentId = await addAttachment(noteId, "photo.png", noisyPng);
        const real = getImageProvider();

        // The header pass is an optimization of the read, never a precondition for it — so when it
        // cannot answer, the run must go the long way round rather than report a failure.
        initImageProvider({
            getImageType: (buffer) => real.getImageType(buffer),
            processImage: (buffer, name, shrink) => real.processImage(buffer, name, shrink),
            compressImage: (buffer, compressionRequest) => real.compressImage(buffer, compressionRequest),
            compressionConcurrency: () => real.compressionConcurrency(),
            planCompression: () => Promise.reject(new Error("planner unavailable"))
        });

        try {
            const res = await api.post<ImageCompressionResponse>(`/api/notes/${noteId}/compress-images`, {
                body: { pngHandling: "jpeg" }
            });

            expect(res.body.items[0]).toMatchObject({ entityId: attachmentId, compressed: true });
            expect(readAttachment(attachmentId).mime).toBe("image/jpeg");
        } finally {
            initImageProvider(real);
        }
    });

    it("stops when called off, keeping what it had already compressed", async () => {
        const { noteId } = await createTextNote(api);
        const taskId = "cancelMe123";
        const images = [
            await addAttachment(noteId, "a.png", noisyPng, { position: 10 }),
            await addAttachment(noteId, "b.png", noisyPng, { position: 20 }),
            await addAttachment(noteId, "c.png", noisyPng, { position: 30 })
        ];

        // Called off while the first image is in the encoder, so the run has started but has not
        // reached the rest: what it manages is real, and what it never got to says so.
        const real = getImageProvider();
        let compressedSoFar = 0;

        initImageProvider({
            getImageType: (buffer) => real.getImageType(buffer),
            processImage: (buffer, name, shrink) => real.processImage(buffer, name, shrink),
            planCompression: (header, req) => real.planCompression(header, req),
            compressionConcurrency: () => 1,
            compressImage: async (buffer, req) => {
                const outcome = await real.compressImage(buffer, req);

                if (++compressedSoFar === 1) {
                    cancelImageCompression(taskId);
                }

                return outcome;
            }
        });

        try {
            const res = await api.post<ImageCompressionResponse>(`/api/notes/${noteId}/compress-images`, {
                body: { taskId, pngHandling: "jpeg" }
            });

            expect(res.body.compressedCount).toBe(1);
            expect(res.body.items.map((item) => item.skipReason))
                .toEqual([ undefined, "cancelled", "cancelled" ]);

            // The one it finished is written; the two it never reached are untouched, not half-done.
            expect(readAttachment(images[0]).mime).toBe("image/jpeg");
            expect(readAttachment(images[1]).size).toBe(noisyPng.byteLength);
            expect(readAttachment(images[2]).size).toBe(noisyPng.byteLength);
        } finally {
            initImageProvider(real);
        }
    });

    it("forgets a cancellation once the run it stopped is over", async () => {
        const { noteId } = await createTextNote(api);
        const attachmentId = await addAttachment(noteId, "later.png", noisyPng);
        const taskId = "reusedName99";

        cancelImageCompression(taskId);

        const stopped = await api.post<ImageCompressionResponse>(`/api/notes/${noteId}/compress-images`, {
            body: { taskId, pngHandling: "jpeg" }
        });
        expect(stopped.body.items[0]).toMatchObject({ skipReason: "cancelled" });

        // The same name again: a run must not inherit the last one's cancellation, or a caller
        // reusing an id would find every later run refusing to start.
        const second = await api.post<ImageCompressionResponse>(`/api/notes/${noteId}/compress-images`, {
            body: { taskId, pngHandling: "jpeg" }
        });
        expect(second.body.items[0]).toMatchObject({ compressed: true });
        expect(readAttachment(attachmentId).mime).toBe("image/jpeg");
    });

    it("refuses an image too large to decode rather than failing part-way through one", async () => {
        const { noteId } = await createTextNote(api);
        // 400 megapixels by its own header — well past what one decode is allowed. The bytes behind
        // it are an 8x8 image, so anything that did attempt the decode would answer "error".
        const attachmentId = await addAttachment(noteId, "huge.png", withDeclaredSize(smallPng, 20000, 20000));

        const res = await api.post<ImageCompressionResponse>(`/api/notes/${noteId}/compress-images`, {
            body: { resize: true, maxWidthHeight: 1920, pngHandling: "jpeg" }
        });

        expect(res.body.items[0]).toMatchObject({ compressed: false, skipReason: "too-large" });
        expect(readAttachment(attachmentId).mime).toBe("image/png");
    });

    it("shrinks a transparent image, which nothing else in the run can reach", async () => {
        const noteId = await createImageNote(transparentPng);

        const res = await api.post<ImageCompressionResponse>(`/api/notes/${noteId}/compress-images`);

        // Converting refuses it and there is nothing oversized to scale, so before PNG
        // optimization existed this note could not be made smaller at all.
        expect(res.body.items[0]).toMatchObject({ compressed: true, mime: "image/png" });
        expect(res.body.savedSize).toBeGreaterThan(0);

        const stored = readNote(noteId);
        expect(stored.mime).toBe("image/png");
        expect(stored.size).toBeLessThan(transparentPng.byteLength);
    });

    it("re-encodes without scaling when only scaling is switched off", async () => {
        const noteId = await createImageNote(noisyPng);

        const res = await api.post<ImageCompressionResponse>(`/api/notes/${noteId}/compress-images`, {
            body: { resize: false, maxWidthHeight: 100, pngHandling: "jpeg" }
        });

        expect(res.body.items[0]).toMatchObject({ compressed: true, mime: "image/jpeg" });
        // The bound is quoted and ignored: nothing was asked to be measured against it.
        expect(await decodedSize(noteId)).toEqual([ 600, 400 ]);
    });

    it("settles a second run from headers alone, leaving what the first run wrote untouched", async () => {
        const jpegNoteId = await createImageNote(noisyJpeg, "root", "image/jpeg");
        const pngNoteId = await createImageNote(noisyPng);
        const body = { resize: true, maxWidthHeight: 300, jpegHandling: "compress", pngHandling: "optimize", quality: 75 };

        for (const noteId of [ jpegNoteId, pngNoteId ]) {
            const first = await api.post<ImageCompressionResponse>(`/api/notes/${noteId}/compress-images`, { body });

            expect(first.body.items[0].compressed).toBe(true);

            const written = readNote(noteId).size;
            // The second run finds a JPEG already at the target quality and a PNG already storing
            // a palette, and reports both as no-gain without decoding — or rewriting — either.
            // Without that reading, each run re-encoded the last run's output a few bytes smaller,
            // eroding quality and churning the database every time.
            const second = await api.post<ImageCompressionResponse>(`/api/notes/${noteId}/compress-images`, { body });

            expect(second.body.items[0]).toMatchObject({ compressed: false, skipReason: "no-gain" });
            expect(readNote(noteId).size).toBe(written);
        }
    });
});

describe("compress one attachment (POST /api/attachments/:attachmentId/compress-image)", () => {
    it("404s for an attachment that does not exist", async () => {
        const res = await api.post("/api/attachments/missingAtt123/compress-image");

        expect(res.status).toBe(404);
    });

    it("400s for an attachment that is not an image", async () => {
        const { noteId } = await createTextNote(api);
        const attachmentId = await addAttachment(noteId, "notes.txt", new Uint8Array([ 1, 2 ]), { role: "file", mime: "text/plain" });

        const res = await api.post(`/api/attachments/${attachmentId}/compress-image`);

        expect(res.status).toBe(400);
    });

    it("compresses just that attachment, leaving its siblings alone", async () => {
        const { noteId } = await createTextNote(api);
        const target = await addAttachment(noteId, "target.png", noisyPng);
        const sibling = await addAttachment(noteId, "sibling.png", noisyPng);

        const res = await api.post<ImageCompressionResponse>(`/api/attachments/${target}/compress-image`, {
            body: { pngHandling: "jpeg" }
        });

        expect(res.body.items).toHaveLength(1);
        expect(res.body.items[0]).toMatchObject({ entityType: "attachment", entityId: target, compressed: true });
        expect(readAttachment(target).mime).toBe("image/jpeg");
        expect(readAttachment(sibling).size).toBe(noisyPng.byteLength);
    });

    it("still refuses a generated picture when it is targeted directly", async () => {
        const { noteId } = await createTextNote(api);
        const attachmentId = await addAttachment(noteId, "spreadsheet-export.png", noisyPng);
        setNoteType(noteId, "spreadsheet", "application/json");

        const res = await api.post<ImageCompressionResponse>(`/api/attachments/${attachmentId}/compress-image`, {
            body: { pngHandling: "jpeg" }
        });

        expect(res.body.items[0]).toMatchObject({ compressed: false, skipReason: "generated" });
    });
});

/**
 * Re-encoding an image takes long enough — seconds, for a large one — that the image can be
 * replaced while it is happening, by another request or by an incoming synchronisation update. What
 * comes out of the encoder is then a smaller copy of a picture that no longer exists, and writing
 * it would silently put the replaced image back with no revision to recover the newer one from.
 */
describe("an image changed mid-run", () => {
    it("keeps a replaced attachment instead of overwriting it with the older picture", async () => {
        const { noteId } = await createTextNote(api);
        const attachmentId = await addAttachment(noteId, "target.png", noisyPng);

        const res = await whileCompressing(
            () => replaceAttachmentContent(attachmentId, smallPng),
            () => api.post<ImageCompressionResponse>(`/api/attachments/${attachmentId}/compress-image`, {
                body: { pngHandling: "jpeg" }
            })
        );

        expect(res.body.items[0]).toMatchObject({ compressed: false, skipReason: "changed" });
        // Still the replacement, and still a PNG: a write would have made it the JPEG it converts to.
        expect(readAttachment(attachmentId)).toMatchObject({ size: smallPng.byteLength, mime: "image/png" });
    });

    it("keeps a replaced image note instead of overwriting it with the older picture", async () => {
        const noteId = await createImageNote(noisyPng);

        const res = await whileCompressing(
            () => replaceNoteContent(noteId, smallPng),
            () => api.post<ImageCompressionResponse>(`/api/notes/${noteId}/compress-images`, {
                body: { pngHandling: "jpeg" }
            })
        );

        expect(res.body.items[0]).toMatchObject({ compressed: false, skipReason: "changed" });
        expect(readNote(noteId)).toMatchObject({ size: smallPng.byteLength, mime: "image/png" });
    });

    it("compresses over a change that left the image alone, without reverting it", async () => {
        const { noteId } = await createTextNote(api);
        const attachmentId = await addAttachment(noteId, "before.png", noisyPng);

        const res = await whileCompressing(
            () => renameAttachment(attachmentId, "after.png"),
            () => api.post<ImageCompressionResponse>(`/api/attachments/${attachmentId}/compress-image`, {
                body: { pngHandling: "jpeg" }
            })
        );

        // The picture itself never moved, so there is nothing to refuse — but the run must write
        // through the attachment as it is now, not the copy of the row it started from.
        expect(res.body.items[0]).toMatchObject({ compressed: true });
        expect(readAttachment(attachmentId).title).toBe("after.png");
    });
});

/**
 * Paints the fixture: smooth sine gradients across all three channels, giving a picture with the
 * statistics of a photograph — many distinct colours, strongly correlated between neighbours.
 */
function paintPhoto(image: InstanceType<typeof Jimp>, alpha: number) {
    for (let x = 0; x < 600; x++) {
        for (let y = 0; y < 400; y++) {
            const r = Math.round(128 + 127 * Math.sin(x / 40));
            const g = Math.round(128 + 127 * Math.sin(y / 30));
            const b = Math.round(128 + 127 * Math.sin((x + y) / 50));
            image.setPixelColor((((r << 24) | (g << 16) | (b << 8) | alpha) >>> 0), x, y);
        }
    }
}

/**
 * The same JPEG behind two segments of filler metadata, as a camera's thumbnail or an embedded
 * colour profile sits ahead of the frame header — enough of it that nothing in the bytes a run
 * peeks at says how large the picture is.
 */
function withLeadingMetadata(jpeg: Uint8Array): Uint8Array {
    // A JPEG segment's length field counts itself, and is two bytes, so this is the largest one.
    const payloadBytes = 65533;
    const segment = new Uint8Array(4 + payloadBytes);
    segment[0] = 0xff;
    segment[1] = 0xe1;
    new DataView(segment.buffer).setUint16(2, payloadBytes + 2);

    const padded = new Uint8Array(2 + segment.byteLength * 2 + jpeg.byteLength - 2);
    padded.set([ 0xff, 0xd8 ]);
    padded.set(segment, 2);
    padded.set(segment, 2 + segment.byteLength);
    // Everything after the original's own start-of-image marker, which is now carried above.
    padded.set(jpeg.subarray(2), 2 + segment.byteLength * 2);

    return padded;
}

/**
 * The same PNG, its IHDR rewritten to claim the given dimensions — width and height sit at fixed
 * offsets, and nothing on this path verifies the chunk's checksum. A header that lies about how
 * large the image is, which is exactly what the ceiling has to answer for.
 */
function withDeclaredSize(png: Uint8Array, width: number, height: number): Uint8Array {
    const patched = new Uint8Array(png);
    const header = new DataView(patched.buffer);
    header.setUint32(16, width);
    header.setUint32(20, height);

    return patched;
}

/** Creates a real image note holding the given bytes and returns its noteId. */
async function createImageNote(content: Uint8Array, parentNoteId = "root", mime = "image/png"): Promise<string> {
    const { noteId } = await createTextNote(api, { parentNoteId });

    cls.init(() => getSql().transactional(() => {
        const note = becca.getNoteOrThrow(noteId);
        note.type = "image";
        note.mime = mime;
        note.save();
        note.setContent(content, { forceSave: true });
    }));

    return noteId;
}

async function addAttachment(
    noteId: string,
    title: string,
    content: Uint8Array,
    { role = "image", mime = "image/png", position }: { role?: string, mime?: string, position?: number } = {}
): Promise<string> {
    return cls.init(() => getSql().transactional(() => {
        const attachment = becca.getNoteOrThrow(noteId)
            .saveAttachment({ role, mime, title, content, position }, "title");
        return attachment.attachmentId ?? "";
    }));
}

function setNoteType(noteId: string, type: string, mime: string) {
    cls.init(() => getSql().transactional(() => {
        const note = becca.getNoteOrThrow(noteId);
        note.type = type as never;
        note.mime = mime;
        note.save();
    }));
}

function readNote(noteId: string): { mime: string; size: number } {
    return cls.init(() => {
        const note = becca.getNoteOrThrow(noteId);
        return { mime: note.mime, size: note.getContent().length };
    });
}

function readAttachment(attachmentId: string): { mime: string; title: string; size: number } {
    return cls.init(() => {
        const attachment = becca.getAttachmentOrThrow(attachmentId);
        return { mime: attachment.mime, title: attachment.title, size: attachment.getContent().length };
    });
}

/**
 * Runs `interfere` at the one moment that matters — after the run has read an image, before it
 * writes the result back — and runs `request` inside that arrangement.
 *
 * Standing in for the real provider is what makes the moment reachable at all: the window is real,
 * but it is only as wide as an encoder is slow, and a test that raced it would pass by luck.
 */
async function whileCompressing<T>(interfere: () => void, request: () => Promise<T>): Promise<T> {
    const real = getImageProvider();

    initImageProvider({
        getImageType: (buffer) => real.getImageType(buffer),
        processImage: (buffer, originalName, shrink) => real.processImage(buffer, originalName, shrink),
        planCompression: (header, compressionRequest) => real.planCompression(header, compressionRequest),
        compressionConcurrency: () => real.compressionConcurrency(),
        compressImage: (buffer, compressionRequest) => {
            interfere();
            return real.compressImage(buffer, compressionRequest);
        }
    });

    try {
        return await request();
    } finally {
        initImageProvider(real);
    }
}

/** Someone else replacing the picture — a re-upload, or a synchronisation update landing. */
function replaceAttachmentContent(attachmentId: string, content: Uint8Array) {
    cls.init(() => getSql().transactional(() => {
        becca.getAttachmentOrThrow(attachmentId).setContent(content, { forceSave: true });
    }));
}

function replaceNoteContent(noteId: string, content: Uint8Array) {
    cls.init(() => getSql().transactional(() => {
        becca.getNoteOrThrow(noteId).setContent(content, { forceSave: true });
    }));
}

/** A change to the attachment that leaves its content alone, which compression must not undo. */
function renameAttachment(attachmentId: string, title: string) {
    cls.init(() => getSql().transactional(() => {
        const attachment = becca.getAttachmentOrThrow(attachmentId);
        attachment.title = title;
        attachment.save();
    }));
}

function itemFor(response: ImageCompressionResponse, entityId: string) {
    const item = response.items.find((candidate) => candidate.entityId === entityId);

    if (!item) {
        throw new Error(`No item reported for '${entityId}'.`);
    }

    return item;
}

/** Compresses a fresh copy of the noisy PNG and returns how many bytes it ended up at. */
async function compressedSize(body: Record<string, unknown>, source = noisyPng): Promise<number> {
    const noteId = await createImageNote(source, "root", source === noisyJpeg ? "image/jpeg" : "image/png");
    const res = await api.post<ImageCompressionResponse>(`/api/notes/${noteId}/compress-images`, { body });

    if (res.body.compressedCount !== 1) {
        throw new Error(`Expected ${JSON.stringify(body)} to compress; got ${JSON.stringify(res.body.items)}`);
    }

    return res.body.newSize;
}

async function decodedSize(noteId: string): Promise<[number, number]> {
    const content = cls.init(() => becca.getNoteOrThrow(noteId).getContent());
    const decoded = await Jimp.read(Buffer.from(content as Uint8Array));

    return [ decoded.bitmap.width, decoded.bitmap.height ];
}
