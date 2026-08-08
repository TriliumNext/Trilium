import { afterEach, describe, expect, it, vi } from "vitest";

import { fetchDesktopDatabase, startDesktopDatabaseSync } from "./desktop_persistence.js";

const SQLITE_BYTES = new TextEncoder().encode("SQLite format 3\0trailing content");

function mockFetch(impl: (input: RequestInfo | URL, init?: RequestInit) => Promise<Response>) {
    return vi.spyOn(globalThis, "fetch").mockImplementation(impl as typeof fetch);
}

afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
});

describe("fetchDesktopDatabase", () => {
    it("reports no bridge when the request throws or returns an error status", async () => {
        mockFetch(async () => {
            throw new TypeError("network error");
        });
        expect(await fetchDesktopDatabase()).toEqual({ available: false });

        vi.restoreAllMocks();
        mockFetch(async () => new Response("nope", { status: 404 }));
        expect(await fetchDesktopDatabase()).toEqual({ available: false });
    });

    it("reports an empty bridge on 204 (present but nothing saved yet)", async () => {
        mockFetch(async () => new Response(null, { status: 204 }));
        expect(await fetchDesktopDatabase()).toEqual({ available: true, buffer: null });
    });

    it("rejects a 200 body without the SQLite magic (SPA fallback page)", async () => {
        mockFetch(async () => new Response("<!DOCTYPE html><html><body>app</body></html>"));
        expect(await fetchDesktopDatabase()).toEqual({ available: false });
    });

    it("returns the stored database bytes", async () => {
        mockFetch(async () => new Response(SQLITE_BYTES));
        const result = await fetchDesktopDatabase();
        expect(result.available).toBe(true);
        if (result.available && result.buffer) {
            expect([...result.buffer]).toEqual([...SQLITE_BYTES]);
        } else {
            expect.fail("expected a buffer");
        }
    });
});

describe("startDesktopDatabaseSync", () => {
    it("PUTs the serialized database on each interval and logs failures", async () => {
        vi.useFakeTimers();
        const requests: { method?: string; body?: unknown }[] = [];
        let status = 204;
        mockFetch(async (_input, init) => {
            requests.push({ method: init?.method, body: init?.body });
            return new Response(null, { status });
        });
        const log = vi.fn();

        startDesktopDatabaseSync(() => SQLITE_BYTES, log);
        expect(log).toHaveBeenCalledWith(expect.stringContaining("Syncing database"));

        await vi.advanceTimersByTimeAsync(15_000);
        expect(requests).toHaveLength(1);
        expect(requests[0].method).toBe("PUT");
        expect(requests[0].body).toBe(SQLITE_BYTES);

        status = 500;
        await vi.advanceTimersByTimeAsync(15_000);
        expect(requests).toHaveLength(2);
        expect(log).toHaveBeenCalledWith(expect.stringContaining("Save failed: HTTP 500"));

        // Serialization errors are logged, not thrown.
        vi.mocked(log).mockClear();
        startDesktopDatabaseSync(() => {
            throw new Error("serialize boom");
        }, log);
        await vi.advanceTimersByTimeAsync(15_000);
        expect(log).toHaveBeenCalledWith(expect.stringContaining("Save failed: Error: serialize boom"));
    });
});
