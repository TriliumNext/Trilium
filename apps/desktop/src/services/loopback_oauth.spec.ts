import http from "node:http";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
    openExternal: vi.fn<(url: string) => void>(),
    buildAuthorizationUrl: vi.fn((_config: unknown, opts: { redirectUri: string; state: string; challenge: string }) =>
        `https://login.example/authorize?redirect_uri=${encodeURIComponent(opts.redirectUri)}&state=${opts.state}&challenge=${opts.challenge}`),
    exchangeCodeForToken: vi.fn<(...args: unknown[]) => Promise<unknown>>()
}));

vi.mock("electron", () => ({
    default: { shell: { openExternal: h.openExternal } }
}));

vi.mock("@triliumnext/server/src/services/oauth/oauth.js", () => ({
    default: {
        generatePkce: () => ({ verifier: "the-verifier", challenge: "the-challenge" }),
        generateState: () => "the-state",
        buildAuthorizationUrl: h.buildAuthorizationUrl,
        exchangeCodeForToken: h.exchangeCodeForToken
    }
}));

const { authorizeViaLoopback } = await import("./loopback_oauth.js");

const CONFIG = { clientId: "client" } as unknown as Parameters<typeof authorizeViaLoopback>[0];
const TOKENS = { access_token: "at", refresh_token: "rt", expires_in: 3600 };

describe("authorizeViaLoopback", () => {
    beforeEach(() => {
        h.exchangeCodeForToken.mockResolvedValue(TOKENS);
    });

    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
        h.openExternal.mockReset();
    });

    it("exchanges the code from the loopback redirect and ignores unrelated requests", async () => {
        const responses: Array<{ status: number; body: string }> = [];
        h.openExternal.mockImplementation((url) => {
            const redirectUri = redirectUriOf(url);
            void (async () => {
                responses.push(await get(`${redirectUri}favicon.ico`));
                responses.push(await get(`${redirectUri}?code=the-code&state=the-state`));
            })();
        });

        const result = await authorizeViaLoopback(CONFIG);

        expect(result).toEqual(TOKENS);
        const [, opts] = h.exchangeCodeForToken.mock.calls[0] as [unknown, { code: string; verifier: string; redirectUri: string }];
        expect(opts.code).toBe("the-code");
        expect(opts.verifier).toBe("the-verifier");
        expect(opts.redirectUri).toMatch(/^http:\/\/localhost:\d+\/$/);
        expect(h.buildAuthorizationUrl.mock.calls[0][1]).toMatchObject({ state: "the-state", challenge: "the-challenge" });
        await vi.waitFor(() => expect(responses).toHaveLength(2));
        expect(responses[0].status).toBe(404);
        expect(responses[1].status).toBe(200);
        expect(responses[1].body).toContain("Connected.");
        // The server is closed once the flow settles.
        await expect(get(opts.redirectUri)).rejects.toThrow();
    });

    it("rejects with the provider error and escapes it in the browser page", async () => {
        let body = "";
        h.openExternal.mockImplementation((url) => {
            void get(`${redirectUriOf(url)}?error=${encodeURIComponent("<bad>&\"x\"")}`).then((r) => { body = r.body; });
        });

        await expect(authorizeViaLoopback(CONFIG)).rejects.toThrow("Sign-in failed: <bad>&\"x\"");
        await vi.waitFor(() => expect(body).not.toBe(""));
        expect(body).toContain("&lt;bad&gt;&amp;&quot;x&quot;");
        expect(body).not.toContain("<bad>");
        expect(h.exchangeCodeForToken).not.toHaveBeenCalled();
    });

    it("rejects a redirect whose state does not match", async () => {
        h.openExternal.mockImplementation((url) => {
            void get(`${redirectUriOf(url)}?code=c&state=forged`);
        });

        await expect(authorizeViaLoopback(CONFIG)).rejects.toThrow("invalid or expired state");
        expect(h.exchangeCodeForToken).not.toHaveBeenCalled();
    });

    it("treats a request without a URL as unrelated", async () => {
        const createServer = http.createServer;
        let server: http.Server | undefined;
        vi.spyOn(http, "createServer").mockImplementation(((listener: http.RequestListener) => {
            server = createServer(listener);
            return server;
        }) as typeof http.createServer);
        const writeHead = vi.fn(() => ({ end: vi.fn() }));
        h.openExternal.mockImplementation((url) => {
            server?.emit("request", { url: undefined }, { writeHead });
            void get(`${redirectUriOf(url)}?code=c&state=the-state`);
        });

        await authorizeViaLoopback(CONFIG);

        expect(writeHead).toHaveBeenCalledWith(404);
    });

    it("closes the server and rejects when opening the browser throws", async () => {
        vi.spyOn(http.Server.prototype, "address").mockReturnValue(null);
        h.openExternal.mockImplementation(() => {
            throw new Error("no browser");
        });
        const clearTimeoutSpy = vi.spyOn(globalThis, "clearTimeout");
        const closeSpy = vi.spyOn(http.Server.prototype, "close");

        await expect(authorizeViaLoopback(CONFIG)).rejects.toThrow("no browser");

        // address() returning a non-object falls back to port 0.
        expect(h.buildAuthorizationUrl.mock.calls.at(-1)?.[1]).toMatchObject({ redirectUri: "http://localhost:0/" });
        expect(closeSpy).toHaveBeenCalled();
        expect(clearTimeoutSpy).toHaveBeenCalled();
    });

    it("times out when the user never completes sign-in", async () => {
        vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
        h.openExternal.mockImplementation(() => undefined);

        const result = authorizeViaLoopback(CONFIG);
        const assertion = expect(result).rejects.toThrow("Timed out waiting for sign-in.");
        await vi.waitFor(() => expect(h.openExternal).toHaveBeenCalled());
        await vi.advanceTimersByTimeAsync(5 * 60 * 1000);

        await assertion;
    });

    it("rejects when the loopback server cannot listen", async () => {
        vi.spyOn(http.Server.prototype, "listen").mockImplementation(function (this: http.Server) {
            this.emit("error", new Error("EADDRINUSE"));
            return this;
        });

        await expect(authorizeViaLoopback(CONFIG)).rejects.toThrow("EADDRINUSE");
        expect(h.openExternal).not.toHaveBeenCalled();
    });
});

function redirectUriOf(authorizationUrl: string) {
    const redirectUri = new URL(authorizationUrl).searchParams.get("redirect_uri");
    if (!redirectUri) {
        throw new Error("Authorization URL carries no redirect_uri");
    }
    return redirectUri;
}

function get(url: string): Promise<{ status: number; body: string }> {
    return new Promise((resolve, reject) => {
        http.get(url, { agent: false }, (res) => {
            let body = "";
            res.setEncoding("utf8");
            res.on("data", (chunk: string) => { body += chunk; });
            res.on("end", () => resolve({ status: res.statusCode ?? 0, body }));
        }).on("error", reject);
    });
}
