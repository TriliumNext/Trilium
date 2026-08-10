import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { CHUNK_CONTENT_TYPE, ChunkedUploadError, uploadInChunks } from "./chunked_upload.js";

vi.mock("./server.js", () => ({
    default: {
        // A null header must not reach fetch, which would send it as the string "null".
        getHeaders: async () => ({ "x-csrf-token": "token", "trilium-hoisted-note-id": null })
    }
}));

const CHUNK_SIZE = 4;

/** Stands in for the endpoint: accumulates what it is sent and answers the way the server does. */
class FakeEndpoint {
    received = "";
    totalBytes = 0;
    aborted = false;
    finished = 0;
    readonly calls: { method: string; url: string; headers: Record<string, string> }[] = [];
    /** Queued failures, applied to chunk requests in order. `null` sends the chunk through. */
    private readonly failures: (Failure | null)[] = [];
    /** Queued failures for everything that is not a chunk, in the order those requests arrive. */
    private readonly otherFailures: (Failure | null)[] = [];

    failNextChunks(...failures: (Failure | null)[]) {
        this.failures.push(...failures);
    }

    /** Applies to `begin` and `finish`, which are one request each and share the queue. */
    failNextRequests(...failures: (Failure | null)[]) {
        this.otherFailures.push(...failures);
    }

    fetch = async (url: string, init: RequestInit = {}): Promise<Response> => {
        const method = init.method ?? "GET";
        this.calls.push({ method, url, headers: init.headers as Record<string, string> });

        if (url.endsWith("/begin")) {
            const refusal = this.refuseOther();
            if (refusal) {
                return refusal;
            }

            const body = JSON.parse(String(init.body)) as { totalBytes: number };
            this.totalBytes = body.totalBytes;
            return json({ uploadId: "upload1", fileName: "backup.db", totalBytes: body.totalBytes, receivedBytes: 0, chunkSize: CHUNK_SIZE, expiresAt: 0 });
        }

        if (url.includes("/chunk?offset=")) {
            const failure = this.failures.shift();
            if (failure?.hang) {
                // Answers nothing at all, the way a connection that was taken away does, and gives
                // up only when the caller stops waiting on it.
                return new Promise((_, reject) => {
                    init.signal?.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
                });
            }
            if (failure) {
                return failure.status ? error(failure.status, failure.message) : Promise.reject(new TypeError("Failed to fetch"));
            }

            const offset = Number(url.split("offset=")[1]);
            if (offset !== this.received.length) {
                return error(409, `Chunk starts at ${offset}, but ${this.received.length} bytes have been received.`);
            }

            this.received += await (init.body as Blob).text();
            return json(this.status());
        }

        if (url.endsWith("/finish")) {
            const refusal = this.refuseOther();
            if (refusal) {
                return refusal;
            }

            this.finished++;
            return json({ restored: this.received });
        }

        if (method === "DELETE") {
            this.aborted = true;
            return new Response(null, { status: 204 });
        }

        return json(this.status());
    };

    /** The next queued failure for a non-chunk request, or nothing where it should go through. */
    private refuseOther() {
        const failure = this.otherFailures.shift();
        if (!failure) {
            return null;
        }

        return failure.status ? error(failure.status, failure.message) : Promise.reject(new TypeError("Failed to fetch"));
    }

    private status() {
        return { uploadId: "upload1", fileName: "backup.db", totalBytes: this.totalBytes, receivedBytes: this.received.length, chunkSize: CHUNK_SIZE, expiresAt: 0 };
    }
}

interface Failure {
    /** Omitted for a connection that never answered at all. */
    status?: number;
    message?: string;
    /** Never answers and never fails, which is what a connection taken away mid-request can do. */
    hang?: boolean;
}

function json(body: unknown) {
    return new Response(JSON.stringify(body), { status: 200, headers: { "content-type": "application/json" } });
}

function error(status: number, message = "failed") {
    return new Response(JSON.stringify({ message }), { status, headers: { "content-type": "application/json" } });
}

function upload(endpoint: FakeEndpoint, content: string, overrides = {}) {
    return uploadInChunks<{ restored: string }>({
        endpoint: "setup/restore/upload",
        blob: new Blob([ content ]),
        fileName: "backup.db",
        retryDelayMs: 0,
        ...overrides
    });
}

let endpoint: FakeEndpoint;

beforeEach(() => {
    endpoint = new FakeEndpoint();
    window.glob = { ...window.glob, baseApiUrl: "api/" } as typeof window.glob;
    vi.stubGlobal("fetch", endpoint.fetch);
});

afterEach(() => {
    vi.unstubAllGlobals();
    // Timers and the clock are stubbed by the tests that steer them; nothing after them should
    // inherit a clock that does not move.
    vi.restoreAllMocks();
});

describe("chunked upload", () => {
    it("sends the file a slice at a time and returns what the endpoint answers", async () => {
        const content = "restore me please";

        const result = await upload(endpoint, content);

        expect(result).toEqual({ restored: content });
        expect(endpoint.received).toBe(content);
        expect(endpoint.finished).toBe(1);

        const offsets = endpoint.calls.filter((call) => call.url.includes("/chunk?")).map((call) => Number(call.url.split("offset=")[1]));
        expect(offsets).toEqual([ 0, 4, 8, 12, 16 ]);
    });

    it("sends the headers the API expects, dropping the ones with nothing in them", async () => {
        await upload(endpoint, "abcd");

        const chunkCall = endpoint.calls.find((call) => call.url.includes("/chunk?"));
        expect(chunkCall?.headers).toEqual({ "x-csrf-token": "token", "content-type": CHUNK_CONTENT_TYPE });
        expect(endpoint.calls[0].headers).toMatchObject({ "content-type": "application/json" });
    });

    it("reports progress that climbs to the whole file", async () => {
        const onProgress = vi.fn();

        await upload(endpoint, "12345678", { onProgress });

        const fractions = onProgress.mock.calls.map(([ progress ]) => progress.fraction);
        expect(fractions[0]).toBe(0);
        expect(fractions.at(-1)).toBe(1);
        expect(onProgress).toHaveBeenLastCalledWith(expect.objectContaining({ sentBytes: 8, totalBytes: 8 }));
    });

    it("asks the endpoint where the file got to before retrying, so nothing is sent twice", async () => {
        // The first chunk lands but its response is lost, and the second connection simply fails.
        endpoint.failNextChunks({ status: 409, message: "offset moved" }, {});

        const result = await upload(endpoint, "abcdefgh");

        expect(result).toEqual({ restored: "abcdefgh" });
        expect(endpoint.received).toBe("abcdefgh");
        expect(endpoint.calls.filter((call) => call.method === "GET")).toHaveLength(2);
    });

    it("gives up on a failure retrying cannot fix, and tells the endpoint to forget the upload", async () => {
        endpoint.failNextChunks({ status: 400, message: "the offset must be stated as an integer" });

        await expect(upload(endpoint, "abcd")).rejects.toThrow("the offset must be stated as an integer");
        expect(endpoint.aborted).toBe(true);
        expect(endpoint.calls.filter((call) => call.url.includes("/chunk?"))).toHaveLength(1);
    });

    it("gives up once the retries are spent", async () => {
        endpoint.failNextChunks({}, {}, {}, {});

        await expect(upload(endpoint, "abcd", { maxRetriesPerRequest: 2 })).rejects.toBeInstanceOf(TypeError);
        expect(endpoint.calls.filter((call) => call.url.includes("/chunk?"))).toHaveLength(3);
        expect(endpoint.aborted).toBe(true);
    });

    it("raises the endpoint's own words, with the status it refused on", async () => {
        endpoint.failNextChunks({ status: 507, message: "the disk is full" });

        const failure = await upload(endpoint, "abcd", { maxRetriesPerRequest: 0 }).catch((e) => e);

        expect(failure).toBeInstanceOf(ChunkedUploadError);
        expect(failure).toMatchObject({ message: "the disk is full", status: 507 });
    });

    it("stops when the caller cancels, and leaves nothing behind on the endpoint", async () => {
        const controller = new AbortController();
        endpoint.failNextChunks({ status: 500 });
        controller.abort();

        await expect(upload(endpoint, "abcdefgh", { signal: controller.signal })).rejects.toThrow();
        expect(endpoint.aborted).toBe(true);
        expect(endpoint.finished).toBe(0);
    });

    it("does not try to abort a session that was never started", async () => {
        vi.stubGlobal("fetch", async () => error(409, "Another upload is already in progress."));

        await expect(upload(endpoint, "abcd")).rejects.toThrow("Another upload is already in progress.");
        expect(endpoint.aborted).toBe(false);
    });
});

describe("chunked upload: waiting out a connection", () => {
    it("keeps sending through an outage far longer than any single retry waits", async () => {
        // A file this size is uploaded from a phone that goes into a pocket and a laptop that gets
        // closed. None of that should cost the transfer.
        endpoint.failNextChunks(...Array.from({ length: 30 }, () => ({})));

        const result = await upload(endpoint, "abcdefgh");

        expect(result).toEqual({ restored: "abcdefgh" });
    });

    it("says while it is waiting, and stops saying so once the connection is back", async () => {
        const onProgress = vi.fn();
        endpoint.failNextChunks({}, {});

        await upload(endpoint, "abcdefgh", { onProgress });

        const reconnecting = onProgress.mock.calls.map(([ progress ]) => progress.reconnecting);
        expect(reconnecting).toContain(true);
        expect(reconnecting.at(-1)).toBe(false);
    });

    it("leaves the time spent waiting out of the rate, which is about transferring", async () => {
        // A clock that only moves while the upload is waiting on a connection: every byte here goes
        // out in no time at all, and a minute passes with the connection down. Counting that minute
        // would leave a rate and an estimate that stay wrong long after the connection is back.
        const onProgress = vi.fn();
        let now = 0;
        vi.spyOn(Date, "now").mockImplementation(() => now);
        recordWaits({ onWait: () => (now += 60_000) });
        endpoint.failNextChunks({});

        await upload(endpoint, "abcd", { onProgress });

        expect(onProgress).toHaveBeenLastCalledWith(expect.objectContaining({ sentBytes: 4, bytesPerSecond: 0, etaMs: null }));
    });

    it("waits longer after each failure, up to the ceiling it settles at", async () => {
        const waits = recordWaits();
        endpoint.failNextChunks({}, {}, {}, {}, {});

        await upload(endpoint, "abcd", { retryDelayMs: 100, maxRetryDelayMs: 250 });

        expect(waits).toEqual([ 100, 200, 250, 250, 250 ]);
    });

    it("carries on as soon as the browser says the connection is back, rather than waiting it out", async () => {
        // The wait is never allowed to end on its own, so the upload finishing at all is the event
        // that ended it. Announced a microtask late, since the wait only starts listening once it
        // has asked for its timer.
        recordWaits({ fire: false, onWait: () => queueMicrotask(() => window.dispatchEvent(new Event("online"))) });
        endpoint.failNextChunks({});

        await expect(upload(endpoint, "abcd", { retryDelayMs: 60_000 })).resolves.toEqual({ restored: "abcd" });
    });

    it("stops believing in a request that was left hanging while the app was away", async () => {
        // The connection is gone but the request does not know it, which is what a phone leaves
        // behind every time it is put in a pocket. Nothing else would ever end this upload.
        endpoint.failNextChunks({ hang: true });

        const uploaded = upload(endpoint, "abcd");
        await vi.waitFor(() => expect(endpoint.calls.some((call) => call.url.includes("/chunk?"))).toBe(true));
        document.dispatchEvent(new Event("visibilitychange"));

        await expect(uploaded).resolves.toEqual({ restored: "abcd" });
    });

    it("gives up on an upload the endpoint no longer has, which no amount of waiting brings back", async () => {
        endpoint.failNextChunks({ status: 410, message: "The server restarted, so the upload it was holding is gone." });

        const failure = await upload(endpoint, "abcd").catch((e) => e);

        expect(failure).toMatchObject({ status: 410 });
        expect(endpoint.calls.filter((call) => call.url.includes("/chunk?"))).toHaveLength(1);
    });

    it("asks again for an answer to `finish` that was lost, rather than sending the file twice", async () => {
        endpoint.failNextRequests(null, {});

        const result = await upload(endpoint, "abcd");

        expect(result).toEqual({ restored: "abcd" });
        expect(endpoint.finished).toBe(1);
        expect(endpoint.calls.filter((call) => call.url.endsWith("/finish"))).toHaveLength(2);
        // The one thing that must not happen: the file being sent again from the start.
        expect(endpoint.calls.filter((call) => call.url.includes("/chunk?"))).toHaveLength(1);
    });

    it("waits out a connection that fails before the upload has even started", async () => {
        endpoint.failNextRequests({});

        await expect(upload(endpoint, "abcd")).resolves.toEqual({ restored: "abcd" });
    });
});

/**
 * Collects the delays that are asked for, and by default lets them through at once so a test does
 * not spend the wait it is asserting on.
 *
 * @param options.fire whether the wait ever ends by itself; `false` leaves only whatever else the
 *        upload is listening for to end it.
 * @param options.onWait called as each wait begins.
 */
function recordWaits({ fire = true, onWait }: { fire?: boolean; onWait?: () => void } = {}): number[] {
    const waits: number[] = [];
    const realSetTimeout = setTimeout;

    vi.stubGlobal("setTimeout", ((handler: () => void, ms: number) => {
        waits.push(ms);
        onWait?.();

        return realSetTimeout(handler, fire ? 0 : 60_000);
    }) as typeof setTimeout);

    return waits;
}
