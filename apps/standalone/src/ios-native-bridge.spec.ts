import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { installIosNativeBridge } from "./ios-native-bridge.js";

const mocks = vi.hoisted(() => ({
    localFetch: vi.fn(),
    isLocalApiRequest: vi.fn()
}));

vi.mock("./local-bridge.js", () => ({
    localFetch: (req: Request) => mocks.localFetch(req),
    isLocalApiRequest: (url: URL) => mocks.isLocalApiRequest(url)
}));

/** Same-origin URL against the happy-dom base (http://localhost:3000 by default). */
function localUrl(path: string) {
    return new URL(path, location.href).href;
}

type BridgeWindow = Window & {
    webkit?: { messageHandlers?: { triliumScheme?: { postMessage: (msg: unknown) => void } } };
    __triliumNativeRequest?: (payload: object) => void;
};
const bridgeWindow = window as BridgeWindow;

let postMessage: ReturnType<typeof vi.fn>;

function sendNativeRequest(payload: object) {
    const handler = bridgeWindow.__triliumNativeRequest;
    if (!handler) throw new Error("bridge not installed");
    handler(payload);
}

/** Waits for and returns the first posted message of the given type. */
async function postedMessage(type: string): Promise<Record<string, unknown>> {
    await vi.waitFor(() =>
        expect(postMessage.mock.calls.some(([msg]) => (msg as { type: string }).type === type)).toBe(true));
    return postMessage.mock.calls.map(([msg]) => msg).find((msg) => (msg as { type: string }).type === type);
}

beforeEach(() => {
    mocks.localFetch.mockReset();
    mocks.isLocalApiRequest.mockReset();
    mocks.isLocalApiRequest.mockImplementation((url: URL) => url.pathname.startsWith("/api/"));
    mocks.localFetch.mockResolvedValue(new Response("{}"));
    vi.spyOn(console, "warn").mockImplementation(() => {});
    vi.spyOn(console, "error").mockImplementation(() => {});

    postMessage = vi.fn();
    bridgeWindow.webkit = { messageHandlers: { triliumScheme: { postMessage } } };
});

afterEach(() => {
    delete bridgeWindow.webkit;
    delete bridgeWindow.__triliumNativeRequest;
    vi.restoreAllMocks();
});

describe("installIosNativeBridge", () => {
    it("registers the request handler and announces readiness to the native side", () => {
        installIosNativeBridge();
        expect(bridgeWindow.__triliumNativeRequest).toBeTypeOf("function");
        expect(postMessage).toHaveBeenCalledWith({ type: "ready" });
    });

    it("logs instead of throwing when the native message handler is missing", () => {
        delete bridgeWindow.webkit;
        expect(() => installIosNativeBridge()).not.toThrow();
        expect(console.error).toHaveBeenCalled();
    });

    it("routes a GET through localFetch and posts the response with a base64 body", async () => {
        mocks.localFetch.mockResolvedValue(new Response("world", {
            status: 201,
            headers: { "content-type": "text/plain", "x-foo": "bar" }
        }));
        installIosNativeBridge();

        sendNativeRequest({ id: "r1", method: "GET", url: "/api/notes", headers: { accept: "text/plain" } });

        const msg = await postedMessage("response");
        expect(msg).toMatchObject({ id: "r1", status: 201 });
        expect((msg.headers as Record<string, string>)["x-foo"]).toBe("bar");
        expect(atob(msg.bodyBase64 as string)).toBe("world");

        const [req] = mocks.localFetch.mock.calls[0] as [Request];
        expect(req.url).toBe(localUrl("/api/notes"));
        expect(req.method).toBe("GET");
        expect(req.headers.get("accept")).toBe("text/plain");
    });

    it("decodes a base64 request body for a POST", async () => {
        installIosNativeBridge();
        sendNativeRequest({
            id: "r2",
            method: "POST",
            url: "/api/notes",
            headers: { "content-type": "application/json" },
            bodyBase64: btoa('{"title":"n"}')
        });

        await postedMessage("response");
        const [req] = mocks.localFetch.mock.calls[0] as [Request];
        expect(req.method).toBe("POST");
        expect(await req.text()).toBe('{"title":"n"}');
    });

    it("ignores a body on GET/HEAD instead of constructing an invalid Request", async () => {
        installIosNativeBridge();
        sendNativeRequest({ id: "r3", method: "GET", url: "/api/tree", headers: {}, bodyBase64: btoa("junk") });

        await postedMessage("response");
        const [req] = mocks.localFetch.mock.calls[0] as [Request];
        expect(req.method).toBe("GET");
    });

    it("round-trips a binary response body through base64 intact", async () => {
        // > one 0x8000 encoding chunk, all byte values.
        const bytes = new Uint8Array(100_000).map((_, i) => i % 256);
        mocks.localFetch.mockResolvedValue(new Response(bytes));
        installIosNativeBridge();

        sendNativeRequest({ id: "r4", method: "GET", url: "/api/attachments/download/f1", headers: {} });

        const msg = await postedMessage("response");
        const decoded = atob(msg.bodyBase64 as string);
        expect(decoded.length).toBe(bytes.length);
        expect([...decoded].every((ch, i) => ch.charCodeAt(0) === bytes[i])).toBe(true);
    });

    it("posts an error when the worker fetch fails", async () => {
        mocks.localFetch.mockRejectedValue(new Error("worker down"));
        installIosNativeBridge();

        sendNativeRequest({ id: "r5", method: "GET", url: "/api/notes", headers: {} });

        const msg = await postedMessage("error");
        expect(msg).toMatchObject({ id: "r5", message: "worker down" });
        expect(console.warn).toHaveBeenCalled();
    });

    it("rejects paths outside the local API list (native/JS prefix mismatch guard)", async () => {
        installIosNativeBridge();
        sendNativeRequest({ id: "r6", method: "GET", url: "/not-api/x", headers: {} });

        const msg = await postedMessage("error");
        expect(msg.id).toBe("r6");
        expect(msg.message).toContain("not routed");
        expect(mocks.localFetch).not.toHaveBeenCalled();
    });
});
