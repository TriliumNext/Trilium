/**
 * The worker side of image compression: decodes and re-encodes one image at a time, off the
 * process that has to keep answering requests.
 *
 * Deliberately tiny, and importing only {@link image_codec}. Everything Trilium — options, the
 * database, the logger — stays on the other side of the message, so this bundles to jimp and a few
 * hundred lines rather than to a second copy of the server.
 *
 * A child process rather than a worker thread, and not by preference. Under Electron a worker
 * thread's isolate cannot survive this workload: its garbage collector hands sweeping to background
 * tasks that never run, so the first decode's memory is never reclaimed and the second decode waits
 * on it forever. A forked process is a main isolate on Node's own platform, where collection works,
 * on the desktop and the server alike.
 *
 * Nothing here decides anything. It is handed the bytes, the settings and the memory it may use,
 * and answers with what came out; a caller that never hears back falls back to doing it itself.
 */

import { getHeapStatistics } from "node:v8";

import type { ImageCompressionOutcome, ImageCompressionRequest } from "@triliumnext/core/src/services/image_provider.js";

import { compressImageBytes } from "./image_codec.js";

export interface ImageWorkerRequest {
    /** Matches the answer to the question, the two being in flight together with others. */
    id: number;
    buffer: Uint8Array;
    request: ImageCompressionRequest;
    /** The most this decode may allocate — what the caller set aside for it. */
    budgetMb: number;
}

/** A line the worker wants written as it happens, rather than when — or if — it finishes. */
export interface ImageWorkerTrace {
    trace: string;
}

export interface ImageWorkerResponse {
    id: number;
    outcome?: ImageCompressionOutcome;
    /** Set when the image could not be compressed at all; the caller reports it against that image. */
    error?: string;
    /** What the codec wanted written, carried back to the process that has somewhere to write it. */
    logs: string[];
}

/* v8 ignore start -- runs only inside a forked worker process, where the harness does not follow.
   What it does is exercised through the codec directly; what is left here is the message plumbing. */

/**
 * Sends a line to the process that has a logger, and prints it besides.
 *
 * Sent rather than only printed because a packaged desktop app has nowhere to show a child's
 * stdout, and the backend log is where someone looking into a run is actually reading.
 */
const announce = (message: string) => {
    console.log(`[image worker ${process.pid}] ${message}`);
    process.send?.({ trace: `worker ${process.pid}: ${message}` } satisfies ImageWorkerTrace);
};

/** The per-image commentary, which would be a line an image without the asking. */
const trace = (message: string) => {
    if (process.env.TRILIUM_IMAGE_WORKER_DEBUG) {
        announce(message);
    }
};

// Announced whether or not anyone asked for tracing: one line per process, and the one that answers
// why a run is slow rather than broken. A worker whose old space is smaller than the decode it is
// handed does not fail — it collects, over and over, taking several times longer while looking
// perfectly healthy. What V8 actually granted is the only place that shows.
announce(`loaded and listening; heap limit ${Math.round(getHeapStatistics().heap_size_limit / 1024 / 1024)} MB`);

process.on("message", (message: ImageWorkerRequest) => {
    const logs: string[] = [];
    const started = Date.now();

    trace(`received image #${message.id}, ${message.buffer.byteLength} bytes, budget ${message.budgetMb} MB`);

    compressImageBytes(
        message.buffer,
        message.request,
        // Detail is carried back only when it was asked for; the caller would drop it anyway, and
        // it would otherwise travel between processes an image at a time for nothing.
        (line, detail) => {
            if (!detail || process.env.TRILIUM_IMAGE_WORKER_DEBUG) {
                logs.push(line);
            }
        },
        message.budgetMb
    )
        .then(
            (outcome) => {
                trace(`image #${message.id} ${outcome.compressed ? "compressed" : `skipped (${outcome.reason})`}`
                    + ` in ${Date.now() - started}ms; replying`);
                reply({ id: message.id, outcome, logs });
            },
            (error: unknown) => {
                trace(`image #${message.id} failed in ${Date.now() - started}ms: ${describe(error)}`);
                reply({ id: message.id, error: describe(error), logs });
            }
        );
});

// A parent that has gone away is not coming back for an answer; going with it beats lingering.
process.on("disconnect", () => process.exit(0));

function reply(response: ImageWorkerResponse) {
    process.send?.(response);
}

function describe(error: unknown): string {
    return error instanceof Error ? (error.stack ?? error.message) : String(error);
}
/* v8 ignore stop */
