import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../safe_fetch.js", () => ({ safeFetch: vi.fn() }));

import { safeFetch } from "../../safe_fetch.js";
import { backoffDelayMs, ENCRYPTED_SECTION_ERROR_CODE, extractGraphErrorDetail, getAccount, getPageContent, getResource, getThrottleStats, GraphRequestError, isEncryptedSectionError, listNotebooks, listPages, parsePageContent, resetThrottleGate, resetThrottleStats, retryAfterMs, sanitizeGraphUrl, setThrottleListener } from "./graph.js";

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
        setThrottleListener(null);
        vi.useRealTimers();
        safeFetchMock.mockReset();
    });

    it("notifies the registered throttle listener on each gate extension, and stops once cleared", async () => {
        const listener = vi.fn();
        setThrottleListener(listener);
        let calls = 0;
        safeFetchMock.mockImplementation(async () => {
            calls++;
            return calls <= 2 ? graphResponse(429, "", { "Retry-After": "30" }) : graphResponse(200, JSON.stringify({ displayName: "Ada" }));
        });

        const promise = getAccount(token);
        await vi.runAllTimersAsync();
        await expect(promise).resolves.toEqual({ name: "Ada", email: "" });

        // One notification per throttled response, carrying the wait pushed onto the shared gate —
        // this is what lets the importer flip its progress toast to "waiting out rate limiting".
        expect(listener).toHaveBeenCalledTimes(2);
        expect(listener).toHaveBeenCalledWith(30_000);

        // After clearing (the importer does this when its run ends), later throttling must not reach
        // the stale listener.
        setThrottleListener(null);
        calls = 0;
        safeFetchMock.mockClear();
        const second = getAccount(token);
        await vi.runAllTimersAsync();
        await second;
        expect(listener).toHaveBeenCalledTimes(2);
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

describe("successful Graph reads", () => {
    afterEach(() => {
        safeFetchMock.mockReset();
    });

    /** Answers each requested URL from `routes`, failing the test on an unexpected request. */
    function serve(routes: Record<string, unknown>) {
        safeFetchMock.mockImplementation(async (url) => {
            const key = String(url);
            if (!(key in routes)) {
                throw new Error(`Unexpected Graph request: ${key}`);
            }
            return graphResponse(200, JSON.stringify(routes[key]));
        });
    }

    it("falls back to the user principal name, then to placeholders, for the account", async () => {
        serve({ "https://graph.microsoft.com/v1.0/me": { displayName: "Ada", mail: "ada@example.com", userPrincipalName: "ada@corp" } });
        await expect(getAccount(token)).resolves.toEqual({ name: "Ada", email: "ada@example.com" });

        serve({ "https://graph.microsoft.com/v1.0/me": { userPrincipalName: "ada@corp" } });
        await expect(getAccount(token)).resolves.toEqual({ name: "ada@corp", email: "ada@corp" });

        serve({ "https://graph.microsoft.com/v1.0/me": {} });
        await expect(getAccount(token)).resolves.toEqual({ name: "Unknown", email: "" });
    });

    it("builds the notebook tree, following section groups and pagination only where they exist", async () => {
        const notebooksUrl = "https://graph.microsoft.com/v1.0/me/onenote/notebooks?$select=id,displayName,createdDateTime,lastModifiedDateTime,sectionGroupsUrl&$expand=sections($select=id,displayName,createdDateTime,lastModifiedDateTime),sectionGroups($select=id)&$orderby=displayName";
        const groupQuery = "$select=id,displayName,createdDateTime,lastModifiedDateTime,sectionGroupsUrl&$expand=sections($select=id,displayName,createdDateTime,lastModifiedDateTime),sectionGroups($select=id)";
        const nb1Groups = "https://graph.microsoft.com/v1.0/me/onenote/notebooks/nb1/sectionGroups";
        const nestedGroups = "https://graph.microsoft.com/v1.0/me/onenote/sectionGroups/g1/sectionGroups?$top=50";
        serve({
            [notebooksUrl]: {
                value: [
                    {
                        id: "nb1",
                        displayName: "Work",
                        createdDateTime: "2020-01-01T00:00:00Z",
                        lastModifiedDateTime: "2021-01-01T00:00:00Z",
                        sectionGroupsUrl: nb1Groups,
                        sections: [{ id: "s1", displayName: "Inbox", createdDateTime: "2020-02-01T00:00:00Z" }],
                        sectionGroups: [{ id: "g1" }]
                    },
                    // Lists a section group but carries no URL to follow it by.
                    { id: "nb2", displayName: "Orphan", sectionGroups: [{ id: "gx" }] }
                ],
                "@odata.nextLink": "https://graph.microsoft.com/v1.0/me/onenote/notebooks?$skiptoken=2"
            },
            "https://graph.microsoft.com/v1.0/me/onenote/notebooks?$skiptoken=2": {
                value: [{ id: "nb3", displayName: "Empty", sections: [], sectionGroups: [] }]
            },
            [`${nb1Groups}?${groupQuery}`]: {
                value: [{ id: "g1", displayName: "Projects", sectionGroupsUrl: nestedGroups, sections: [{ id: "s2", displayName: "Alpha" }], sectionGroups: [{ id: "g2" }] }]
            },
            [`${nestedGroups}&${groupQuery}`]: {
                value: [{ id: "g2", displayName: "Archive" }]
            }
        });

        const notebooks = await listNotebooks(token);

        expect(notebooks).toEqual([
            {
                id: "nb1",
                title: "Work",
                createdDateTime: "2020-01-01T00:00:00Z",
                lastModifiedDateTime: "2021-01-01T00:00:00Z",
                sections: [{ id: "s1", title: "Inbox", createdDateTime: "2020-02-01T00:00:00Z", lastModifiedDateTime: undefined }],
                sectionGroups: [{
                    id: "g1",
                    title: "Projects",
                    createdDateTime: undefined,
                    lastModifiedDateTime: undefined,
                    sections: [{ id: "s2", title: "Alpha", createdDateTime: undefined, lastModifiedDateTime: undefined }],
                    sectionGroups: [{ id: "g2", title: "Archive", createdDateTime: undefined, lastModifiedDateTime: undefined, sections: [], sectionGroups: [] }]
                }]
            },
            { id: "nb2", title: "Orphan", createdDateTime: undefined, lastModifiedDateTime: undefined, sections: [], sectionGroups: [] },
            { id: "nb3", title: "Empty", createdDateTime: undefined, lastModifiedDateTime: undefined, sections: [], sectionGroups: [] }
        ]);
        // Two notebook pages plus one request per section-group level; nb2 and nb3 cost nothing extra.
        expect(safeFetchMock).toHaveBeenCalledTimes(4);
    });

    it("maps pages with title, level and page-id fallbacks, tolerating a page without a value array", async () => {
        const pagesUrl = "https://graph.microsoft.com/v1.0/me/onenote/sections/sec-1/pages?$select=id,title,createdDateTime,lastModifiedDateTime,level,links&$orderby=order&pagelevel=true";
        serve({
            [pagesUrl]: {
                value: [
                    { id: "p1", title: "First", level: 1, createdDateTime: "2020-01-01T00:00:00Z", links: { oneNoteClientUrl: { href: "onenote:https://x/a.one#First&page-id={EB2C4F67-8D3F-4FDB-A93B-32D6B3BA780D}&end" } } },
                    { id: "p2", title: "", links: {} }
                ],
                "@odata.nextLink": "https://graph.microsoft.com/v1.0/next"
            },
            "https://graph.microsoft.com/v1.0/next": {}
        });

        await expect(listPages(token, "sec-1")).resolves.toEqual([
            { id: "p1", title: "First", level: 1, createdDateTime: "2020-01-01T00:00:00Z", lastModifiedDateTime: undefined, pageId: "eb2c4f67-8d3f-4fdb-a93b-32d6b3ba780d" },
            { id: "p2", title: "Untitled", level: 0, createdDateTime: undefined, lastModifiedDateTime: undefined, pageId: undefined }
        ]);
    });

    it("returns page content split into HTML and InkML", async () => {
        safeFetchMock.mockResolvedValue(graphResponse(200, "  <html><body><p>Plain</p></body></html>\n"));

        await expect(getPageContent(token, "page-1")).resolves.toEqual({ html: "<html><body><p>Plain</p></body></html>", inkml: "" });
        expect(safeFetchMock.mock.calls[0]?.[0]).toBe("https://graph.microsoft.com/v1.0/me/onenote/pages/page-1/content?includeInkML=true");
    });

    it("downloads a resource with its content type, defaulting to octet-stream when none is sent", async () => {
        const url = "https://graph.microsoft.com/v1.0/users('jane@example.com')/onenote/resources/res-1/$value";
        safeFetchMock.mockResolvedValueOnce(graphResponse(200, "PNGDATA", { "Content-Type": "image/png" }));
        const image = await getResource(token, url);
        expect(image.contentType).toBe("image/png");
        expect(new TextDecoder().decode(image.content)).toBe("PNGDATA");

        safeFetchMock.mockResolvedValueOnce(new Response(new Uint8Array([1, 2, 3]), { status: 200 }) as unknown as Awaited<ReturnType<typeof safeFetch>>);
        const file = await getResource(token, url);
        expect(file).toEqual({ content: new Uint8Array([1, 2, 3]), contentType: "application/octet-stream" });
    });
});

describe("parsePageContent", () => {
    it("ignores multipart parts that are neither HTML nor InkML, and parts without headers", () => {
        const raw = [
            "--boundary",
            "Content-Type: text/html",
            "",
            "<p>Body</p>",
            "--boundary",
            "Content-Type: image/png",
            "",
            "binary",
            "--boundary",
            "Content-Type: application/inkml+xml",
            "",
            "<ink/>",
            "--boundary--"
        ].join("\r\n");

        expect(parsePageContent(raw)).toEqual({ html: "<p>Body</p>", inkml: "<ink/>" });
    });
});

describe("isEncryptedSectionError", () => {
    afterEach(() => safeFetchMock.mockReset());

    it("is true only for a 403 with the encrypted-section code", () => {
        expect(isEncryptedSectionError(new GraphRequestError("msg", 403, ENCRYPTED_SECTION_ERROR_CODE))).toBe(true);
        // Wrong status, wrong code, or a plain error must not be mistaken for a protected section.
        expect(isEncryptedSectionError(new GraphRequestError("msg", 404, ENCRYPTED_SECTION_ERROR_CODE))).toBe(false);
        expect(isEncryptedSectionError(new GraphRequestError("msg", 403, "40003"))).toBe(false);
        expect(isEncryptedSectionError(new GraphRequestError("msg", 403))).toBe(false);
        expect(isEncryptedSectionError(new Error("HTTP 403: 20185"))).toBe(false);
    });

    it("makes a protected section detectable end to end: listPages throws a matching GraphRequestError", async () => {
        safeFetchMock.mockResolvedValue(graphResponse(403, JSON.stringify({
            error: { code: ENCRYPTED_SECTION_ERROR_CODE, message: "Encrypted sections are not accessible." }
        })));

        const error = await listPages(token, "sec-locked").catch((e: unknown) => e);
        expect(error).toBeInstanceOf(GraphRequestError);
        expect(isEncryptedSectionError(error)).toBe(true);
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
