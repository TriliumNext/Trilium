/**
 * Server-side image provider implementation.
 *
 * The compression itself lives in {@link image_codec}, which knows nothing about Trilium so that a
 * worker can run it. What is left here is everything that does: the options the automatic shrinking
 * reads, the logger the codec has no way to reach, and the platform interface core calls through.
 */

import { getLog, imageCompressionService, options as optionService } from "@triliumnext/core";
import type { ImageCompressionOutcome, ImageCompressionPlan, ImageCompressionRequest, ImageFormat, ImageProvider, ProcessedImage } from "@triliumnext/core/src/services/image_provider.js";

import { createConcurrencyGate } from "./concurrency_gate.js";
import {
    compressImageBytes,
    DECODE_MEMORY_MB,
    decodeCostOf,
    detectSvg,
    getImageTypeFromBuffer,
    planFromBytes
} from "./image_codec.js";
import { compressInWorker, compressionConcurrency } from "./image_worker_pool.js";

/**
 * Lines the codec produced, written where the rest of the server's logging goes.
 *
 * Per-image detail is dropped unless it was asked for. The backend log is a note the client reads,
 * and re-reads as it grows: a line an image over several hundred images is most of that file, and
 * serving it back is work this process does instead of compressing. Set
 * `TRILIUM_IMAGE_WORKER_DEBUG` to keep them.
 */
const toBackendLog = (message: string, detail?: boolean) => {
    if (!detail || process.env.TRILIUM_IMAGE_WORKER_DEBUG) {
        getLog().info(message);
    }
};

/**
 * How many arriving images are compressed at once.
 *
 * The compression tool decides this for itself: it holds the whole list and schedules it against a
 * memory budget. Images on their way *in* have nobody doing that — an import hands over one per
 * note as it reads them, hundreds of them, each call knowing nothing of the others. Left ungoverned
 * that is hundreds of decodes wanting to run at once, which on an installation with no workers to
 * take them is hundreds of them interleaved on the thread that serves the application, each holding
 * a decoded bitmap.
 *
 * Sized to the same figure the pool uses, so the queue in front of the workers stays short and the
 * fallback path — where there are no workers and the decoding happens here — is bounded by exactly
 * the same number.
 */
const automaticCompression = createConcurrencyGate(compressionConcurrency);


export const serverImageProvider: ImageProvider = {
    getImageType(buffer: Uint8Array): ImageFormat | null {
        // SVG is the only format identifiable without reading a magic number asynchronously; the
        // rest are left to processImage. Guarded like the async path, so a buffer that cannot be a
        // document is answered from its first byte rather than from a string built out of all of it.
        return detectSvg(buffer);
    },

    /**
     * Shrinks an image on its way in, if the settings say so and the image can take it.
     *
     * Two switches have to agree: `compressImages`, which governs every image that arrives, and the
     * caller's own `shrink` — an import the user told not to touch its images passes false, and no
     * setting overrides that.
     *
     * Past them this is {@link compressImage}, the tool's own path, so an uploaded image is put
     * through exactly what the tool would put an existing one through: the same format gates, the
     * same "already re-encoded, leave it" reading, the same worker. What comes back untouched is
     * stored untouched — a skip here is not a failure, it is the answer that this image had nothing
     * to gain, and the original is what should be kept in that case anyway.
     */
    async processImage(buffer: Uint8Array, originalName: string, shrink: boolean): Promise<ProcessedImage> {
        const original = async (): Promise<ProcessedImage> => ({
            buffer,
            format: (await getImageTypeFromBuffer(buffer)) ?? { ext: "dat", mime: "application/octet-stream" }
        });

        if (!shrink || !optionService.getOptionBool("compressImages")) {
            return original();
        }

        try {
            const outcome = await automaticCompression.run(() =>
                this.compressImage(buffer, imageCompressionService.automaticCompressionRequest()));

            return outcome.compressed ? { buffer: outcome.buffer, format: outcome.format } : original();
        } catch (e: unknown) {
            // One image that cannot be compressed is still an image the user asked to store. The
            // failure is worth a line, and then the original goes in exactly as it arrived.
            getLog().error(`Failed to compress image '${originalName}': ${(e as Error)?.stack ?? e}`);

            return original();
        }
    },

    async planCompression(header: Uint8Array, request: ImageCompressionRequest): Promise<ImageCompressionPlan> {
        const plan = planFromBytes(await getImageTypeFromBuffer(header), header, request, toBackendLog);

        return plan.verdict === "skip"
            ? { skip: plan.reason, decodeCost: null }
            : { decodeCost: decodeCostOf(plan.declared) };
    },

    /**
     * Compresses off-thread where there are threads to do it on, and here where there are not.
     *
     * The distinction matters more than it looks. "No workers at all" is a property of the
     * installation — nothing was found to run, or nothing would start — and doing the work here is
     * then the only way to do it, exactly as before there were workers. "A worker failed on this
     * image" is a different thing entirely, and answering it by decoding here is a cure worse than
     * the illness: a decode does not yield, so the thread that serves the application stops serving
     * it for as long as it takes, several times over if several workers are failing. That is the
     * application freezing in order to save one image.
     *
     * So a failed worker fails its image. The run carries on, the image is reported untouched, and
     * running the tool again picks it up — none of which requires the application to stop.
     */
    async compressImage(buffer: Uint8Array, request: ImageCompressionRequest): Promise<ImageCompressionOutcome> {
        const offThread = await compressInWorker(buffer, request, DECODE_MEMORY_MB);

        return offThread ?? compressImageBytes(buffer, request, toBackendLog);
    },

    compressionConcurrency
};
