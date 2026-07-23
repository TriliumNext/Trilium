import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../safe_fetch.js", () => ({ safeFetch: vi.fn() }));

import { safeFetch } from "../../safe_fetch.js";
import { backoffDelayMs, extractGraphErrorDetail, getAccount, getPageContent, getResource, getThrottleStats, listPages, resetThrottleGate, resetThrottleStats, retryAfterMs, sanitizeGraphUrl } from "./graph.js";

const safeFetchMock = vi.mocked(safeFetch);

/** Builds a Graph HTTP response as the mocked safeFetch returns it. */
function graphResponse(status: number, body: string, headers?: Record<string, string>): Awaited<ReturnType<typeof safeFetch>> {
    return new Response(body, { status, headers }) as unknown as Awaited<ReturnType<typeof safeFetch>>;
}

/** The static token provider used by tests that don't exercise refresh. */
const token = () => Promise.resolve("token");

/** The Authorization header sent on the mocked safeFetch's `call`-th invocation. */
function sentAuth(call: number): unknown {
    return (safeFetchMock.mock.calls[call]?.[1]?.headers as Record<string, string> | undefined)?.Authorization;
}

describe("backoffDelayMs", () => {
    it("doubles the delay with each attempt", () => {
        expect(backoffDelayMs(0)).toBe(2000);
        expect(backoffDelayMs(1)).toBe(4000);
        expect(backoffDelayMs(2)).toBe(8000);
        expect(backoffDelayMs(3)).toBe(16000);
    });

    it("caps the delay at one minute", () => {
        expect(backoffDelayMs(10)).toBe(60_000);
    });
});

describe("retryAfterMs", () => {
    afterEach(() => {
        vi.useRealTimers();
    });

    it("parses a delta-seconds value", () => {
        expect(retryAfterMs("120")).toBe(120_000);
        expect(retryAfterMs("0")).toBe(0);
    });

    it("parses an HTTP-date relative to now", () => {
        vi.useFakeTimers();
        vi.setSystemTime(new Date("2026-07-21T12:00:00Z"));
        expect(retryAfterMs("Tue, 21 Jul 2026 12:01:30 GMT")).toBe(90_000);
        // A date in the past means the throttle already expired.
        expect(retryAfterMs("Tue, 21 Jul 2026 11:59:00 GMT")).toBe(0);
    });

    it("returns null for absent or malformed headers", () => {
        expect(retryAfterMs(null)).toBeNull();
        expect(retryAfterMs("")).toBeNull();
        expect(retryAfterMs("   ")).toBeNull();
        expect(retryAfterMs("soon")).toBeNull();
    });
});

describe("throttling retries", () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(0);
        resetThrottleGate();
    });

    afterEach(() => {
        resetThrottleGate();
        vi.useRealTimers();
        safeFetchMock.mockReset();
    });

    it("keeps retrying well past eight attempts while the wait budget lasts", async () => {
        let calls = 0;
        safeFetchMock.mockImplementation(async () => {
            calls++;
            return calls <= 12 ? graphResponse(429, "") : graphResponse(200, JSON.stringify({ displayName: "Ada" }));
        });

        const promise = getAccount(token);
        await vi.runAllTimersAsync();

        await expect(promise).resolves.toEqual({ name: "Ada", email: "" });
        expect(safeFetchMock).toHaveBeenCalledTimes(13);
    });

    it("waits out Graph's Retry-After header instead of the computed backoff", async () => {
        safeFetchMock
            .mockResolvedValueOnce(graphResponse(429, "", { "Retry-After": "120" }))
            .mockResolvedValueOnce(graphResponse(200, JSON.stringify({ displayName: "Ada" })));

        const promise = getAccount(token);

        // The plain exponential backoff for a first attempt is 2s; Retry-After must override it,
        // so just before the 120s mark the retry must not have fired yet.
        await vi.advanceTimersByTimeAsync(119_000);
        expect(safeFetchMock).toHaveBeenCalledTimes(1);

        await vi.advanceTimersByTimeAsync(1_000);
        await expect(promise).resolves.toEqual({ name: "Ada", email: "" });
        expect(safeFetchMock).toHaveBeenCalledTimes(2);
    });

    it("accumulates throttle statistics for the import report", async () => {
        resetThrottleStats();
        let calls = 0;
        safeFetchMock.mockImplementation(async () => {
            calls++;
            return calls <= 3 ? graphResponse(429, "", { "Retry-After": "30" }) : graphResponse(200, JSON.stringify({ displayName: "Ada" }));
        });

        const promise = getAccount(token);
        await vi.runAllTimersAsync();
        await expect(promise).resolves.toEqual({ name: "Ada", email: "" });

        // Three throttled responses, each pushing the shared gate 30s past "now" — the accumulated
        // wait reflects wall-clock time spent throttled (gate extensions), not a per-request sum.
        expect(getThrottleStats()).toEqual({ requestCount: 3, waitMs: 90_000 });

        resetThrottleStats();
        expect(getThrottleStats()).toEqual({ requestCount: 0, waitMs: 0 });
    });

    it("re-reads the access token before each attempt, so a refresh during the wait is picked up", async () => {
        // The token provider hands back whatever `current` holds at call time — modelling a refresh
        // that lands while a throttled request is waiting out its backoff.
        let current = "old-token";
        const rotating = () => Promise.resolve(current);
        safeFetchMock
            .mockResolvedValueOnce(graphResponse(429, "", { "Retry-After": "30" }))
            .mockResolvedValueOnce(graphResponse(200, JSON.stringify({ displayName: "Ada" })));

        const promise = getAccount(rotating);
        await vi.advanceTimersByTimeAsync(0);
        expect(safeFetchMock).toHaveBeenCalledTimes(1);
        expect(sentAuth(0)).toBe("Bearer old-token");

        current = "fresh-token";
        await vi.advanceTimersByTimeAsync(30_000);
        await expect(promise).resolves.toEqual({ name: "Ada", email: "" });

        // Without re-reading the provider the retry would resend the stale token and 401 forever; the
        // whole point of the fix is that the second attempt carries the refreshed one.
        expect(safeFetchMock).toHaveBeenCalledTimes(2);
        expect(sentAuth(1)).toBe("Bearer fresh-token");
    });

    it("gives up with the throttled response once the wait budget is exhausted", async () => {
        safeFetchMock.mockImplementation(async () =>
            graphResponse(429, JSON.stringify({ error: { code: "20166", message: "Too many requests" } })));

        const promise = getAccount(token).catch((e: unknown) => e);
        await vi.runAllTimersAsync();
        const error = await promise;

        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).toContain("HTTP 429: 20166: Too many requests");
        // The budget bounds total waiting: with the fake clock starting at 0, now === total waited.
        // OneNote throttle windows have been observed to last the better part of an hour for a
        // heavily-throttled user, so the budget must tolerate at least that before giving up.
        expect(Date.now()).toBeGreaterThan(30 * 60_000);
        expect(Date.now()).toBeLessThanOrEqual(60 * 60_000);
        // ...and it must be attempt-count agnostic — far more patient than the old 8-retry limit.
        expect(safeFetchMock.mock.calls.length).toBeGreaterThan(10);
    });
});

describe("gateway timeout retries", () => {
    beforeEach(() => {
        vi.useFakeTimers();
        vi.setSystemTime(0);
        resetThrottleGate();
    });

    afterEach(() => {
        resetThrottleGate();
        vi.useRealTimers();
        safeFetchMock.mockReset();
    });

    it("retries a transient 504 with backoff and succeeds", async () => {
        safeFetchMock
            .mockResolvedValueOnce(graphResponse(504, ""))
            .mockResolvedValueOnce(graphResponse(504, ""))
            .mockResolvedValueOnce(graphResponse(200, JSON.stringify({ displayName: "Ada" })));

        const promise = getAccount(token);
        await vi.runAllTimersAsync();

        await expect(promise).resolves.toEqual({ name: "Ada", email: "" });
        expect(safeFetchMock).toHaveBeenCalledTimes(3);
    });

    it("gives up on a persistent 504 after a bounded number of retries, not the hour-long throttle budget", async () => {
        // mockImplementation rather than mockResolvedValue: each retry cancels the response body, so
        // every call must produce a fresh Response for the final error to still have a readable body.
        safeFetchMock.mockImplementation(async () => graphResponse(504, JSON.stringify({
            error: { code: "UnknownError", message: "Gateway timeout." }
        })));

        const promise = getPageContent(token, "page-1").catch((e: unknown) => e);
        await vi.runAllTimersAsync();
        const error = await promise;

        expect(error).toBeInstanceOf(Error);
        expect((error as Error).message).toContain("HTTP 504: UnknownError: Gateway timeout.");
        // A page that 504s on every fetch is a documented OneNote pattern (the backend cannot render
        // that one resource); it must fail within minutes, not stall the import for the throttle
        // budget's full hour.
        expect(safeFetchMock).toHaveBeenCalledTimes(6);
        expect(Date.now()).toBeLessThan(5 * 60_000);
    });

    it("does not extend the shared throttle gate — a 504 backoff is private to its request", async () => {
        safeFetchMock
            .mockResolvedValueOnce(graphResponse(504, ""))
            .mockResolvedValueOnce(graphResponse(200, JSON.stringify({ displayName: "Ada" })));

        const first = getAccount(token);
        await vi.runAllTimersAsync();
        await expect(first).resolves.toEqual({ name: "Ada", email: "" });

        // A 504 is specific to one resource, not the app+user pool, so a follow-up request must fire
        // immediately instead of waiting out a shared gate (no timer advancement beyond a microtask
        // flush).
        safeFetchMock.mockResolvedValueOnce(graphResponse(200, JSON.stringify({ displayName: "Bob" })));
        const second = getAccount(token);
        await vi.advanceTimersByTimeAsync(0);
        await expect(second).resolves.toEqual({ name: "Bob", email: "" });
        expect(safeFetchMock).toHaveBeenCalledTimes(3);
    });
});

describe("failed Graph requests", () => {
    afterEach(() => {
        safeFetchMock.mockReset();
    });

    it("reports status, Graph error detail and the failing URL for page content", async () => {
        safeFetchMock.mockResolvedValue(graphResponse(404, JSON.stringify({
            error: { code: "20102", message: "The specified resource ID does not exist." }
        })));

        await expect(getPageContent(token, "page-1")).rejects.toThrow(
            "Failed to fetch OneNote page content (HTTP 404: 20102: The specified resource ID does not exist.) "
            + "from https://graph.microsoft.com/v1.0/me/onenote/pages/page-1/content?includeInkML=true"
        );
    });

    it("omits the detail when the body is not a Graph error envelope (resource download)", async () => {
        safeFetchMock.mockResolvedValue(graphResponse(500, "<html>Internal Server Error</html>"));

        const url = "https://graph.microsoft.com/v1.0/me/onenote/resources/res-1/$value";
        await expect(getResource(token, url)).rejects.toThrow(
            `Failed to fetch OneNote resource (HTTP 500) from ${url}`
        );
    });

    it("reports the failing URL for a plain Graph GET", async () => {
        safeFetchMock.mockResolvedValue(graphResponse(403, JSON.stringify({
            error: { code: "AccessDenied", message: "Insufficient privileges." }
        })));

        await expect(getAccount(token)).rejects.toThrow(
            "Microsoft Graph request failed (HTTP 403: AccessDenied: Insufficient privileges.) "
            + "from https://graph.microsoft.com/v1.0/me"
        );
    });

    it("names the failing @odata.nextLink, not the original URL, when a follow-up page fails", async () => {
        // 410 rather than 429/503 so graphFetch fails immediately instead of entering backoff retries.
        const nextLink = "https://graph.microsoft.com/v1.0/me/onenote/sections/sec-1/pages?$skip=20";
        safeFetchMock
            .mockResolvedValueOnce(graphResponse(200, JSON.stringify({
                value: [{ id: "p1", title: "First" }],
                "@odata.nextLink": nextLink
            })))
            .mockResolvedValueOnce(graphResponse(410, JSON.stringify({ error: { code: "Gone" } })));

        await expect(listPages(token, "sec-1")).rejects.toThrow(
            `Microsoft Graph request failed (HTTP 410: Gone) from ${nextLink}`
        );
    });

    it("still reports status and URL when the error body cannot be read", async () => {
        safeFetchMock.mockResolvedValue({
            ok: false,
            status: 502,
            text: () => Promise.reject(new Error("connection reset"))
        } as unknown as Awaited<ReturnType<typeof safeFetch>>);

        const url = "https://graph.microsoft.com/v1.0/me/onenote/resources/res-2/$value";
        await expect(getResource(token, url)).rejects.toThrow(
            `Failed to fetch OneNote resource (HTTP 502) from ${url}`
        );
    });
});

describe("sanitizeGraphUrl", () => {
    it("redacts the email in a users('...') resource URL", () => {
        expect(sanitizeGraphUrl("https://graph.microsoft.com/v1.0/users('jane.doe@outlook.com')/onenote/resources/0-abc!1-DEF!42/$value"))
            .toBe("https://graph.microsoft.com/v1.0/users('<redacted>')/onenote/resources/0-abc!1-DEF!42/$value");
    });

    it("redacts a users/{id} path segment (guid or email)", () => {
        expect(sanitizeGraphUrl("https://graph.microsoft.com/v1.0/users/8f3a-guid-1234/onenote/pages"))
            .toBe("https://graph.microsoft.com/v1.0/users/<redacted>/onenote/pages");
    });

    it("leaves URLs without an identity segment untouched", () => {
        // The importer's own calls use the /me alias, which carries no PII.
        const url = "https://graph.microsoft.com/v1.0/me/onenote/pages/1-abc/content?includeInkML=true";
        expect(sanitizeGraphUrl(url)).toBe(url);
    });

    it("redacts every occurrence and preserves the rest of the path", () => {
        expect(sanitizeGraphUrl("/users('a@b.com')/x/users('a@b.com')/y"))
            .toBe("/users('<redacted>')/x/users('<redacted>')/y");
    });
});

describe("extractGraphErrorDetail", () => {
    it("extracts code and message from Graph's error envelope", () => {
        expect(extractGraphErrorDetail(JSON.stringify({ error: { code: "20102", message: "The specified resource ID does not exist." } })))
            .toBe("20102: The specified resource ID does not exist.");
        expect(extractGraphErrorDetail(JSON.stringify({ error: { message: "Something went wrong." } }))).toBe("Something went wrong.");
        expect(extractGraphErrorDetail(JSON.stringify({ error: { code: "ItemNotFound" } }))).toBe("ItemNotFound");
    });

    it("returns an empty string for bodies that are not a Graph error envelope", () => {
        expect(extractGraphErrorDetail("")).toBe("");
        expect(extractGraphErrorDetail("<html>Not Found</html>")).toBe("");
        expect(extractGraphErrorDetail("null")).toBe("");
        expect(extractGraphErrorDetail(JSON.stringify({ unrelated: true }))).toBe("");
    });
});
