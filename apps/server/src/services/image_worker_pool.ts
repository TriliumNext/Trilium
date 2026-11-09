/**
 * The worker processes that compress images and resize link-preview pictures: one pool for each,
 * so a preview never waits behind a compression that can take minutes.
 *
 * Decoding is synchronous from start to finish (jpeg-js, pngjs and UPNG never yield), so an image
 * decoded on the main thread stops the app answering until it is done. {@link createProcessPool}
 * holds the failure semantics: `null` from a function here means there are no workers and the
 * caller does the work itself.
 *
 * Only the server's own image provider reaches this, on the server and the desktop app. The
 * standalone build has its own provider and never loads it.
 */

import type {
    ImageCompressionOutcome,
    ImageCompressionRequest,
    PreviewResizeOutcome,
    PreviewResizeRequest
} from "@triliumnext/core/src/services/image_provider.js";

import type { ImageWorkerRequest, ImageWorkerResult } from "./image_worker.js";
import { createProcessPool, defaultWorkerCount } from "./workers/process_pool.js";

/**
 * How many images may be compressed at once, or 1 where there are no workers, which is what the
 * caller schedules against either way.
 */
export function compressionConcurrency(): number {
    return pool.concurrency();
}

/**
 * Compresses one image in a worker, or answers `null` when there is no worker to do it in.
 *
 * @param budgetMb the most this decode may allocate, which the caller has already set aside for it.
 */
export async function compressInWorker(
    buffer: Uint8Array,
    request: ImageCompressionRequest,
    budgetMb: number
): Promise<ImageCompressionOutcome | null> {
    const outcome = await pool.run({ kind: "compress", buffer, request, budgetMb });

    return outcome as ImageCompressionOutcome | null;
}

/** Resizes a link-preview picture in a worker, or answers `null` when there is no worker. */
export async function resizePreviewInWorker(
    bytes: Uint8Array,
    request: PreviewResizeRequest
): Promise<PreviewResizeOutcome | null> {
    const outcome = await previewPool.run({
        kind: "preview",
        bytes,
        request,
        budgetMb: PREVIEW_DECODE_BUDGET_MB
    });

    return outcome as PreviewResizeOutcome | null;
}

/** Stops the idle workers, so a Trilium that has finished compressing gives their memory back. */
export function shutdownImageWorkers() {
    pool.shutdown();
    previewPool.shutdown();
}

/**
 * The heap each worker gets: room for the largest decode budget plus working space. Too small and
 * a decode collects over and over; too large and V8 collects lazily enough to push the machine
 * into paging.
 */
const WORKER_HEAP_MB = 2048;

const pool = createProcessPool<ImageWorkerRequest, ImageWorkerResult>({
    name: "Image Compression Tool",
    entry: "image_worker",
    sourceDir: __dirname,
    serviceName: "Trilium image worker",
    maxWorkers: () => defaultWorkerCount(WORKER_HEAP_MB),
    heapMb: WORKER_HEAP_MB,
    bootTimeoutMs: 30 * 1000,
    // Far longer than any decode should take: an image near the size ceiling sharing the memory
    // bus with others has taken over two minutes, and killing it only moved the work onto the
    // main thread.
    replyTimeoutMs: 15 * 60 * 1000,
    idleShutdownMs: 30 * 1000,
    traceEnv: "TRILIUM_IMAGE_WORKER_DEBUG"
});

/**
 * A preview's source is at most 5 MB (`MAX_IMAGE_DOWNLOAD_SIZE` in core's `link_embed.ts`), so its
 * worker gets a small heap and a JPEG decode budget below it, which refuses an oversized JPEG
 * rather than running the worker out of memory.
 */
const PREVIEW_WORKER_HEAP_MB = 512;
const PREVIEW_DECODE_BUDGET_MB = 256;

const previewPool = createProcessPool<ImageWorkerRequest, ImageWorkerResult>({
    name: "Link Preview Images",
    entry: "image_worker",
    sourceDir: __dirname,
    serviceName: "Trilium link preview image worker",
    maxWorkers: () => 1,
    heapMb: PREVIEW_WORKER_HEAP_MB,
    replyTimeoutMs: 30 * 1000,
    idleShutdownMs: 30 * 1000,
    traceEnv: "TRILIUM_IMAGE_WORKER_DEBUG"
});
