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
});

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
function fakeResponse() {
    const emitter = new EventEmitter();
    const state = {
        status: 200,
        headers: {} as Record<string, string>,
        body: "",
        isEnded: false,
        res: undefined as unknown as express.Response
    };
    state.res = Object.assign(emitter, {
        get headersSent() {
            return Object.keys(state.headers).length > 0;
        },
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
            return true;
        },
        end() {
            state.isEnded = true;
        }
    }) as unknown as express.Response;
    return state;
}
