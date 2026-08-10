import {
    type ScryptParams,
    streamedContainerSize,
    writeBackupContainer
} from "@triliumnext/backup-container/web";

import { type LiveDatabaseReader, streamLiveDatabasePages } from "./backup-stream.js";

/**
 * Feeds a database backup into a download the service worker is holding open.
 *
 * The worker end of a three-party relay: the service worker answers a download navigation with a
 * streamed `Response`, the page passes one end of a message channel through to this worker, and
 * this module pulls pages off the live database and pushes them down the channel. Nothing lands in
 * the origin's own storage on the way, which is the point: a quota that cannot hold a second copy
 * of the database never has to.
 *
 * The stream is pull-driven, which is what carries the browser's backpressure all the way here:
 * the service worker asks for a chunk each time the download can take more, so a slow disk slows
 * the database reads rather than piling chunks up in a message queue.
 *
 * The payload is the plain database, or, given a passphrase, a streamed encrypted container: the
 * format's forward-only shape, whose GCM frames carry the integrity a patched-in digest cannot on
 * a destination already streamed away. Compression is never used here — at these sizes it is more
 * than a low-end device can afford — and either shape's exact size is known up front, which is
 * what gives the download its `Content-Length` and the browser its progress bar.
 *
 * Protocol, from the service worker's side: it receives `begin` (with the exact byte size), then
 * one `chunk` per `pull` it sends, then `end`; `error` may arrive at any point, and `cancel` may
 * be sent at any point.
 *
 * @module
 */

/** The slice of `MessagePort` the stream needs, kept structural for tests. */
export interface DownloadPort {
    postMessage(message: unknown, transfer?: Transferable[]): void;
    onmessage: ((event: { data: unknown }) => void) | null;
    close?(): void;
}

/** How the download ended, for the screen that gates its Continue on it. */
export interface DownloadOutcome {
    status: "done" | "cancelled" | "failed";
    /** What stopped it, when `failed`. */
    message?: string;
}

export interface DownloadOptions {
    /** Wraps the stream in an encrypted, streamed container. Plain database bytes otherwise. */
    passphrase?: string;
    /** scrypt cost override, for tests that cannot afford the production one. */
    scrypt?: ScryptParams;
}

/**
 * How long the stream waits to be asked for more before giving the download up for dead.
 *
 * A living download asks many times a second, and even one the user paused sits behind a service
 * worker the page keeps pinging alive. What this catches is the far end having died without a
 * word — a reclaimed service worker cannot say goodbye — so the wait is generous enough that no
 * plausible pause trips it, and its expiry means cleanup, never a failed backup that was working.
 */
const PULL_TIMEOUT_MS = 10 * 60 * 1000;

/** How the far end ended the stream mid-payload, carried out of the sink as an exception. */
class DownloadStopped extends Error {
    constructor(readonly why: "cancel" | "abandoned") {
        super(`The download was ${why === "cancel" ? "cancelled" : "abandoned"}.`);
        this.name = "DownloadStopped";
    }
}

/**
 * Streams the live database into `port` until it is done, cancelled, or fails.
 *
 * Never rejects: failures are reported through the port for the download's sake, and the outcome
 * is returned for the screen that is waiting to enable its Continue.
 */
export async function streamDatabaseDownload(
    db: LiveDatabaseReader,
    port: DownloadPort,
    options: DownloadOptions = {}
): Promise<DownloadOutcome> {
    const requests: ("pull" | "cancel")[] = [];
    let wake: (() => void) | null = null;

    port.onmessage = (event) => {
        const type = (event.data as { type?: unknown } | null)?.type;
        if (type === "pull" || type === "cancel") {
            requests.push(type);
            wake?.();
        }
    };

    const nextRequest = async (): Promise<"pull" | "cancel" | "abandoned"> => {
        while (requests.length === 0) {
            const woke = await new Promise<boolean>((resolve) => {
                const timer = setTimeout(() => resolve(false), PULL_TIMEOUT_MS);
                wake = () => {
                    clearTimeout(timer);
                    resolve(true);
                };
            });
            wake = null;
            if (!woke) {
                return "abandoned";
            }
        }
        return requests.shift() ?? "cancel";
    };

    /** Posts one chunk per granted pull, or throws the stop that was granted instead. */
    const sendChunk = async (chunk: Uint8Array): Promise<void> => {
        const request = await nextRequest();
        if (request !== "pull") {
            throw new DownloadStopped(request);
        }

        // Fresh, whole buffers are handed over rather than copied; anything else is copied first.
        const data = chunk.byteOffset === 0 && chunk.byteLength === chunk.buffer.byteLength
            ? chunk.buffer
            : chunk.slice().buffer;
        port.postMessage({ type: "chunk", data }, [ data ]);
    };

    let source: ReadableStream<Uint8Array> | undefined;
    try {
        const { byteSize, stream } = streamLiveDatabasePages(db);
        source = stream;

        // A container either way, so every backup this application writes has one shape and one
        // extension. Without a passphrase it is the database with a header in front of it, held to
        // the size that header records; with one, every frame is authenticated as well.
        const encrypted = !!options.passphrase;
        port.postMessage({ type: "begin", byteSize: streamedContainerSize(byteSize, encrypted) });
        await writeBackupContainer(
            stream,
            new WritableStream<Uint8Array>({ write: sendChunk }),
            {
                passphrase: options.passphrase,
                streamed: true,
                // Never compressed: at these sizes it costs more than a low-end device can spare,
                // and the browser is downloading to a disk rather than over a wire.
                plaintextSize: byteSize,
                scrypt: options.scrypt
            }
        );
        port.postMessage({ type: "end" });
        return { status: "done" };
    } catch (e) {
        if (e instanceof DownloadStopped) {
            if (e.why === "abandoned") {
                console.warn("[Backup] The download stopped asking for data; abandoning the stream.");
                return { status: "failed", message: "The download stopped." };
            }
            return { status: "cancelled" };
        }

        const message = e instanceof Error ? e.message : String(e);
        post(port, { type: "error", message });
        return { status: "failed", message };
    } finally {
        // Releases the pages still queued behind a stream that ended early; one already consumed
        // or errored refuses, which is the same as being released.
        await source?.cancel().catch(() => undefined);
        port.onmessage = null;
        port.close?.();
    }
}

/** A best-effort message: the port may already be gone, and this report is all that would say so. */
function post(port: DownloadPort, message: unknown): void {
    try {
        port.postMessage(message);
    } catch {
        // Nobody left to tell.
    }
}
