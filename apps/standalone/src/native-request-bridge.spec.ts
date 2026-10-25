import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { installNativeRequestBridge } from "./native-request-bridge.js";

const mocks = vi.hoisted(() => ({
    localFetch: vi.fn()
}));

vi.mock("./local-bridge.js", () => ({
    localFetch: (request: Request) => mocks.localFetch(request),
    isLocalApiRequest: (url: URL) => ["/api/", "/share/", "/custom/"].some((prefix) => url.pathname.startsWith(prefix))
}));

interface Channel {
    postMessage: ReturnType<typeof vi.fn>;
}

interface BridgeWindow {
    triliumRequestBridge?: Channel;
    webkit?: { messageHandlers?: { triliumRequestBridge?: Channel } };
    __triliumNativeRequest?: (request: Record<string, unknown>) => void;
}

const bridgeWindow = window as unknown as BridgeWindow;
let postMessage: ReturnType<typeof vi.fn>;

beforeEach(() => {
    mocks.localFetch.mockReset();
    postMessage = vi.fn();
    bridgeWindow.triliumRequestBridge = { postMessage };
    vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
    delete bridgeWindow.triliumRequestBridge;
    delete bridgeWindow.webkit;
    delete bridgeWindow.__triliumNativeRequest;
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
});

/** Installs the bridge, forwards one request, and returns every message the page sent back. */
async function forward(request: Record<string, unknown>) {
    installNativeRequestBridge();
    postMessage.mockClear();
    bridgeWindow.__triliumNativeRequest?.({
        method: "GET",
        headers: {},
        binary: true,
        ...request
    });
    await vi.waitFor(() => {
        const last = postMessage.mock.calls.at(-1)?.[0];
        expect(typeof last === "string" && /"type":"(end|error)"/.test(last)).toBe(true);
    });
    return postMessage.mock.calls.map(([message]) =>
        typeof message === "string" ? JSON.parse(message) : message as ArrayBuffer);
}

describe("installNativeRequestBridge", () => {
    it("finds the Android or the iOS channel, and reports when there is neither", () => {
        delete bridgeWindow.triliumRequestBridge;
        expect(installNativeRequestBridge()).toBe(false);
        expect(bridgeWindow.__triliumNativeRequest).toBeUndefined();

        bridgeWindow.webkit = { messageHandlers: { triliumRequestBridge: { postMessage } } };
        expect(installNativeRequestBridge()).toBe(true);
        expect(bridgeWindow.__triliumNativeRequest).toBeTypeOf("function");
        expect(postMessage).toHaveBeenCalledWith(JSON.stringify({ type: "ready" }));

        delete bridgeWindow.webkit;
        const android = vi.fn();
        bridgeWindow.triliumRequestBridge = { postMessage: android };
        expect(installNativeRequestBridge()).toBe(true);
        expect(android).toHaveBeenCalledWith(JSON.stringify({ type: "ready" }));
    });

    it("answers from localFetch with a head, id-framed binary chunks and an end", async () => {
        // Two chunks' worth plus a remainder, so the split and the framing both show.
        const body = new Uint8Array(256 * 1024 * 2 + 3).map((_, i) => i % 251);
        mocks.localFetch.mockResolvedValue(new Response(body, {
            status: 206,
            headers: { "content-type": "image/png", "content-length": "1" }
        }));

        const messages = await forward({ id: 7, url: "https://localhost/api/images/x", headers: { range: "bytes=0-" } });

        const request = mocks.localFetch.mock.calls[0][0] as Request;
        expect(request.url).toBe("https://localhost/api/images/x");
        expect(request.method).toBe("GET");
        expect(request.headers.get("range")).toBe("bytes=0-");

        expect(messages[0]).toEqual({
            type: "head", id: 7, status: 206,
            headers: { "content-type": "image/png", "content-length": String(body.length) }
        });
        const frames = messages.slice(1, -1) as ArrayBuffer[];
        expect(frames.map((frame) => frame.byteLength)).toEqual([4 + 256 * 1024, 4 + 256 * 1024, 4 + 3]);
        for (const frame of frames) {
            expect(new DataView(frame).getUint32(0)).toBe(7);
        }
        const received = new Uint8Array(frames.flatMap((frame) => [...new Uint8Array(frame, 4)]));
        expect(received).toEqual(body);
        expect(messages.at(-1)).toEqual({ type: "end", id: 7 });
    });

    it("sends base64 chunks over the iOS channel, and none for an empty body", async () => {
        delete bridgeWindow.triliumRequestBridge;
        bridgeWindow.webkit = { messageHandlers: { triliumRequestBridge: { postMessage } } };

        mocks.localFetch.mockResolvedValue(new Response("hello"));
        const messages = await forward({ id: 3, url: "capacitor://localhost/api/notes", binary: false });
        expect(messages.slice(1)).toEqual([
            { type: "chunk", id: 3, data: btoa("hello") },
            { type: "end", id: 3 }
        ]);

        mocks.localFetch.mockResolvedValue(new Response(null, { status: 204 }));
        const empty = await forward({ id: 4, url: "capacitor://localhost/api/notes", binary: false });
        expect(empty.map((message) => (message as { type: string }).type)).toEqual(["head", "end"]);
    });

    it("leaves the length of a HEAD answer to the worker", async () => {
        mocks.localFetch.mockResolvedValue(new Response(null, { headers: { "content-length": "42" } }));
        const messages = await forward({ id: 2, method: "HEAD", url: "https://localhost/api/notes" });

        expect((messages[0] as { headers: Record<string, string> }).headers["content-length"]).toBe("42");
    });

    it("turns a redirect into a page that navigates, since neither native response carries a 3xx", async () => {
        mocks.localFetch.mockResolvedValue(new Response(null, {
            status: 302,
            headers: { location: "../share/?a=1&b=\"2\"" }
        }));
        const messages = await forward({ id: 1, url: "https://localhost/share/x", binary: false });
        const html = atob((messages[1] as { data: string }).data);

        expect(messages[0]).toEqual({
            type: "head", id: 1, status: 200,
            headers: { "content-type": "text/html; charset=utf-8", "content-length": String(html.length) }
        });
        expect(html).toBe("<!DOCTYPE html><meta http-equiv=\"refresh\" content=\"0;url=../share/?a=1&amp;b=&quot;2&quot;\">");
    });

    it("reports an error for a path the worker does not serve, and for a failed localFetch", async () => {
        const unrouted = await forward({ id: 5, url: "https://localhost/assets/app.js" });
        expect(unrouted).toEqual([{ type: "error", id: 5, message: "Path is not routed to the local worker: /assets/app.js" }]);
        expect(mocks.localFetch).not.toHaveBeenCalled();

        mocks.localFetch.mockRejectedValue(new Error("worker gone"));
        const failed = await forward({ id: 6, url: "https://localhost/api/notes" });
        expect(failed).toEqual([{ type: "error", id: 6, message: "worker gone" }]);

        mocks.localFetch.mockRejectedValue("closed");
        const rejected = await forward({ id: 7, url: "https://localhost/api/notes" });
        expect(rejected).toEqual([{ type: "error", id: 7, message: "closed" }]);
    });

    it("sends a script's local POST to localFetch with its body, since the native side cannot read it", async () => {
        const networkFetch = vi.fn(async () => new Response("POST cannot be answered natively", { status: 405 }));
        vi.stubGlobal("fetch", networkFetch);
        mocks.localFetch.mockResolvedValue(Response.json({ ok: true }));
        installNativeRequestBridge();

        const response = await window.fetch("/custom/srs?action=rate", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ noteId: "abc", quality: 3 })
        });

        expect(networkFetch).not.toHaveBeenCalled();
        expect(response.status).toBe(200);
        expect(await response.json()).toEqual({ ok: true });
        const request: Request = mocks.localFetch.mock.calls[0][0];
        expect(request.method).toBe("POST");
        expect(new URL(request.url).pathname).toBe("/custom/srs");
        expect(await request.json()).toEqual({ noteId: "abc", quality: 3 });

        await window.fetch("/custom/srs?action=getDue");
        await window.fetch("https://example.com/custom/srs", { method: "POST", body: "x" });
        await window.fetch("/assets/upload", { method: "POST", body: "x" });
        expect(networkFetch).toHaveBeenCalledTimes(3);
        expect(mocks.localFetch).toHaveBeenCalledTimes(1);
    });
});
