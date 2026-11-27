import dns from "node:dns";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

interface MockAgent {
    options: { connect?: { lookup?: unknown } };
    closed: boolean;
    destroyed: boolean;
    close(): void;
    destroy(): Promise<void>;
}

const { agentInstances, MockAgent, undiciFetch } = vi.hoisted(() => {
    const agentInstances: MockAgent[] = [];

    class MockAgent {
        options: { connect?: { lookup?: unknown } };
        closed = false;
        destroyed = false;

        constructor(options: { connect?: { lookup?: unknown } } = {}) {
            this.options = options;
            agentInstances.push(this);
        }

        close() {
            this.closed = true;
        }

        destroy() {
            this.destroyed = true;
            return Promise.resolve();
        }
    }

    return { agentInstances, MockAgent, undiciFetch: vi.fn() };
});

// safeFetch calls undici's own `fetch` (not the global one) so that it and the `Agent` it passes as
// a dispatcher come from the same undici copy — see the comment in safe_fetch.ts. undici is
// CommonJS, so the mock carries the names under `default` as well: that is the only shape a bundled
// ESM build can expose, and safe_fetch reads it first.
vi.mock("undici", () => ({
    default: { Agent: MockAgent, fetch: undiciFetch },
    Agent: MockAgent,
    fetch: undiciFetch
}));

import { ValidationError } from "@triliumnext/core";

import {
    type LocalRanges, safeFetch, SafeFetchRefusal, validateHostResolution, validateUrl
} from "./safe_fetch.js";

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

    it("rejects URLs carrying credentials, which must not reach the wire, the note or the log", () => {
        expect(() => validateUrl("https://user:secret@example.com/page")).toThrow("credentials");
        expect(() => validateUrl("https://user@example.com/page")).toThrow("credentials");
        expect(() => validateUrl("http://:secret@example.com/page")).toThrow("credentials");
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

    it("reads an IPv6 literal still wrapped in the brackets URL.hostname leaves on it", async () => {
        const lookup = vi.spyOn(dns.promises, "lookup");

        await expect(validateHostResolution("[::1]")).rejects.toThrow("private/internal");
        await expect(validateHostResolution("[fe80::1]")).rejects.toThrow("private/internal");
        await expect(validateHostResolution("[2606:4700:4700::1111]")).resolves.toEqual([
            { address: "2606:4700:4700::1111", family: 6 }
        ]);
        // Recognised as an address, so never taken for a name and looked up as one.
        expect(lookup).not.toHaveBeenCalled();
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

describe("validateHostResolution, for a destination the operator configured", () => {
    it("allows the addresses a local service is actually served on", async () => {
        // Where Ollama and LM Studio answer out of the box, and where either sits when it has been
        // put on another machine. A rule that refused these would leave the local providers with
        // nothing to talk to, which is the whole reason this policy exists.
        await expect(validateHostResolution("127.0.0.1", true)).resolves.toEqual([{ address: "127.0.0.1", family: 4 }]);
        await expect(validateHostResolution("::1", true)).resolves.toEqual([{ address: "::1", family: 6 }]);
        await expect(validateHostResolution("10.0.0.1", true)).resolves.toEqual([{ address: "10.0.0.1", family: 4 }]);
        await expect(validateHostResolution("192.168.1.50", true)).resolves.toEqual([{ address: "192.168.1.50", family: 4 }]);
        await expect(validateHostResolution("172.16.0.1", true)).resolves.toEqual([{ address: "172.16.0.1", family: 4 }]);
        await expect(validateHostResolution("fd12::1", true)).resolves.toEqual([{ address: "fd12::1", family: 6 }]);
    });

    it("allows a Tailscale node, whose address is carrier-grade NAT", async () => {
        vi.spyOn(dns.promises, "lookup")
            .mockResolvedValueOnce([{ address: "100.83.121.222", family: 4 }] as unknown as dns.LookupAddress);

        await expect(validateHostResolution("100.64.0.1", true)).resolves.toEqual([{ address: "100.64.0.1", family: 4 }]);
        await expect(validateHostResolution("::ffff:100.83.121.222", true)).resolves.toEqual([
            { address: "::ffff:100.83.121.222", family: 6 }
        ]);
        await expect(validateHostResolution("ollama.tail1234.ts.net", true)).resolves.toEqual([
            { address: "100.83.121.222", family: 4 }
        ]);
        await expect(validateHostResolution("100.64.0.1")).rejects.toThrow("private/internal");
    });

    it("still refuses the ranges no service is served on and a metadata endpoint answers", async () => {
        // The reason the widening is a widening rather than a switch to no checking at all.
        await expect(validateHostResolution("169.254.169.254", true)).rejects.toThrow("link-local");
        await expect(validateHostResolution("169.254.1.1", true)).rejects.toThrow("link-local");
        await expect(validateHostResolution("100.100.100.200", true)).rejects.toThrow("metadata endpoint");
        await expect(validateHostResolution("::ffff:100.100.100.200", true)).rejects.toThrow("metadata endpoint");
        await expect(validateHostResolution("fd00:ec2::254", true)).rejects.toThrow("metadata endpoint");
        await expect(validateHostResolution("FD00:0EC2:0:0:0:0:0:0254", true)).rejects.toThrow("metadata endpoint");
        await expect(validateHostResolution("fe80::1", true)).rejects.toThrow("link-local");
        await expect(validateHostResolution("0.0.0.0", true)).rejects.toThrow("link-local");
        await expect(validateHostResolution("224.0.0.1", true)).rejects.toThrow("link-local");
        await expect(validateHostResolution("255.255.255.255", true)).rejects.toThrow("link-local");
    });

    it("refuses a name that resolves to one of them, and one that hides it behind a second address", async () => {
        vi.spyOn(dns.promises, "lookup")
            .mockResolvedValueOnce([{ address: "169.254.169.254", family: 4 }] as unknown as dns.LookupAddress)
            .mockResolvedValueOnce([
                { address: "93.184.216.34", family: 4 },
                { address: "169.254.169.254", family: 4 }
            ] as unknown as dns.LookupAddress);

        await expect(validateHostResolution("metadata.example.com", true)).rejects.toThrow("link-local");
        await expect(validateHostResolution("dual.example.com", true)).rejects.toThrow("link-local");
    });

    it("says which rule refused the address, since one of them permits private ones", async () => {
        // A caller told its private addresses are refused, when it is the caller that allows them,
        // would be sent looking for the wrong thing entirely.
        await expect(validateHostResolution("10.0.0.1")).rejects.toThrow("private/internal");

        const error: Error = await validateHostResolution("169.254.169.254", true).then(() => new Error("resolved"), e => e);
        expect(error.message).not.toContain("private/internal");
    });
});

describe("safeFetch", () => {
    let fetchMock: ReturnType<typeof vi.fn>;

    beforeEach(() => {
        agentInstances.length = 0;
        fetchMock = undiciFetch;
        fetchMock.mockReset();
        // DNS literal so no actual DNS lookup is attempted.
    });

    afterEach(() => {
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

    it("cancels the wrapped body of an aborted request without a stray rejection", async () => {
        let source: ReadableStreamDefaultController<Uint8Array> | undefined;
        const body = new ReadableStream<Uint8Array>({
            start(controller) {
                source = controller;
                controller.enqueue(new TextEncoder().encode("data"));
            }
        });
        fetchMock.mockResolvedValueOnce(makeResponse(body, { status: 200 }));
        const response = await safeFetch("http://8.8.8.8/aborted");

        const rejections: unknown[] = [];
        const collect = (reason: unknown) => rejections.push(reason);
        process.on("unhandledRejection", collect);
        try {
            // The wrapper reads ahead; undici then errors the body of the aborted request.
            await nextTask();
            source?.error(new DOMException("This operation was aborted", "AbortError"));
            await response.body?.cancel();
            await nextTask();
        } finally {
            process.off("unhandledRejection", collect);
        }

        expect(rejections).toEqual([]);
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

    it("refuses a redirect outright for a caller that follows none, without fetching the target", async () => {
        // The hop would be re-vetted as an address, but the request's own `Authorization` header
        // would travel with it — which for a configured API endpoint means handing the user's key
        // to whoever the base URL named. A caller carrying a credential follows no redirects.
        fetchMock.mockResolvedValueOnce(
            makeResponse(null, { status: 302, headers: { location: "https://8.8.4.4/collect" } })
        );

        const refusal = await safeFetch("https://8.8.8.8/v1/chat", {}, { maxRedirects: 0 })
            .then(() => null, (e: unknown) => e);
        expect(refusal).toBeInstanceOf(SafeFetchRefusal);
        expect(refusal).toBeInstanceOf(ValidationError);
        expect(refusal).toMatchObject({
            reason: "redirect", message: expect.stringContaining("Refusing to follow a redirect")
        });
        expect(fetchMock).toHaveBeenCalledTimes(1);
        // The body of the redirect is never read, so its connection is closed at once.
        expect(agentInstances[0].destroyed).toBe(true);
    });

    it("closes the connection of a request that fails or is aborted, and throws on", async () => {
        const abort = new DOMException("This operation was aborted", "AbortError");
        fetchMock.mockRejectedValueOnce(abort);

        await expect(safeFetch("https://8.8.8.8/hook", { signal: AbortSignal.abort() }))
            .rejects.toBe(abort);
        expect(agentInstances[0].destroyed).toBe(true);
    });

    it("imposes no deadline of its own on a caller that asked for none", async () => {
        // A completion runs for as long as the model takes, and the five seconds a link preview is
        // worth waiting would cut one off mid-answer.
        fetchMock.mockResolvedValueOnce(makeResponse(null, { status: 200 }));

        await safeFetch("http://8.8.8.8/v1/chat", {}, { timeoutMs: null });

        const fetchOptions = fetchMock.mock.calls[0][1] as { signal: unknown };
        expect(fetchOptions.signal).toBeUndefined();
    });

    it("reaches a loopback endpoint when the caller permits private addresses, and not otherwise", async () => {
        fetchMock.mockResolvedValue(makeResponse(null, { status: 200 }));

        await expect(safeFetch("http://127.0.0.1:11434/v1/models", {}, { allowPrivateNetwork: true }))
            .resolves.toBeDefined();
        await expect(safeFetch("http://127.0.0.1:11434/v1/models")).rejects.toThrow("private/internal");
    });

    it("uses a caller-provided abort signal when present", async () => {
        const controller = new AbortController();
        fetchMock.mockResolvedValueOnce(makeResponse(null, { status: 200 }));

        await safeFetch("http://8.8.8.8/signal", { signal: controller.signal });
        const fetchOptions = fetchMock.mock.calls[0][1] as { signal: unknown };
        expect(fetchOptions.signal).toBe(controller.signal);
    });

    describe("for a destination that the user configured, each local range on its own", () => {
        const PUBLIC_ONLY: LocalRanges = { allowPrivate: false, allowLoopback: false };
        const PRIVATE: LocalRanges = { allowPrivate: true, allowLoopback: false };
        const LOOPBACK: LocalRanges = { allowPrivate: false, allowLoopback: true };

        beforeEach(() => fetchMock.mockResolvedValue(makeResponse(null, { status: 204 })));

        async function refusalOf(url: string, localRanges: LocalRanges) {
            return await safeFetch(url, {}, { localRanges, isPlainHttpLocalOnly: true })
                .then(() => null, (e: unknown) => e);
        }

        it("allows private networks and loopback apart, never a metadata endpoint", async () => {
            const privateUrls = [
                "https://10.0.0.1/", "https://100.64.0.1/", "https://[fd12::1]/"
            ];
            for (const url of privateUrls) {
                await expect(safeFetch(url, {}, { localRanges: PRIVATE }), url)
                    .resolves.toBeDefined();
                expect(await refusalOf(url, LOOPBACK), url).toMatchObject({
                    name: "SafeFetchRefusal", reason: "destination",
                    message: expect.stringContaining("private/internal")
                });
            }
            for (const url of [ "https://127.0.0.1:8443/", "https://[::1]/" ]) {
                await expect(safeFetch(url, {}, { localRanges: LOOPBACK }), url)
                    .resolves.toBeDefined();
                expect(await refusalOf(url, PRIVATE), url).toMatchObject({ reason: "destination" });
            }
            for (const url of [ "https://10.0.0.1/", "https://127.0.0.1/" ]) {
                expect(await refusalOf(url, PUBLIC_ONLY), url).toBeInstanceOf(SafeFetchRefusal);
            }
            const both = { allowPrivate: true, allowLoopback: true };
            expect(await refusalOf("https://100.100.100.200/", both)).toMatchObject({
                reason: "destination", message: expect.stringContaining("metadata endpoint")
            });
            expect(await refusalOf("https://169.254.169.254/", both))
                .toBeInstanceOf(ValidationError);
            await expect(safeFetch("https://8.8.8.8/", {}, { localRanges: PUBLIC_ONLY }))
                .resolves.toBeDefined();
        });

        it("sends plain HTTP only when every pinned address is local", async () => {
            await expect(safeFetch("http://10.0.0.1/hook", {}, {
                localRanges: PRIVATE, isPlainHttpLocalOnly: true
            })).resolves.toBeDefined();
            await expect(safeFetch("https://8.8.8.8/hook", {}, {
                localRanges: PRIVATE, isPlainHttpLocalOnly: true
            })).resolves.toBeDefined();
            // Without the rule, plain HTTP reaches a public address as before.
            await expect(safeFetch("http://8.8.8.8/hook", {}, { localRanges: PRIVATE }))
                .resolves.toBeDefined();
            expect(fetchMock).toHaveBeenCalledTimes(3);

            fetchMock.mockClear();
            vi.spyOn(dns.promises, "lookup")
                .mockResolvedValueOnce(addresses("10.0.0.5", "93.184.216.34"));
            const publicUrls = [
                "http://8.8.8.8/hook", "http://[::ffff:8.8.8.8]/hook", "http://mixed.example/"
            ];
            for (const url of publicUrls) {
                expect(await refusalOf(url, PRIVATE), url).toMatchObject({
                    name: "SafeFetchRefusal", reason: "destination",
                    message: expect.stringContaining("Plain HTTP")
                });
            }
            expect(fetchMock).not.toHaveBeenCalled();
        });

        it("pins a name that resolves private and then public to the private address", async () => {
            // The request goes to the address of the first lookup, the one that was checked.
            const lookup = vi.spyOn(dns.promises, "lookup")
                .mockResolvedValueOnce(addresses("10.0.0.5"))
                .mockResolvedValue(addresses("93.184.216.34"));

            await safeFetch("http://rebinding.example/hook", {}, {
                localRanges: PRIVATE, isPlainHttpLocalOnly: true
            });

            expect(lookup).toHaveBeenCalledOnce();
            const pinnedLookup = agentInstances[0].options.connect?.lookup as (
                hostname: string, options: object, callback: (...args: unknown[]) => void) => void;
            const answer = vi.fn();
            pinnedLookup("rebinding.example", { all: true }, answer);
            expect(answer).toHaveBeenCalledWith(null, [ { address: "10.0.0.5", family: 4 } ]);

            // In the other order, the first answer is public, and nothing is sent.
            lookup.mockReset().mockResolvedValueOnce(addresses("93.184.216.34"));
            fetchMock.mockClear();
            expect(await refusalOf("http://rebinding.example/hook", PRIVATE))
                .toMatchObject({ reason: "destination" });
            expect(fetchMock).not.toHaveBeenCalled();
        });
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

function nextTask() {
    return new Promise((resolve) => setTimeout(resolve));
}

/** What `dns.promises.lookup()` answers with `all` for these IPv4 addresses. */
function addresses(...ips: string[]) {
    return ips.map((address) => ({ address, family: 4 })) as unknown as dns.LookupAddress;
}

describe("safeFetch with an undici module that carries no default export", () => {
    it("reads Agent and fetch from the namespace itself", async () => {
        const namedFetch = vi.fn().mockResolvedValue({
            status: 204,
            statusText: "No Content",
            headers: new Headers(),
            body: null
        });
        // Vitest refuses a read of an export the factory did not return, so `default` is undefined.
        vi.doMock("undici", () => ({ default: undefined, Agent: MockAgent, fetch: namedFetch }));
        vi.resetModules();
        agentInstances.length = 0;

        try {
            const response = await safeFetch("http://8.8.8.8/named");
            expect(response.status).toBe(204);
            expect(namedFetch).toHaveBeenCalledWith(
                "http://8.8.8.8/named", expect.objectContaining({ dispatcher: agentInstances[0] }));
            expect(undiciFetch).not.toHaveBeenCalled();
        } finally {
            vi.doMock("undici", () => ({
                default: { Agent: MockAgent, fetch: undiciFetch },
                Agent: MockAgent,
                fetch: undiciFetch
            }));
            vi.resetModules();
        }
    });
});
