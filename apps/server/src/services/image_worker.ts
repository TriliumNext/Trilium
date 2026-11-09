/**
 * The worker side of the image pool: decodes and re-encodes one image at a time, off the process
 * that has to keep answering requests.
 *
 * It imports only {@link image_codec} and the worker channel. Options, the database and the logger
 * stay on the other side of the message, so this bundles to jimp and little else.
 */

import type {
    ImageCompressionOutcome,
    ImageCompressionRequest,
    PreviewResizeOutcome,
    PreviewResizeRequest
} from "@triliumnext/core/src/services/image_provider.js";

import { compressImageBytes, resizePreviewImage } from "./image_codec.js";
import { serveJobs } from "./workers/worker_channel.js";

export type ImageWorkerRequest =
    | {
        kind: "compress";
        buffer: Uint8Array;
        request: ImageCompressionRequest;
        /** The most this decode may allocate — what the caller set aside for it. */
        budgetMb: number;
    }
    | {
        kind: "preview";
        bytes: Uint8Array;
        request: PreviewResizeRequest;
        /** The most this decode may allocate, kept below the preview worker's heap. */
        budgetMb: number;
    };

export type ImageWorkerResult = ImageCompressionOutcome | PreviewResizeOutcome;

/* v8 ignore start -- runs only inside a worker process, where the harness does not follow. */
serveJobs({ name: "image worker", traceEnv: "TRILIUM_IMAGE_WORKER_DEBUG" }, runImageJob);

function runImageJob(job: ImageWorkerRequest, logs: string[]): Promise<ImageWorkerResult> {
    // Per-image detail travels back only when tracing asked for it; the parent would drop it.
    const log = (line: string, detail?: boolean) => {
        if (!detail || process.env.TRILIUM_IMAGE_WORKER_DEBUG) {
            logs.push(line);
        }
    };

    return job.kind === "compress"
        ? compressImageBytes(job.buffer, job.request, log, job.budgetMb)
        : resizePreviewImage(job.bytes, job.request, log, job.budgetMb);
}
/* v8 ignore stop */
