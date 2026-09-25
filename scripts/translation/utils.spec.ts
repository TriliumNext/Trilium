import { afterEach, describe, expect, it, vi } from "vitest";

import { CACHE_MAX_AGE_MS, fetchAllPages, isCacheFresh } from "./utils";

describe("isCacheFresh", () => {
    const now = new Date("2026-08-20T12:00:00Z").getTime();

    it("accepts a cache younger than the maximum age", () => {
        expect(isCacheFresh(now, now)).toBe(true);
        expect(isCacheFresh(now - 1000, now)).toBe(true);
        expect(isCacheFresh(now - CACHE_MAX_AGE_MS + 1, now)).toBe(true);
    });

    it("rejects a cache at or past the maximum age", () => {
        expect(isCacheFresh(now - CACHE_MAX_AGE_MS, now)).toBe(false);
        expect(isCacheFresh(now - 7 * CACHE_MAX_AGE_MS, now)).toBe(false);
    });

    it("rejects a cache stamped in the future", () => {
        expect(isCacheFresh(now + 1, now)).toBe(false);
        expect(isCacheFresh(now + CACHE_MAX_AGE_MS, now)).toBe(false);
    });
});

describe("fetchAllPages", () => {
    afterEach(() => vi.unstubAllGlobals());

    /** Answers each URL with a canned page, and records the order they were requested in. */
    function stubPages(pages: Record<string, unknown>) {
        const requested: string[] = [];
        vi.stubGlobal("fetch", async (url: string) => {
            requested.push(url);
            const page = pages[url];
            if (!page) return { ok: false, status: 404, statusText: "Not Found" };
            return { ok: true, json: async () => page };
        });
        return requested;
    }

    it("follows every page and merges the results in order", async () => {
        const requested = stubPages({
            "/first": { count: 3, next: "/second", results: [ "a", "b" ] },
            "/second": { count: 3, next: null, results: [ "c" ] }
        });

        const merged = await fetchAllPages("/first");
        expect(merged).toStrictEqual({ count: 3, results: [ "a", "b", "c" ] });
        expect(requested).toStrictEqual([ "/first", "/second" ]);
    });

    it("counts what it read rather than trusting the reported total", async () => {
        stubPages({ "/only": { count: 99, next: null, results: [ "a" ] } });

        expect(await fetchAllPages("/only")).toStrictEqual({ count: 1, results: [ "a" ] });
    });

    it("names the failing URL instead of failing to parse the body", async () => {
        stubPages({ "/first": { count: 2, next: "/gone", results: [ "a" ] } });

        await expect(fetchAllPages("/first"))
            .rejects.toThrow("Weblate answered 404 Not Found for /gone.");
    });
});
