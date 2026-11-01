import server from "./server.js";

/**
 * Uploads a file to a chunked upload endpoint, a slice at a time.
 *
 * A single request cannot carry a file measured in gigabytes with any confidence: a reverse proxy
 * caps the body, a timeout ends it, a dropped connection loses all of it, and there is no progress to
 * show along the way. Sending it in slices answers all four, because each slice is an ordinary small
 * request that can be retried on its own.
 *
 * The server is the authority on how far the file has got. Every failure is followed by asking it
 * where to continue from, so a slice whose response was lost is never sent twice and a slice that
 * broke partway resumes at the byte it stopped at.
 *
 * A connection that goes away is waited out rather than treated as the end: a file this size is
 * uploaded over a quarter of an hour at best and a night at worst, from a phone that will be put in
 * a pocket and a laptop that will be closed, and none of that should cost the whole transfer. So
 * every request keeps being retried, at a delay that settles at {@link MAX_RETRY_DELAY_MS}, until
 * either it goes through or the endpoint says the upload is gone — which is the one answer no amount
 * of waiting improves, and the only one this gives up on.
 *
 * Nothing here knows what the file is for: the endpoint decides that, and `metadata` reaches it
 * untouched.
 *
 * @example
 * ```ts
 * const result = await uploadInChunks<RestoreStarted>({
 *     endpoint: "setup/restore/upload",
 *     blob: file,
 *     fileName: file.name,
 *     onProgress: ({ fraction, etaMs }) => setProgress({ fraction, etaMs }),
 *     signal: abortController.signal
 * });
 * ```
 *
 * @module
 */

/** Content type of a chunk. Deliberately not `application/octet-stream`, which the server's own body
 * parser would swallow into memory before the route ever saw it. */
export const CHUNK_CONTENT_TYPE = "application/vnd.trilium.chunk";

/**
 * Attempts a single request gets before the upload gives up on it. With the delays below, that is
 * about a quarter of an hour of a connection that is simply not there.
 */
const DEFAULT_MAX_RETRIES = 60;
/** How long the first retry waits, each further one waiting twice as long as the one before it. */
const DEFAULT_RETRY_DELAY_MS = 1000;
/**
 * The longest a retry waits, which is where a drawn-out outage settles: far enough apart not to
 * hammer a server that is not answering, close enough together that the upload picks up again soon
 * after the connection does.
 */
const MAX_RETRY_DELAY_MS = 15 * 1000;

export interface ChunkedUploadProgress {
    sentBytes: number;
    totalBytes: number;
    /** Between 0 and 1. */
    fraction: number;
    /** Averaged over the time actually spent transferring; 0 until the first chunk lands. */
    bytesPerSecond: number;
    /** Milliseconds left at the current rate, or `null` while there is nothing to work that out from. */
    etaMs: number | null;
    /** Whether the upload is waiting on a connection rather than getting on with it. */
    reconnecting: boolean;
}

export interface ChunkedUploadOptions {
    /** Base path of the endpoint, relative to the API root, e.g. `"setup/restore/upload"`. */
    endpoint: string;
    blob: Blob;
    /** The name to give the file at the other end. */
    fileName: string;
    /** Passed to the endpoint as-is when the upload starts. */
    metadata?: Record<string, unknown>;
    onProgress?: (progress: ChunkedUploadProgress) => void;
    /** Cancels the upload and tells the server to forget it. */
    signal?: AbortSignal;
    /** Attempts per request, a chunk being one request. Defaults to {@link DEFAULT_MAX_RETRIES}. */
    maxRetriesPerRequest?: number;
    /** Delay before the first retry, doubling with each further one. Defaults to a second. */
    retryDelayMs?: number;
    /** Ceiling the doubling stops at. Defaults to {@link MAX_RETRY_DELAY_MS}. */
    maxRetryDelayMs?: number;
}

/** What the endpoint says about a session, whether it is being started or asked after. */
export interface ChunkedUploadStatus {
    uploadId: string;
    fileName: string;
    totalBytes: number;
    receivedBytes: number;
    chunkSize: number;
    expiresAt: number;
}

/**
 * Sends `blob` to `endpoint` and returns whatever that endpoint answers once the file is complete.
 *
 * @throws the server's own message for a failure it will not recover from, or `"Upload cancelled"`
 *         when the caller's signal aborts.
 */
export async function uploadInChunks<T>(options: ChunkedUploadOptions): Promise<T> {
    const { endpoint, blob, fileName, metadata, onProgress, signal } = options;
    const totalBytes = blob.size;
    const startedAt = Date.now();
    let sentBytes = 0;
    let reconnecting = false;
    /** Time already waited out, kept out of the rate: see {@link activeMs}. */
    let stalledMs = 0;
    let waitingSince: number | null = null;

    report();

    // Retried like everything else, and safe to be: a `begin` whose answer was lost leaves a session
    // nothing will ever be sent to, which is what an endpoint that lets a new upload take the place
    // of an old one exists for.
    const session = await withRetries(
        () => request<ChunkedUploadStatus>("POST", `${endpoint}/begin`, {
            signal,
            body: JSON.stringify({ fileName, totalBytes, metadata }),
            contentType: "application/json"
        }),
        { ...policy(), retryable: isConnectionFailure }
    );

    sentBytes = session.receivedBytes;
    report();

    try {
        while (sentBytes < totalBytes) {
            // The slice and the offset are both taken when the attempt runs, not when it is written:
            // a retry that follows a resync has to send what the server is actually waiting for.
            const sent = await withRetries(
                () => request<ChunkedUploadStatus>(
                    "POST",
                    `${endpoint}/${session.uploadId}/chunk?offset=${sentBytes}`,
                    {
                        signal,
                        body: blob.slice(sentBytes, sentBytes + session.chunkSize),
                        contentType: CHUNK_CONTENT_TYPE
                    }
                ),
                {
                    ...policy(),
                    retryable: isWorthRetrying,
                    // Whatever went wrong, the server knows what it holds and this side does not: a
                    // lost response means the chunk did land, a broken connection means part of it
                    // did.
                    resync: async () => {
                        const status = await request<ChunkedUploadStatus>("GET", `${endpoint}/${session.uploadId}`, { signal });
                        sentBytes = status.receivedBytes;
                        report();
                    }
                }
            );

            sentBytes = sent.receivedBytes;
            report();
        }

        // Worth retrying more than any single chunk was: every byte is already there, and an answer
        // lost on the way back would otherwise mean sending all of them again.
        return await withRetries(
            () => request<T>("POST", `${endpoint}/${session.uploadId}/finish`, { signal }),
            { ...policy(), retryable: isConnectionFailure }
        );
    } catch (e) {
        // The session would expire on its own, but not before holding the whole file on the server's
        // disk for an hour and, where only one upload is allowed at a time, the next attempt with it.
        await request("DELETE", `${endpoint}/${session.uploadId}`).catch(() => {});
        throw e;
    }

    /** The retry rules every request shares, each adding what it alone is worth retrying for. */
    function policy(): Omit<RetryPolicy, "retryable"> {
        return {
            max: options.maxRetriesPerRequest ?? DEFAULT_MAX_RETRIES,
            firstDelayMs: options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS,
            maxDelayMs: options.maxRetryDelayMs ?? MAX_RETRY_DELAY_MS,
            onWaiting: whileWaiting,
            signal
        };
    }

    /** Notes the connection going and coming back, so the caller can say which it is. */
    function whileWaiting(waiting: boolean) {
        if (reconnecting === waiting) {
            return;
        }

        reconnecting = waiting;
        if (waiting) {
            waitingSince = Date.now();
        } else if (waitingSince !== null) {
            stalledMs += Date.now() - waitingSince;
            waitingSince = null;
        }

        report();
    }

    /**
     * How long the transfer has been transferring, which is what a rate has to divide by: an hour
     * spent waiting for a connection is not an hour of slow progress, and counting it would leave a
     * rate and an estimate that stay wrong long after the connection is back.
     */
    function activeMs(): number {
        return Date.now() - startedAt - stalledMs - (waitingSince === null ? 0 : Date.now() - waitingSince);
    }

    function report() {
        if (!onProgress) {
            return;
        }

        const elapsedMs = activeMs();
        const bytesPerSecond = sentBytes > 0 && elapsedMs > 0 ? (sentBytes / elapsedMs) * 1000 : 0;

        onProgress({
            sentBytes,
            totalBytes,
            fraction: totalBytes > 0 ? sentBytes / totalBytes : 0,
            bytesPerSecond,
            etaMs: bytesPerSecond > 0 ? ((totalBytes - sentBytes) / bytesPerSecond) * 1000 : null,
            reconnecting
        });
    }
}

/** How a request is retried, and for how long. */
interface RetryPolicy {
    /** Whether a failure is one that retrying could fix. */
    retryable: (e: unknown) => boolean;
    /** Brings this side back in step with the endpoint before the next attempt. */
    resync?: () => Promise<void>;
    /** Told when the wait for a connection begins, and when it ends. */
    onWaiting?: (waiting: boolean) => void;
    max: number;
    firstDelayMs: number;
    maxDelayMs: number;
    signal?: AbortSignal;
}

/**
 * Retries `attempt` for as long as the failure is one that retrying can fix, waiting longer between
 * each attempt up to the policy's ceiling.
 *
 * The resync is part of the same loop rather than a step before it: it is one more request over the
 * connection that has just failed, so it fails too, and treating that as the end would undo the
 * waiting that everything here is for.
 */
async function withRetries<T>(attempt: () => Promise<T>, policy: RetryPolicy): Promise<T> {
    for (let retriesLeft = policy.max; ; retriesLeft--) {
        try {
            const result = await attempt();
            policy.onWaiting?.(false);

            return result;
        } catch (e) {
            if (retriesLeft <= 0 || !policy.retryable(e) || policy.signal?.aborted) {
                policy.onWaiting?.(false);
                throw e;
            }
        }

        policy.onWaiting?.(true);
        await waitBeforeRetry(delayFor(policy, retriesLeft), policy.signal);

        try {
            await policy.resync?.();
        } catch (e) {
            if (!policy.retryable(e)) {
                policy.onWaiting?.(false);
                throw e;
            }
        }
    }
}

/** Twice the last wait, up to the ceiling the policy settles at. */
function delayFor(policy: RetryPolicy, retriesLeft: number): number {
    return Math.min(policy.firstDelayMs * 2 ** (policy.max - retriesLeft), policy.maxDelayMs);
}

function isWorthRetrying(e: unknown): boolean {
    if (e instanceof ChunkedUploadError) {
        // A conflict means the offset has moved, which the resync then corrects; anything else in the
        // 4xx range is this side's mistake and would fail again identically.
        return e.status === 409 || e.status >= 500;
    }

    return isConnectionFailure(e);
}

/**
 * Whether the request never got an answer at all, which is the failure retrying is for.
 *
 * The one to be sure of excluding is the caller's own cancellation, which arrives the same way a
 * dropped connection does and would otherwise be waited out rather than obeyed.
 */
function isConnectionFailure(e: unknown): boolean {
    return !(e instanceof ChunkedUploadError) && !(e instanceof DOMException && e.name === "AbortError");
}

/** A response the server refused, carrying the status so the retry rules can tell the cases apart. */
export class ChunkedUploadError extends Error {
    constructor(message: string, readonly status: number) {
        super(message);
        this.name = "ChunkedUploadError";
    }
}

interface RequestOptions {
    body?: BodyInit;
    contentType?: string;
    signal?: AbortSignal;
}

async function request<T>(method: string, url: string, options: RequestOptions = {}): Promise<T> {
    const headers: Record<string, string> = {};
    for (const [ name, value ] of Object.entries(await server.getHeaders())) {
        if (value) {
            headers[name] = value;
        }
    }
    if (options.contentType) {
        headers["content-type"] = options.contentType;
    }

    const attempt = abandonWhenForegrounded(options.signal);
    try {
        const response = await fetch(`${window.glob.baseApiUrl}${url}`, {
            method,
            headers,
            body: options.body,
            signal: attempt.signal
        });

        if (!response.ok) {
            throw new ChunkedUploadError(await messageOf(response), response.status);
        }

        return response.status === 204 ? (undefined as T) : await response.json() as T;
    } catch (e) {
        // Ours rather than the caller's, so it reads as a connection to try again over rather than
        // as the cancellation an abort otherwise means.
        throw attempt.abandoned && !(e instanceof ChunkedUploadError)
            ? new Error("The connection was left behind while the app was in the background.")
            : e;
    } finally {
        attempt.release();
    }
}

/**
 * A signal for one attempt, which gives up on the request when the app comes back to the foreground.
 *
 * A connection the operating system took away while the app was in the background does not always
 * fail: the request can sit there, holding the upload at a standstill with nothing to retry and
 * nothing to say for itself, which is the shape a phone puts an upload in every time it is put in a
 * pocket. Coming back is the moment to stop believing in it.
 *
 * Being wrong about that costs a round trip and nothing else: the server counts what reached its
 * disk, so the next attempt carries on from the byte this one had got to.
 */
function abandonWhenForegrounded(callerSignal?: AbortSignal) {
    const attempt = new AbortController();
    const state = {
        signal: attempt.signal,
        /** Whether it was this that ended the request, rather than the caller cancelling it. */
        abandoned: false,
        release
    };

    // An already-cancelled signal never fires, so it is acted on rather than listened to.
    if (callerSignal?.aborted) {
        attempt.abort();
    } else {
        callerSignal?.addEventListener("abort", cancel, { once: true });
    }
    document.addEventListener("visibilitychange", onForegrounded);

    return state;

    function cancel() {
        attempt.abort();
    }

    function onForegrounded() {
        if (document.visibilityState !== "visible") {
            return;
        }

        state.abandoned = true;
        attempt.abort();
    }

    function release() {
        callerSignal?.removeEventListener("abort", cancel);
        document.removeEventListener("visibilitychange", onForegrounded);
    }
}

/** The server's own words where it gave any, since they are what the user is shown. */
async function messageOf(response: Response): Promise<string> {
    try {
        const body = await response.text();
        const parsed = body.startsWith("{") ? JSON.parse(body) as { message?: string } : null;

        return parsed?.message || body || response.statusText;
    } catch {
        return response.statusText;
    }
}

/**
 * Waits `ms` before the next attempt, or until the browser says the connection is back, whichever
 * comes first.
 *
 * Listening for that is what keeps a long wait from being the thing the user is waiting on: a phone
 * that has just walked back into signal, or a laptop that has just been opened, should carry on then
 * rather than a quarter of a minute later.
 */
function waitBeforeRetry(ms: number, signal?: AbortSignal): Promise<void> {
    return new Promise((resolve, reject) => {
        const timer = setTimeout(done, ms);
        window.addEventListener("online", done);
        signal?.addEventListener("abort", onAbort, { once: true });

        function done() {
            cleanUp();
            resolve();
        }

        function onAbort() {
            cleanUp();
            reject(new DOMException("Upload cancelled", "AbortError"));
        }

        function cleanUp() {
            clearTimeout(timer);
            window.removeEventListener("online", done);
            signal?.removeEventListener("abort", onAbort);
        }
    });
}
