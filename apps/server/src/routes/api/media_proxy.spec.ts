import { EventEmitter } from "node:events";

import { ValidationError } from "@triliumnext/core";
import type express from "express";
import { beforeEach, describe, expect, it, vi } from "vitest";

const safeFetch = vi.hoisted(() => vi.fn());
vi.mock("../../services/safe_fetch.js", () => ({ safeFetch }));

import mediaProxy from "./media_proxy.js";

beforeEach(() => {
    safeFetch.mockReset();
});

describe("media proxy", () => {
    it("hands out an address that carries a token rather than the URL", () => {
        const { url } = mediaProxy.createProxy(post("https://example.com/clip.mp4"));

        expect(url).toMatch(/^api\/link-embed\/media-proxy\/[0-9a-f]{32}$/);
        expect(url).not.toContain("example.com");
        expect(() => mediaProxy.createProxy(post("file:///etc/passwd")))
            .toThrow(ValidationError);
        expect(() => mediaProxy.createProxy(post(undefined))).toThrow(ValidationError);
    });

    it("streams the range of the file that the media element asks for", async () => {
        safeFetch.mockResolvedValue(new Response(streamOf("abc", "def"), {
            status: 206,
            headers: {
                "content-type": "video/mp4", "content-length": "6",
                "content-range": "bytes 0-5/100", "set-cookie": "a=b"
            }
        }));
        const res = fakeResponse();

        await mediaProxy.streamProxy(get(createToken(), "bytes=0-5"), res.res);

        expect(safeFetch).toHaveBeenCalledExactlyOnceWith("https://example.com/clip.mp4",
            expect.objectContaining({ headers: { Range: "bytes=0-5" } }));
        expect(res.status).toBe(206);
        expect(res.headers).toEqual({
            "content-length": "6", "content-range": "bytes 0-5/100", "content-type": "video/mp4",
            "x-content-type-options": "nosniff", "content-security-policy": "sandbox",
            "cache-control": "no-store"
        });
        expect(res.body).toBe("abcdef");
        expect(res.isEnded).toBe(true);
    });

    it("serves a file of a generic type as one, and nothing that cannot be media", async () => {
        safeFetch.mockResolvedValueOnce(new Response("data", {
            headers: { "content-type": "binary/octet-stream" }
        }));
        const generic = fakeResponse();
        await mediaProxy.streamProxy(get(createToken()), generic.res);
        expect([ generic.status, generic.headers["content-type"], generic.body ])
            .toEqual([ 200, "application/octet-stream", "data" ]);

        safeFetch.mockResolvedValueOnce(new Response("<script>", {
            headers: { "content-type": "text/html" }
        }));
        const page = fakeResponse();
        await mediaProxy.streamProxy(get(createToken()), page.res);
        expect([ page.status, page.body ]).toEqual([ 415, "" ]);
    });

    it("answers 404 for an unknown token and 502 when the file cannot be had", async () => {
        const unknown = fakeResponse();
        await mediaProxy.streamProxy(get("0".repeat(32)), unknown.res);
        expect(unknown.status).toBe(404);

        safeFetch.mockResolvedValueOnce(new Response("", { status: 403 }));
        const refused = fakeResponse();
        await mediaProxy.streamProxy(get(createToken()), refused.res);
        expect(refused.status).toBe(502);

        safeFetch.mockRejectedValueOnce(new ValidationError("blocked"));
        const blocked = fakeResponse();
        await mediaProxy.streamProxy(get(createToken()), blocked.res);
        expect([ blocked.status, blocked.isEnded ]).toEqual([ 502, true ]);
        expect(safeFetch).toHaveBeenCalledTimes(2);
    });

    it("ends a response at 32 MiB and stops reading the file", async () => {
        const chunk = new Uint8Array(1024 * 1024);
        let chunksLeft = 40;
        let isCancelled = false;
        safeFetch.mockResolvedValue(new Response(new ReadableStream<Uint8Array>({
            pull(controller) {
                if (chunksLeft-- > 0) {
                    controller.enqueue(chunk);
                } else {
                    controller.close();
                }
            },
            cancel() {
                isCancelled = true;
            }
        }), { headers: { "content-type": "video/mp4" } }));
        const res = fakeResponse();

        await mediaProxy.streamProxy(get(createToken()), res.res);

        expect([ res.size, res.isEnded, isCancelled ]).toEqual([ 32 * 1024 * 1024, true, true ]);
    });

    it("serves the requests of one frame capture per token, then answers 429", async () => {
        safeFetch.mockImplementation(async () => new Response("abc", {
            headers: { "content-type": "video/mp4" }
        }));
        const token = createToken();
        const statuses: number[] = [];

        for (let i = 0; i < 9; i++) {
            const res = fakeResponse();
            await mediaProxy.streamProxy(get(token), res.res);
            statuses.push(res.status);
        }

        expect(statuses).toEqual([ ...Array(8).fill(200), 429 ]);
        expect(safeFetch).toHaveBeenCalledTimes(8);
    });

    it("lets go of the file without a stray rejection once the media element drops it", async () => {
        let source: ReadableStreamDefaultController<Uint8Array> | undefined;
        safeFetch.mockImplementation(async (_url: string, { signal }: RequestInit) => {
            // As undici does, aborting the request errors the body of its answer.
            signal?.addEventListener("abort", () => source?.error(signal.reason));
            const body = new ReadableStream<Uint8Array>({ start(controller) { source = controller; } });
            return new Response(body, { headers: { "content-type": "video/mp4" } });
        });
        const res = fakeResponse();

        const rejections = await collectRejections(async () => {
            const streaming = mediaProxy.streamProxy(get(createToken()), res.res);
            await nextTask();
            // The next chunk arrives as the media element goes away.
            source?.enqueue(new TextEncoder().encode("abc"));
            res.res.emit("close");
            await streaming;
        });

        expect(rejections).toEqual([]);
        expect([ res.body, res.isEnded ]).toEqual([ "", true ]);
    });

    it("forgets a token once its lifetime is over", async () => {
        const token = createToken();
        const now = Date.now();
        const clock = vi.spyOn(Date, "now").mockReturnValue(now + 61_000);
        try {
            createToken();
            const res = fakeResponse();
            await mediaProxy.streamProxy(get(token), res.res);
            expect(res.status).toBe(404);
            expect(safeFetch).not.toHaveBeenCalled();
        } finally {
            clock.mockRestore();
        }
    });

    it("serves an answer without a content type as a generic file, and lets go of a refused one", async () => {
        safeFetch.mockResolvedValueOnce(new Response(new TextEncoder().encode("data")));
        const untyped = fakeResponse();
        await mediaProxy.streamProxy(get(createToken()), untyped.res);
        expect([ untyped.status, untyped.headers["content-type"], untyped.body ])
            .toEqual([ 200, "application/octet-stream", "data" ]);

        // A refused answer whose body cannot be cancelled leaves no stray rejection behind.
        safeFetch.mockResolvedValueOnce(new Response(new ReadableStream({
            cancel() {
                throw new Error("cannot cancel");
            }
        }), { status: 500 }));
        const failed = fakeResponse();
        const rejections = await collectRejections(() => mediaProxy.streamProxy(get(createToken()), failed.res));
        expect([ failed.status, rejections ]).toEqual([ 502, [] ]);
    });

    it("waits for the client to take more data, and stops once it goes away", async () => {
        safeFetch.mockResolvedValueOnce(new Response(streamOf("abc", "def"), {
            headers: { "content-type": "video/mp4" }
        }));
        const drained = fakeResponse({ isBackedUp: true });
        drained.res.on("newListener", (event: string) => {
            if (event === "drain") {
                setTimeout(() => drained.res.emit("drain"));
            }
        });
        await mediaProxy.streamProxy(get(createToken()), drained.res);
        expect([ drained.body, drained.isEnded ]).toEqual([ "abcdef", true ]);
        expect([ drained.res.listenerCount("drain"), drained.res.listenerCount("close") ]).toEqual([ 0, 1 ]);

        safeFetch.mockResolvedValueOnce(new Response(streamOf("abc", "def"), {
            headers: { "content-type": "video/mp4" }
        }));
        const closed = fakeResponse({ isBackedUp: true });
        closed.res.on("newListener", (event: string) => {
            if (event === "drain") {
                setTimeout(() => closed.res.emit("close"));
            }
        });
        await mediaProxy.streamProxy(get(createToken()), closed.res);
        expect([ closed.body, closed.isEnded ]).toEqual([ "abc", true ]);
    });

    it("ends a response whose file breaks off midway without changing its status", async () => {
        let pulls = 0;
        safeFetch.mockResolvedValueOnce(new Response(new ReadableStream<Uint8Array>({
            pull(controller) {
                if (pulls++ === 0) {
                    controller.enqueue(new TextEncoder().encode("abc"));
                } else {
                    controller.error(new Error("connection reset"));
                }
            }
        }), { headers: { "content-type": "video/mp4" } }));
        const res = fakeResponse();

        await mediaProxy.streamProxy(get(createToken()), res.res);

        expect([ res.status, res.body, res.isEnded ]).toEqual([ 200, "abc", true ]);
    });

    it("gives up on a file that does not arrive within 30 seconds", async () => {
        vi.useFakeTimers({ toFake: [ "setTimeout", "clearTimeout" ] });
        try {
            safeFetch.mockImplementation((_url: string, { signal }: RequestInit) => new Promise((_resolve, reject) => {
                signal?.addEventListener("abort", () => reject(signal.reason));
            }));
            const res = fakeResponse();

            const streaming = mediaProxy.streamProxy(get(createToken()), res.res);
            await vi.advanceTimersByTimeAsync(29_999);
            expect(res.isEnded).toBe(false);
            await vi.advanceTimersByTimeAsync(1);
            await streaming;

            expect([ res.status, res.isEnded ]).toEqual([ 502, true ]);
        } finally {
            vi.useRealTimers();
        }
    });
});

/** The rejections that nothing handles while `run` runs. */
async function collectRejections(run: () => Promise<unknown>) {
    const rejections: unknown[] = [];
    const collect = (reason: unknown) => rejections.push(reason);
    process.on("unhandledRejection", collect);
    try {
        await run();
        await nextTask();
    } finally {
        process.off("unhandledRejection", collect);
    }
    return rejections;
}

function nextTask() {
    return new Promise((resolve) => setTimeout(resolve));
}

function createToken() {
    return mediaProxy.createProxy(post("https://example.com/clip.mp4")).url.split("/").pop() ?? "";
}

function post(url: unknown) {
    return { body: { url } } as express.Request;
}

function get(token: string, range?: string) {
    return { params: { token }, headers: range ? { range } : {} } as express.Request<{ token: string }>;
}

function streamOf(...chunks: string[]) {
    return new ReadableStream<Uint8Array>({
        start(controller) {
            for (const chunk of chunks) {
                controller.enqueue(new TextEncoder().encode(chunk));
            }
            controller.close();
        }
    });
}

/** An Express response that records what the route writes to it. */
function fakeResponse({ isBackedUp = false } = {}) {
    const emitter = new EventEmitter();
    const state = {
        status: 200,
        headers: {} as Record<string, string>,
        body: "",
        size: 0,
        isEnded: false,
        res: undefined as unknown as express.Response
    };
    // `Object.assign()` would copy the value of a getter, so `headersSent` is defined on its own.
    Object.defineProperty(emitter, "headersSent", { get: () => Object.keys(state.headers).length > 0 });
    state.res = Object.assign(emitter, {
        status(code: number) {
            state.status = code;
            return state.res;
        },
        setHeader(name: string, value: string) {
            state.headers[name.toLowerCase()] = value;
        },
        flushHeaders() {},
        write(chunk: Uint8Array) {
            state.body += new TextDecoder().decode(chunk);
            state.size += chunk.byteLength;
            return !isBackedUp;
        },
        end() {
            state.isEnded = true;
        }
    }) as unknown as express.Response;
    return state;
}
