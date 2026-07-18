import type { ExecOpts } from "@triliumnext/core";
import { afterEach, describe, expect, it, vi } from "vitest";

import FetchRequestProvider from "./request_provider.js";

const provider = new FetchRequestProvider();

interface FakeResponse {
    status?: number;
    ok?: boolean;
    text?: () => Promise<string>;
    arrayBuffer?: () => Promise<ArrayBuffer>;
}

function mockFetch(response: FakeResponse | Error) {
    const impl = response instanceof Error
        ? vi.fn().mockRejectedValue(response)
        : vi.fn().mockResolvedValue(response);
    return vi.spyOn(globalThis, "fetch").mockImplementation(impl as unknown as typeof fetch);
}

function lastInit(spy: ReturnType<typeof mockFetch>): RequestInit {
    return spy.mock.calls[0][1] as RequestInit;
}

afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
});

describe("FetchRequestProvider.exec", () => {
    it("sends a JSON request and parses a 200 response", async () => {
        const spy = mockFetch({ status: 200, text: async () => JSON.stringify({ value: 1 }) });

        const result = await provider.exec<{ value: number }>({ method: "GET", url: `${location.origin}/api/x` } as ExecOpts);

        expect(result).toEqual({ value: 1 });
        const init = lastInit(spy);
        const headers = init.headers as Record<string, string>;
        expect(headers["Content-Type"]).toBe("application/json");
        expect(init.credentials).toBe("include");
    });

    it("uses text/plain and paging headers for multi-page requests", async () => {
        const spy = mockFetch({ status: 200, text: async () => "" });

        await provider.exec({
            method: "POST",
            url: `${location.origin}/api/x`,
            paging: { pageCount: 3, pageIndex: 1, requestId: "req-1" }
        } as ExecOpts);

        const headers = lastInit(spy).headers as Record<string, string>;
        expect(headers["Content-Type"]).toBe("text/plain");
        expect(headers["pageCount"]).toBe("3");
        expect(headers["pageIndex"]).toBe("1");
        expect(headers["requestId"]).toBe("req-1");
    });

    it("returns null for an empty/whitespace 204 body", async () => {
        mockFetch({ status: 204, text: async () => "   " });
        const result = await provider.exec({ method: "GET", url: `${location.origin}/api/x` } as ExecOpts);
        expect(result).toBeNull();
    });

    it("adds a trilium-cred header when auth is provided", async () => {
        const spy = mockFetch({ status: 200, text: async () => "{}" });
        await provider.exec({ method: "GET", url: `${location.origin}/x`, auth: { password: "pw" } } as ExecOpts);
        const headers = lastInit(spy).headers as Record<string, string>;
        expect(headers["trilium-cred"]).toBe(btoa("dummy:pw"));
    });

    it("serializes object bodies as JSON and passes string bodies through", async () => {
        const spy = mockFetch({ status: 200, text: async () => "{}" });
        await provider.exec({ method: "POST", url: `${location.origin}/x`, body: { a: 1 } } as ExecOpts);
        expect(lastInit(spy).body).toBe(JSON.stringify({ a: 1 }));

        spy.mockClear();
        await provider.exec({ method: "POST", url: `${location.origin}/x`, body: "raw" } as ExecOpts);
        expect(lastInit(spy).body).toBe("raw");
    });

    it("throws with the JSON error message for non-2xx responses", async () => {
        mockFetch({ status: 500, text: async () => JSON.stringify({ message: "boom" }) });
        await expect(provider.exec({ method: "GET", url: `${location.origin}/x` } as ExecOpts))
            .rejects.toThrow("500 GET");
        await expect(provider.exec({ method: "GET", url: `${location.origin}/x` } as ExecOpts))
            .rejects.toThrow("boom");
    });

    it("falls back to the raw text (truncated) when the error body is not JSON", async () => {
        mockFetch({ status: 400, text: async () => "x".repeat(200) });
        await expect(provider.exec({ method: "GET", url: `${location.origin}/x` } as ExecOpts))
            .rejects.toThrow(/400 GET .*x{100}/);
    });

    it("reports a timeout when the request is aborted", async () => {
        const abortErr = Object.assign(new Error("aborted"), { name: "AbortError" });
        mockFetch(abortErr);
        await expect(provider.exec({ method: "GET", url: `${location.origin}/x`, timeout: 50 } as ExecOpts))
            .rejects.toThrow("timeout after 50ms");
    });

    it("aborts the in-flight request once the timeout elapses", async () => {
        vi.useFakeTimers();
        const abortErr = Object.assign(new Error("aborted"), { name: "AbortError" });
        vi.spyOn(globalThis, "fetch").mockImplementation((_url, init) => new Promise<Response>((_resolve, reject) => {
            (init?.signal as AbortSignal).addEventListener("abort", () => reject(abortErr));
        }));
        const promise = provider.exec({ method: "GET", url: `${location.origin}/x`, timeout: 50 } as ExecOpts);
        const rejection = expect(promise).rejects.toThrow("timeout after 50ms");
        await vi.advanceTimersByTimeAsync(50);
        await rejection;
    });

    it("throws with an empty message when the error body has no message field", async () => {
        mockFetch({ status: 500, text: async () => JSON.stringify({ code: "X" }) });
        await expect(provider.exec({ method: "GET", url: `${location.origin}/x` } as ExecOpts)).rejects.toThrow(/500 GET/);
    });

    it("gives a CORS-specific message for cross-origin fetch failures", async () => {
        mockFetch(new TypeError("Failed to fetch"));
        await expect(provider.exec({ method: "GET", url: "https://other.example.com/x" } as ExecOpts))
            .rejects.toThrow(/blocked.*CORS/);
    });

    it("gives a generic unreachable message for same-origin fetch failures", async () => {
        mockFetch(new TypeError("Failed to fetch"));
        await expect(provider.exec({ method: "GET", url: `${location.origin}/x` } as ExecOpts))
            .rejects.toThrow(/may be unreachable/);
    });

    it("rethrows unrecognized errors", async () => {
        mockFetch(new Error("something else"));
        await expect(provider.exec({ method: "GET", url: `${location.origin}/x` } as ExecOpts))
            .rejects.toThrow("something else");
    });
});

describe("FetchRequestProvider.getImage", () => {
    it("returns the image bytes for a successful response", async () => {
        const buf = new Uint8Array([1, 2, 3]).buffer;
        mockFetch({ ok: true, status: 200, arrayBuffer: async () => buf });
        const result = await provider.getImage(`${location.origin}/img.png`);
        expect(result).toBe(buf);
    });

    it("throws when the image response is not ok", async () => {
        mockFetch({ ok: false, status: 404, arrayBuffer: async () => new ArrayBuffer(0) });
        await expect(provider.getImage(`${location.origin}/missing.png`)).rejects.toThrow("404 GET");
    });
});
