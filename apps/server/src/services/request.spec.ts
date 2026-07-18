import { EventEmitter } from "node:events";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type Handler = (e: any) => void;

interface FakeResponse {
    statusCode: number;
    statusMessage: string;
    headers: Record<string, any>;
    on(event: string, cb: Handler): FakeResponse;
    emitData(chunk: Buffer): void;
    emitEnd(): void;
    emitError(err: Error): void;
}

interface FakeRequest {
    opts: any;
    endPayload: string | undefined;
    on(event: string, cb: Handler): FakeRequest;
    end(payload?: string): void;
    triggerError(err: any): void;
    triggerAbort(err: any): void;
    triggerResponse(response: FakeResponse): void;
}

/**
 * Shared mock state + fake http/https modules. Each `request()` call pushes a
 * FakeRequest whose registered handlers can be driven by the test to simulate
 * "response", "error" and "abort" events. Everything lives inside `vi.hoisted`
 * so the (hoisted) `vi.mock` factories can reference it.
 */
const { state, fakeHttp, fakeHttps, makeResponse, HttpProxyAgent, HttpsProxyAgent, getLogMock, getSyncProxyMock } =
    vi.hoisted(() => {
        const state: {
            requests: FakeRequest[];
            onEnd: ((req: FakeRequest) => void) | null;
        } = { requests: [], onEnd: null };

        /**
         * Backed by a real EventEmitter so that `emitError` reproduces Node's
         * semantics faithfully: an "error" event with no listener is rethrown.
         */
        function makeResponse(
            statusCode: number,
            statusMessage: string,
            headers: Record<string, any> = {}
        ): FakeResponse {
            const emitter = new EventEmitter();
            return {
                statusCode,
                statusMessage,
                headers,
                on(event, cb) {
                    emitter.on(event, cb);
                    return this;
                },
                emitData(chunk) {
                    emitter.emit("data", chunk);
                },
                emitEnd() {
                    emitter.emit("end", undefined);
                },
                emitError(err) {
                    emitter.emit("error", err);
                }
            };
        }

        function makeRequest(opts: any): FakeRequest {
            const handlers: Record<string, Handler> = {};
            const req: FakeRequest = {
                opts,
                endPayload: undefined,
                on(event, cb) {
                    handlers[event] = cb;
                    return req;
                },
                end(payload) {
                    req.endPayload = payload;
                    state.onEnd?.(req);
                },
                triggerError: (err) => handlers["error"]?.(err),
                triggerAbort: (err) => handlers["abort"]?.(err),
                triggerResponse: (response) => handlers["response"]?.(response)
            };
            state.requests.push(req);
            return req;
        }

        const fakeHttp = { request: vi.fn((opts: any) => makeRequest(opts)) };
        const fakeHttps = { request: vi.fn((opts: any) => makeRequest(opts)) };

        const HttpProxyAgent = vi.fn(function (this: any, proxy: string) {
            this.proxy = proxy;
            this.kind = "http";
        });
        const HttpsProxyAgent = vi.fn(function (this: any, proxy: string) {
            this.proxy = proxy;
            this.kind = "https";
        });

        return {
            state,
            fakeHttp,
            fakeHttps,
            makeResponse,
            HttpProxyAgent,
            HttpsProxyAgent,
            getLogMock: { error: vi.fn(), info: vi.fn() },
            getSyncProxyMock: vi.fn(() => null as string | null)
        };
    });

vi.mock("http", () => fakeHttp);
vi.mock("https", () => fakeHttps);
vi.mock("http-proxy-agent", () => ({ HttpProxyAgent }));
vi.mock("https-proxy-agent", () => ({ HttpsProxyAgent }));
vi.mock("@triliumnext/core", () => ({
    getLog: () => getLogMock,
    sync_options: { getSyncProxy: getSyncProxyMock }
}));

import type { ExecOpts } from "@triliumnext/core";

import NodeRequestProvider from "./request.js";

function baseOpts(overrides: Partial<ExecOpts> = {}): any {
    return {
        method: "GET",
        url: "http://sync.example.com:8080/api/sync",
        proxy: null,
        timeout: 1000,
        ...overrides
    };
}

describe("NodeRequestProvider.exec", () => {
    let provider: NodeRequestProvider;

    beforeEach(() => {
        provider = new NodeRequestProvider();
        state.requests = [];
        state.onEnd = null;
        fakeHttp.request.mockClear();
        fakeHttps.request.mockClear();
        HttpProxyAgent.mockClear();
        HttpsProxyAgent.mockClear();
        getLogMock.error.mockClear();
        getLogMock.info.mockClear();
        getSyncProxyMock.mockReturnValue(null);
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    it("selects the http client and resolves parsed JSON on 200", async () => {
        state.onEnd = (req) => {
            const res = makeResponse(200, "OK");
            req.triggerResponse(res);
            res.emitData(Buffer.from('{"foo":'));
            res.emitData(Buffer.from('"bar"}'));
            res.emitEnd();
        };

        const result = await provider.exec<{ foo: string }>(baseOpts());
        expect(result).toEqual({ foo: "bar" });
        expect(fakeHttp.request).toHaveBeenCalledTimes(1);
        const sent = fakeHttp.request.mock.calls[0][0] as any;
        expect(sent.host).toBe("sync.example.com");
        expect(sent.port).toBe("8080");
        expect(sent.headers["Content-Type"]).toBe("application/json");
    });

    it("selects the https client based on the URL scheme", async () => {
        state.onEnd = (req) => {
            const res = makeResponse(204, "No Content");
            req.triggerResponse(res);
            res.emitEnd();
        };

        const result = await provider.exec(baseOpts({ url: "https://sync.example.com/x" }));
        expect(result).toBeNull(); // empty body → null
        expect(fakeHttps.request).toHaveBeenCalledTimes(1);
    });

    it("throws for an unrecognized protocol", async () => {
        await expect(provider.exec(baseOpts({ url: "ftp://example.com/x" }))).rejects.toThrow(
            /Unrecognized protocol/
        );
    });

    it("sends paging headers (text/plain) when pageCount > 1 and stores response cookies", async () => {
        const cookieJar = { header: "sid=1" };
        state.onEnd = (req) => {
            const res = makeResponse(201, "Created", { "set-cookie": "sid=2" });
            req.triggerResponse(res);
            res.emitData(Buffer.from("null"));
            res.emitEnd();
        };

        await provider.exec(
            baseOpts({
                method: "POST",
                body: { a: 1 },
                cookieJar,
                auth: { password: "secret" },
                paging: { pageCount: 3, pageIndex: 1, requestId: "req-1" }
            })
        );

        const sent = state.requests[0].opts;
        expect(sent.headers["Content-Type"]).toBe("text/plain");
        expect(sent.headers["pageCount"]).toBe(3);
        expect(sent.headers["Cookie"]).toBe("sid=1");
        // auth header is base64 of dummy:secret
        expect(sent.headers["trilium-cred"]).toBe(Buffer.from("dummy:secret").toString("base64"));
        // body object serialized
        expect(state.requests[0].endPayload).toBe(JSON.stringify({ a: 1 }));
        // response set-cookie stored back into the jar
        expect(cookieJar.header).toBe("sid=2");
    });

    it("passes a string body through unchanged and defaults the cookie header to empty", async () => {
        state.onEnd = (req) => {
            const res = makeResponse(200, "OK");
            req.triggerResponse(res);
            res.emitData(Buffer.from(""));
            res.emitEnd();
        };

        await provider.exec(baseOpts({ method: "POST", body: "raw-string" }));
        expect(state.requests[0].endPayload).toBe("raw-string");
        expect(state.requests[0].opts.headers["Cookie"]).toBe("");
    });

    it("rejects on a request error", async () => {
        state.onEnd = (req) => req.triggerError(new Error("ECONNRESET"));
        await expect(provider.exec(baseOpts())).rejects.toThrow(/ECONNRESET/);
    });

    it("rejects and logs when a successful response body is not valid JSON", async () => {
        state.onEnd = (req) => {
            const res = makeResponse(200, "OK");
            req.triggerResponse(res);
            res.emitData(Buffer.from("not json"));
            res.emitEnd();
        };

        await expect(provider.exec(baseOpts())).rejects.toThrow(/failed/);
        expect(getLogMock.error).toHaveBeenCalled();
    });

    it("rejects non-2xx responses using the JSON error message", async () => {
        state.onEnd = (req) => {
            const res = makeResponse(400, "Bad Request");
            req.triggerResponse(res);
            res.emitData(Buffer.from('{"message":"nope"}'));
            res.emitEnd();
        };

        await expect(provider.exec(baseOpts())).rejects.toThrow(/400 Bad Request nope/);
    });

    it("rejects non-2xx responses with an empty message when JSON has no message field", async () => {
        state.onEnd = (req) => {
            const res = makeResponse(403, "Forbidden");
            req.triggerResponse(res);
            res.emitData(Buffer.from("{}"));
            res.emitEnd();
        };

        const err = await provider.exec(baseOpts()).catch((e: Error) => e);
        // trailing space because the empty error message is appended
        expect((err as Error).message).toContain("403 Forbidden ");
    });

    it("rejects non-2xx responses falling back to a truncated body when not JSON", async () => {
        const longBody = "x".repeat(200);
        state.onEnd = (req) => {
            const res = makeResponse(500, "Server Error");
            req.triggerResponse(res);
            res.emitData(Buffer.from(longBody));
            res.emitEnd();
        };

        const err = await provider.exec(baseOpts()).catch((e: Error) => e);
        expect((err as Error).message).toContain("500 Server Error");
        expect((err as Error).message).toContain("x".repeat(100));
        expect((err as Error).message).not.toContain("x".repeat(101));
    });

    it("does not store cookies when the response has no set-cookie header", async () => {
        const cookieJar = { header: "sid=keep" };
        state.onEnd = (req) => {
            const res = makeResponse(200, "OK");
            req.triggerResponse(res);
            res.emitData(Buffer.from("null"));
            res.emitEnd();
        };
        await provider.exec(baseOpts({ cookieJar }));
        expect(cookieJar.header).toBe("sid=keep");
    });

    describe("proxy handling", () => {
        it("builds an HttpProxyAgent for http URLs with a proxy", async () => {
            state.onEnd = (req) => {
                const res = makeResponse(200, "OK");
                req.triggerResponse(res);
                res.emitData(Buffer.from("null"));
                res.emitEnd();
            };
            await provider.exec(baseOpts({ proxy: "http://proxy:3128" }));
            expect(HttpProxyAgent).toHaveBeenCalledWith("http://proxy:3128");
            expect(state.requests[0].opts.agent).toBeInstanceOf(HttpProxyAgent);
        });

        it("builds an HttpsProxyAgent for https URLs with a proxy", async () => {
            state.onEnd = (req) => {
                const res = makeResponse(200, "OK");
                req.triggerResponse(res);
                res.emitData(Buffer.from("null"));
                res.emitEnd();
            };
            await provider.exec(
                baseOpts({ url: "https://sync.example.com/x", proxy: "http://proxy:3128" })
            );
            expect(HttpsProxyAgent).toHaveBeenCalledWith("http://proxy:3128");
        });

        it("resets the special 'noproxy' value to no proxy agent", async () => {
            state.onEnd = (req) => {
                const res = makeResponse(200, "OK");
                req.triggerResponse(res);
                res.emitData(Buffer.from("null"));
                res.emitEnd();
            };
            await provider.exec(baseOpts({ proxy: "noproxy" }));
            expect(HttpProxyAgent).not.toHaveBeenCalled();
            expect(state.requests[0].opts.agent).toBeNull();
        });

        it("ignores a proxy when the target URL protocol is unsupported", async () => {
            // getProxyAgent parses the url; a non-http(s) protocol yields no agent.
            // getClient runs first and rejects unsupported protocols, so assert there.
            await expect(
                provider.exec(baseOpts({ url: "ftp://example.com/x", proxy: "http://proxy:3128" }))
            ).rejects.toThrow(/Unrecognized protocol/);
        });
    });

    describe("cookie jar handling (#10548)", () => {
        it("replays a multi-Set-Cookie response as a single string of name=value pairs", async () => {
            // A reverse proxy (LB affinity, CDN) can add its own cookie next to trilium.sid.
            state.onEnd = (req) => {
                const first = state.requests.length === 1;
                const headers = first ? {
                    "set-cookie": [
                        "ws-server=affinity|123; Expires=Sun, 19-Jul-26 15:08:52 GMT; Max-Age=86400; Path=/; Secure; HttpOnly",
                        "trilium.sid=s%3Aabc.def; Path=/; Expires=Sat, 08 Aug 2026 13:18:40 GMT; HttpOnly; SameSite=Lax"
                    ]
                } : {};
                const res = makeResponse(200, "OK", headers);
                req.triggerResponse(res);
                res.emitData(Buffer.from("null"));
                res.emitEnd();
            };

            const cookieJar = {};
            await provider.exec(baseOpts({ cookieJar }));
            await provider.exec(baseOpts({ cookieJar }));

            // The jar must hold ONE plain string of name=value pairs. Replaying the raw
            // Set-Cookie array breaks the desktop: Electron's `net` joins array header
            // values with a bare comma, merging "…HttpOnly,trilium.sid=…" into a junk
            // cookie name, so the sync server loses the session ("Logged in session not
            // found"). Attributes (Path, Expires, …) must be stripped — the server would
            // otherwise parse them as bogus cookies.
            expect(state.requests[1].opts.headers["Cookie"]).toBe(
                "ws-server=affinity|123; trilium.sid=s%3Aabc.def"
            );
        });

        it("merges newly set cookies into the jar instead of replacing it", async () => {
            // First response establishes the session; a later response that sets only the
            // proxy's cookie must not wipe trilium.sid from the jar.
            state.onEnd = (req) => {
                const perCall: (string[] | undefined)[] = [
                    ["trilium.sid=s%3Aabc.def; Path=/; HttpOnly; SameSite=Lax"],
                    ["ws-server=affinity|123; Path=/; Secure; HttpOnly"],
                    undefined
                ];
                const setCookie = perCall[state.requests.length - 1];
                const res = makeResponse(200, "OK", setCookie ? { "set-cookie": setCookie } : {});
                req.triggerResponse(res);
                res.emitData(Buffer.from("null"));
                res.emitEnd();
            };

            const cookieJar = {};
            await provider.exec(baseOpts({ cookieJar }));
            await provider.exec(baseOpts({ cookieJar }));
            await provider.exec(baseOpts({ cookieJar }));

            expect(state.requests[2].opts.headers["Cookie"]).toBe(
                "trilium.sid=s%3Aabc.def; ws-server=affinity|123"
            );
        });

        it("updates an existing cookie's value in place", async () => {
            // e.g. express-session regenerating the session id must replace, not duplicate.
            state.onEnd = (req) => {
                const perCall: (string[] | undefined)[] = [
                    ["trilium.sid=s%3Aold.sig; Path=/; HttpOnly"],
                    ["trilium.sid=s%3Anew.sig; Path=/; HttpOnly"],
                    undefined
                ];
                const setCookie = perCall[state.requests.length - 1];
                const res = makeResponse(200, "OK", setCookie ? { "set-cookie": setCookie } : {});
                req.triggerResponse(res);
                res.emitData(Buffer.from("null"));
                res.emitEnd();
            };

            const cookieJar = {};
            await provider.exec(baseOpts({ cookieJar }));
            await provider.exec(baseOpts({ cookieJar }));
            await provider.exec(baseOpts({ cookieJar }));

            expect(state.requests[2].opts.headers["Cookie"]).toBe("trilium.sid=s%3Anew.sig");
        });
    });

    it("rejects if the client throws synchronously while preparing the request", async () => {
        fakeHttp.request.mockImplementationOnce(() => {
            throw new Error("boom-prepare");
        });
        await expect(provider.exec(baseOpts())).rejects.toThrow(/boom-prepare/);
    });

    it("rejects rather than rethrowing when the response stream fails mid-body", async () => {
        let delivered: FakeResponse | undefined;
        state.onEnd = (req) => {
            const res = makeResponse(200, "OK");
            delivered = res;
            req.triggerResponse(res);
            res.emitData(Buffer.from('{"partial":'));
        };

        const promise = provider.exec(baseOpts());
        await vi.waitFor(() => expect(delivered).toBeDefined());
        const response = delivered;
        if (!response) throw new Error("the response was never delivered");

        // Electron's `net` reports a mid-body failure (a connection reset, an HTTP/3
        // stream error) by destroying the response stream, which emits "error" on it.
        // With no listener, Node rethrows — surfacing in the Electron main process as
        // "A JavaScript error occurred in the main process".
        expect(() => response.emitError(new Error("net::ERR_CONNECTION_RESET"))).not.toThrow();
        await expect(promise).rejects.toThrow(/ERR_CONNECTION_RESET/);
    });
});

describe("NodeRequestProvider.getImage", () => {
    let provider: NodeRequestProvider;

    beforeEach(() => {
        provider = new NodeRequestProvider();
        state.requests = [];
        state.onEnd = null;
        fakeHttp.request.mockClear();
        getSyncProxyMock.mockReturnValue(null);
    });

    it("downloads image bytes and resolves an ArrayBuffer", async () => {
        const bytes = Buffer.from([1, 2, 3, 4]);
        state.onEnd = (req) => {
            const res = makeResponse(200, "OK");
            req.triggerResponse(res);
            res.emitData(bytes);
            res.emitEnd();
        };

        const result = await provider.getImage("http://img.example.com/pic.png");
        expect(Buffer.from(result)).toEqual(bytes);
    });

    it("uses the configured sync proxy", async () => {
        getSyncProxyMock.mockReturnValue("http://proxy:3128");
        state.onEnd = (req) => {
            const res = makeResponse(200, "OK");
            req.triggerResponse(res);
            res.emitData(Buffer.from([0]));
            res.emitEnd();
        };
        await provider.getImage("http://img.example.com/pic.png");
        expect(HttpProxyAgent).toHaveBeenCalledWith("http://proxy:3128");
    });

    it("treats the 'noproxy' sync proxy value as no proxy", async () => {
        getSyncProxyMock.mockReturnValue("noproxy");
        state.onEnd = (req) => {
            const res = makeResponse(200, "OK");
            req.triggerResponse(res);
            res.emitData(Buffer.from([0]));
            res.emitEnd();
        };
        await provider.getImage("http://img.example.com/pic.png");
        expect(state.requests[0].opts.agent).toBeNull();
    });

    it("rejects non-2xx image responses, and a late body does not override the rejection", async () => {
        state.onEnd = (req) => {
            const res = makeResponse(404, "Not Found");
            req.triggerResponse(res);
            // getImage rejects on the status code but does not `return`, so it still
            // wires up data/end handlers. A body arriving afterwards must NOT cause a
            // late resolve that masks the rejection.
            res.emitData(Buffer.from([1, 2, 3]));
            res.emitEnd();
        };
        await expect(provider.getImage("http://img.example.com/missing.png")).rejects.toThrow(
            /404 Not Found/
        );
    });

    it("rejects on a request error", async () => {
        state.onEnd = (req) => req.triggerError(new Error("img-error"));
        await expect(provider.getImage("http://img.example.com/pic.png")).rejects.toThrow(
            /img-error/
        );
    });

    it("rejects on a request abort", async () => {
        state.onEnd = (req) => req.triggerAbort(new Error("img-abort"));
        await expect(provider.getImage("http://img.example.com/pic.png")).rejects.toThrow(
            /img-abort/
        );
    });

    it("rejects if the client throws synchronously", async () => {
        fakeHttp.request.mockImplementationOnce(() => {
            throw new Error("img-prepare");
        });
        await expect(provider.getImage("http://img.example.com/pic.png")).rejects.toThrow(
            /img-prepare/
        );
    });

    it("rejects rather than rethrowing when the response stream fails mid-body", async () => {
        let delivered: FakeResponse | undefined;
        state.onEnd = (req) => {
            const res = makeResponse(200, "OK");
            delivered = res;
            req.triggerResponse(res);
            res.emitData(Buffer.from([1, 2]));
        };

        const promise = provider.getImage("http://img.example.com/pic.png");
        await vi.waitFor(() => expect(delivered).toBeDefined());
        const response = delivered;
        if (!response) throw new Error("the response was never delivered");

        expect(() => response.emitError(new Error("net::ERR_CONNECTION_RESET"))).not.toThrow();
        await expect(promise).rejects.toThrow(/ERR_CONNECTION_RESET/);
    });
});
