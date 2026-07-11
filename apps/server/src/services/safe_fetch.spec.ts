import dns from "node:dns";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

interface MockAgent {
    options: { connect?: { lookup?: unknown } };
    closed: boolean;
    close(): void;
}

const { agentInstances, MockAgent } = vi.hoisted(() => {
    const agentInstances: MockAgent[] = [];

    class MockAgent {
        options: { connect?: { lookup?: unknown } };
        closed = false;

        constructor(options: { connect?: { lookup?: unknown } } = {}) {
            this.options = options;
            agentInstances.push(this);
        }

        close() {
            this.closed = true;
        }
    }

    return { agentInstances, MockAgent };
});

vi.mock("undici", () => ({ Agent: MockAgent }));

import { safeFetch, validateHostResolution, validateUrl } from "./safe_fetch.js";

describe("validateUrl", () => {
    it("accepts http URLs", () => {
        const result = validateUrl("http://example.com");
        expect(result.hostname).toBe("example.com");
    });

    it("accepts https URLs", () => {
        const result = validateUrl("https://example.com/path?q=1");
        expect(result.hostname).toBe("example.com");
    });

    it("rejects non-http protocols", () => {
        expect(() => validateUrl("ftp://example.com")).toThrow("Only http and https");
        expect(() => validateUrl("file:///etc/passwd")).toThrow("Only http and https");
        expect(() => validateUrl("javascript:alert(1)")).toThrow("Only http and https");
    });

    it("rejects invalid URLs", () => {
        expect(() => validateUrl("not-a-url")).toThrow("Invalid URL");
        expect(() => validateUrl("")).toThrow("Invalid URL");
    });
});

describe("validateHostResolution", () => {
    it("rejects private IPv4 literals", async () => {
        await expect(validateHostResolution("127.0.0.1")).rejects.toThrow("private/internal");
        await expect(validateHostResolution("10.0.0.1")).rejects.toThrow("private/internal");
        await expect(validateHostResolution("192.168.1.1")).rejects.toThrow("private/internal");
        await expect(validateHostResolution("172.16.0.1")).rejects.toThrow("private/internal");
        await expect(validateHostResolution("169.254.1.1")).rejects.toThrow("private/internal");
        await expect(validateHostResolution("0.0.0.0")).rejects.toThrow("private/internal");
    });

    it("rejects private IPv6 literals", async () => {
        await expect(validateHostResolution("::1")).rejects.toThrow("private/internal");
        await expect(validateHostResolution("fc00::1")).rejects.toThrow("private/internal");
        await expect(validateHostResolution("fd12::1")).rejects.toThrow("private/internal");
        await expect(validateHostResolution("fe80::1")).rejects.toThrow("private/internal");
    });

    it("allows public IP literals and returns validated addresses", async () => {
        await expect(validateHostResolution("8.8.8.8")).resolves.toEqual([{ address: "8.8.8.8", family: 4 }]);
        await expect(validateHostResolution("1.1.1.1")).resolves.toEqual([{ address: "1.1.1.1", family: 4 }]);
    });

    it("handles IPv4-mapped IPv6 literals by checking the embedded IPv4", async () => {
        // public mapped address is allowed
        await expect(validateHostResolution("::ffff:8.8.8.8")).resolves.toEqual([
            { address: "::ffff:8.8.8.8", family: 6 }
        ]);
        // private mapped address is blocked
        await expect(validateHostResolution("::ffff:10.0.0.1")).rejects.toThrow("private/internal");
    });

    it("treats an unparseable resolved address as blocked", async () => {
        vi.spyOn(dns.promises, "lookup").mockResolvedValueOnce([
            { address: "not-an-ip", family: 4 }
        ] as unknown as dns.LookupAddress);

        await expect(validateHostResolution("garbage.example.com")).rejects.toThrow("private/internal");
    });

    it("rejects hostnames that resolve to private IPs (DNS rebinding)", async () => {
        vi.spyOn(dns.promises, "lookup").mockResolvedValueOnce([
            { address: "127.0.0.1", family: 4 }
        ] as unknown as dns.LookupAddress);

        await expect(validateHostResolution("evil.example.com")).rejects.toThrow("private/internal");
    });

    it("rejects hostnames where any resolved address is private", async () => {
        vi.spyOn(dns.promises, "lookup").mockResolvedValueOnce([
            { address: "93.184.216.34", family: 4 },
            { address: "10.0.0.1", family: 4 }
        ] as unknown as dns.LookupAddress);

        await expect(validateHostResolution("dual.example.com")).rejects.toThrow("private/internal");
    });

    it("allows hostnames that resolve to public IPs and returns addresses", async () => {
        vi.spyOn(dns.promises, "lookup").mockResolvedValueOnce([
            { address: "93.184.216.34", family: 4 }
        ] as unknown as dns.LookupAddress);

        await expect(validateHostResolution("example.com")).resolves.toEqual([
            { address: "93.184.216.34", family: 4 }
        ]);
    });

    it("rejects hostnames that fail to resolve", async () => {
        vi.spyOn(dns.promises, "lookup").mockRejectedValueOnce(new Error("ENOTFOUND"));

        await expect(validateHostResolution("nonexistent.invalid")).rejects.toThrow("Could not resolve hostname");
    });
});

describe("safeFetch", () => {
    let fetchMock: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        agentInstances.length = 0;
        fetchMock = vi.fn();
        vi.stubGlobal("fetch", fetchMock);
        // DNS literal so no actual DNS lookup is attempted.
    });

    afterEach(() => {
        vi.unstubAllGlobals();
        vi.restoreAllMocks();
    });

    function makeResponse(body: ReadableStream | null, init: ResponseInit) {
        // Construct a plain object that quacks like the parts safeFetch reads.
        return {
            status: init.status ?? 200,
            statusText: init.statusText ?? "OK",
            headers: new Headers(init.headers),
            body
        } as unknown as Response;
    }

    function streamFrom(chunks: Uint8Array[]): ReadableStream {
        let i = 0;
        return new ReadableStream({
            pull(controller) {
                if (i < chunks.length) {
                    controller.enqueue(chunks[i++]);
                } else {
                    controller.close();
                }
            }
        });
    }

    it("fetches a public IP, pins DNS, and cleans up the dispatcher after the body is read", async () => {
        const payload = new TextEncoder().encode("hello");
        fetchMock.mockResolvedValueOnce(makeResponse(streamFrom([payload]), { status: 200 }));

        const response = await safeFetch("http://8.8.8.8/data");

        // The custom dispatcher was passed to fetch.
        const fetchOptions = fetchMock.mock.calls[0][1] as { dispatcher: MockAgent; redirect: string; signal: unknown };
        expect(fetchOptions.redirect).toBe("manual");
        expect(fetchOptions.signal).toBeDefined();
        expect(agentInstances).toHaveLength(1);
        expect(fetchOptions.dispatcher).toBe(agentInstances[0]);

        // Drain the wrapped body; this should close the dispatcher exactly once.
        const text = await new Response(response.body).text();
        expect(text).toBe("hello");
        expect(agentInstances[0].closed).toBe(true);
    });

    it("closes the dispatcher immediately when the response has no body", async () => {
        fetchMock.mockResolvedValueOnce(makeResponse(null, { status: 204 }));

        const response = await safeFetch("http://8.8.8.8/empty");
        expect(response.status).toBe(204);
        expect(agentInstances[0].closed).toBe(true);
    });

    it("cancels the wrapped body and closes the dispatcher", async () => {
        fetchMock.mockResolvedValueOnce(
            makeResponse(streamFrom([new TextEncoder().encode("data")]), { status: 200 })
        );

        const response = await safeFetch("http://8.8.8.8/cancel");
        await response.body!.cancel();
        expect(agentInstances[0].closed).toBe(true);
    });

    it("propagates a body read error to the consumer and closes the dispatcher", async () => {
        const erroringStream = new ReadableStream({
            pull() {
                throw new Error("boom");
            }
        });
        fetchMock.mockResolvedValueOnce(makeResponse(erroringStream, { status: 200 }));

        const response = await safeFetch("http://8.8.8.8/err");
        await expect(new Response(response.body).text()).rejects.toThrow("boom");
        expect(agentInstances[0].closed).toBe(true);
    });

    it("follows redirects (resolving relative locations) and closes intermediate dispatchers", async () => {
        fetchMock
            .mockResolvedValueOnce(makeResponse(null, { status: 302, headers: { location: "/next" } }))
            .mockResolvedValueOnce(makeResponse(streamFrom([new TextEncoder().encode("final")]), { status: 200 }));

        const response = await safeFetch("http://8.8.8.8/start");

        expect(fetchMock).toHaveBeenCalledTimes(2);
        // Relative redirect resolved against the original URL.
        expect(fetchMock.mock.calls[1][0]).toBe("http://8.8.8.8/next");
        // First (redirect) dispatcher was closed before following.
        expect(agentInstances[0].closed).toBe(true);

        const text = await new Response(response.body).text();
        expect(text).toBe("final");
    });

    it("re-validates redirect targets and blocks a redirect to a private host", async () => {
        // A public host that 302s to an internal IP — the classic SSRF redirect.
        fetchMock.mockResolvedValueOnce(
            makeResponse(null, { status: 302, headers: { location: "http://10.0.0.1/evil" } })
        );

        await expect(safeFetch("http://8.8.8.8/start")).rejects.toThrow("private/internal");
        // The private redirect target must never be fetched (validation runs first).
        expect(fetchMock).toHaveBeenCalledTimes(1);
        // The first (public) dispatcher was closed before following the redirect.
        expect(agentInstances[0].closed).toBe(true);
    });

    it("throws when a redirect response has no Location header", async () => {
        fetchMock.mockResolvedValueOnce(makeResponse(null, { status: 301 }));

        await expect(safeFetch("http://8.8.8.8/noloc")).rejects.toThrow("Redirect without Location header");
    });

    it("throws after exceeding the maximum number of redirects", async () => {
        fetchMock.mockResolvedValue(makeResponse(null, { status: 302, headers: { location: "/loop" } }));

        await expect(safeFetch("http://8.8.8.8/loop")).rejects.toThrow("Too many redirects");
    });

    it("uses a caller-provided abort signal when present", async () => {
        const controller = new AbortController();
        fetchMock.mockResolvedValueOnce(makeResponse(null, { status: 200 }));

        await safeFetch("http://8.8.8.8/signal", { signal: controller.signal });
        const fetchOptions = fetchMock.mock.calls[0][1] as { signal: unknown };
        expect(fetchOptions.signal).toBe(controller.signal);
    });

    describe("pinned DNS lookup", () => {
        function getPinnedLookup() {
            return (agentInstances[0].options.connect as { lookup: Function }).lookup;
        }

        beforeEach(() => {
            // Two validated addresses: one IPv4, one IPv6.
            vi.spyOn(dns.promises, "lookup").mockResolvedValue([
                { address: "93.184.216.34", family: 4 },
                { address: "2606:2800:220:1:248:1893:25c8:1946", family: 6 }
            ] as unknown as dns.LookupAddress);
            fetchMock.mockResolvedValueOnce(makeResponse(null, { status: 200 }));
        });

        it("returns all addresses when options.all is set", async () => {
            await safeFetch("http://example.com/");
            const lookup = getPinnedLookup();
            const cb = vi.fn();
            lookup("example.com", { all: true }, cb);
            expect(cb).toHaveBeenCalledWith(null, [
                { address: "93.184.216.34", family: 4 },
                { address: "2606:2800:220:1:248:1893:25c8:1946", family: 6 }
            ]);
        });

        it("returns a single address when options.all is not set", async () => {
            await safeFetch("http://example.com/");
            const lookup = getPinnedLookup();
            const cb = vi.fn();
            lookup("example.com", {}, cb);
            expect(cb).toHaveBeenCalledWith(null, "93.184.216.34", 4);
        });

        it("filters by requested address family (numeric options form)", async () => {
            await safeFetch("http://example.com/");
            const lookup = getPinnedLookup();
            const cb = vi.fn();
            // numeric options => family 6
            lookup("example.com", 6, cb);
            expect(cb).toHaveBeenCalledWith(null, "2606:2800:220:1:248:1893:25c8:1946", 6);
        });

        it("errors when no validated address matches the requested family", async () => {
            // Only an IPv4 address is validated; request the IPv6 family.
            vi.spyOn(dns.promises, "lookup").mockResolvedValue([
                { address: "93.184.216.34", family: 4 }
            ] as unknown as dns.LookupAddress);

            await safeFetch("http://example.com/");
            const lookup = getPinnedLookup();
            const cb = vi.fn();
            lookup("example.com", { family: 6 }, cb);
            const err = cb.mock.calls[0][0] as Error;
            expect(err).toBeInstanceOf(Error);
            expect(err.message).toMatch(/No validated addresses/);
        });
    });
});
