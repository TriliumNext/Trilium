import { afterEach, describe, expect, it, vi } from "vitest";

// A controllable stand-in for the bundled local-server-worker. vi.hoisted lets the
// (hoisted) vi.mock factory share the instance registry with the test body.
const { workerInstances } = vi.hoisted(() => ({ workerInstances: [] as MockWorker[] }));

class MockWorker {
    postMessage = vi.fn();
    terminate = vi.fn();
    onmessage: ((e: { data: unknown }) => void) | null = null;
    onerror: ((e: { message: string }) => void) | null = null;
    constructor() { workerInstances.push(this); }
}

vi.mock("./local-server-worker?worker", () => ({ default: MockWorker }));

type LocalBridge = typeof import("./local-bridge.js");

interface NavServiceWorker {
    serviceWorker?: { addEventListener: ReturnType<typeof vi.fn> } | undefined;
}

let swHandler: ((event: unknown) => unknown) | undefined;

async function freshBridge(withServiceWorker = true): Promise<LocalBridge> {
    vi.resetModules();
    workerInstances.length = 0;
    swHandler = undefined;
    if (withServiceWorker) {
        Object.defineProperty(navigator, "serviceWorker", {
            value: { addEventListener: vi.fn((_type: string, handler: (e: unknown) => void) => { swHandler = handler; }) },
            configurable: true
        });
    } else {
        Object.defineProperty(navigator, "serviceWorker", { value: undefined, configurable: true });
    }
    return import("./local-bridge.js");
}

function lastWorker(): MockWorker {
    const worker = workerInstances.at(-1);
    if (!worker) {
        throw new Error("no worker created");
    }
    return worker;
}

afterEach(() => {
    delete (navigator as unknown as NavServiceWorker).serviceWorker;
    vi.restoreAllMocks();
});

describe("startLocalServerWorker", () => {
    it("creates the worker once and sends an INIT message", async () => {
        const bridge = await freshBridge();
        const worker = bridge.startLocalServerWorker();
        expect(workerInstances).toHaveLength(1);
        expect(worker.postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: "INIT", useNativeHttp: false }));

        // Second call returns the same instance without creating another worker.
        expect(bridge.startLocalServerWorker()).toBe(worker);
        expect(workerInstances).toHaveLength(1);
    });

    it("flags native HTTP when a handler was registered first", async () => {
        const bridge = await freshBridge();
        bridge.registerNativeHttpHandler(vi.fn());
        bridge.startLocalServerWorker();
        expect(lastWorker().postMessage).toHaveBeenCalledWith(expect.objectContaining({ useNativeHttp: true }));
    });
});

describe("worker message handling", () => {
    it("shows a dialog on FATAL_ERROR", async () => {
        const alertSpy = vi.fn();
        vi.stubGlobal("alert", alertSpy);
        vi.spyOn(console, "error").mockImplementation(() => {});
        const bridge = await freshBridge();
        bridge.startLocalServerWorker();
        lastWorker().onmessage?.({ data: { type: "FATAL_ERROR", message: "boom" } });
        expect(alertSpy).toHaveBeenCalledWith("boom");
        vi.unstubAllGlobals();
    });

    it("dispatches a window event for WS_MESSAGE", async () => {
        const dispatchSpy = vi.spyOn(window, "dispatchEvent");
        const bridge = await freshBridge();
        bridge.startLocalServerWorker();
        lastWorker().onmessage?.({ data: { type: "WS_MESSAGE", message: { kind: "x" } } });
        const event = dispatchSpy.mock.calls.at(-1)?.[0] as CustomEvent;
        expect(event.type).toBe("trilium:ws-message");
        expect(event.detail).toEqual({ kind: "x" });
    });

    it("relays HTTP_REQUEST to the native handler and posts the response", async () => {
        const bridge = await freshBridge();
        const handler = vi.fn().mockResolvedValue({ status: 200, headers: {}, body: "ok" });
        bridge.registerNativeHttpHandler(handler);
        bridge.startLocalServerWorker();
        const worker = lastWorker();
        worker.postMessage.mockClear();

        worker.onmessage?.({ data: { type: "HTTP_REQUEST", id: "1", request: { method: "GET", url: "u", headers: {} } } });
        await vi.waitFor(() => expect(worker.postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: "HTTP_RESPONSE", id: "1", status: 200 })));
    });

    it("posts an error when the native handler rejects", async () => {
        const bridge = await freshBridge();
        bridge.registerNativeHttpHandler(vi.fn().mockRejectedValue(new Error("net down")));
        bridge.startLocalServerWorker();
        const worker = lastWorker();
        worker.postMessage.mockClear();

        worker.onmessage?.({ data: { type: "HTTP_REQUEST", id: "2", request: {} } });
        await vi.waitFor(() => expect(worker.postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: "HTTP_RESPONSE", id: "2", error: "net down" })));
    });

    it("stringifies a non-Error rejection from the native handler", async () => {
        const bridge = await freshBridge();
        bridge.registerNativeHttpHandler(vi.fn().mockRejectedValue("plain rejection"));
        bridge.startLocalServerWorker();
        const worker = lastWorker();
        worker.postMessage.mockClear();

        worker.onmessage?.({ data: { type: "HTTP_REQUEST", id: "3", request: {} } });
        await vi.waitFor(() => expect(worker.postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: "HTTP_RESPONSE", id: "3", error: "plain rejection" })));
    });

    it("rejects pending requests on WORKER_ERROR and on worker onerror", async () => {
        vi.spyOn(console, "error").mockImplementation(() => {});
        const bridge = await freshBridge();
        bridge.startLocalServerWorker();
        const worker = lastWorker();

        // WORKER_ERROR path
        worker.onmessage?.({ data: { type: "WORKER_ERROR", error: { message: "crash" } } });
        // onerror path
        expect(() => worker.onerror?.({ message: "fatal" })).not.toThrow();
    });

    it("ignores messages without a recognized type", async () => {
        const bridge = await freshBridge();
        bridge.startLocalServerWorker();
        expect(() => lastWorker().onmessage?.({ data: { type: "NOPE" } })).not.toThrow();
        expect(() => lastWorker().onmessage?.({ data: null })).not.toThrow();
    });
});

describe("attachServiceWorkerBridge", () => {
    it("warns and skips when service workers are unavailable", async () => {
        const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
        const bridge = await freshBridge(false);
        bridge.attachServiceWorkerBridge();
        expect(warn).toHaveBeenCalled();
    });

    it("forwards a LOCAL_FETCH request to the worker and replies through the port", async () => {
        const bridge = await freshBridge();
        bridge.attachServiceWorkerBridge();
        expect(swHandler).toBeDefined();

        const port = { postMessage: vi.fn() };
        const body = new TextEncoder().encode("req").buffer;
        const pending = swHandler?.({
            data: { type: "LOCAL_FETCH", id: "42", request: { method: "POST", url: "/x", headers: {}, body } },
            ports: [port]
        });

        // The bridge posts a LOCAL_REQUEST to the worker; simulate its reply.
        const worker = lastWorker();
        await vi.waitFor(() => expect(worker.postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: "LOCAL_REQUEST", id: "42" }), expect.anything()));
        const responseBody = new TextEncoder().encode("resp").buffer;
        worker.onmessage?.({ data: { type: "LOCAL_RESPONSE", id: "42", response: { status: 200, headers: {}, body: responseBody } } });

        await pending;
        expect(port.postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: "LOCAL_FETCH_RESPONSE", id: "42" }), expect.anything());
    });

    it("replies with a 500 when forwarding throws", async () => {
        const bridge = await freshBridge();
        bridge.attachServiceWorkerBridge();
        const port = { postMessage: vi.fn() };

        // No body and a worker whose postMessage throws → the try block fails.
        bridge.startLocalServerWorker();
        lastWorker().postMessage.mockImplementation(() => { throw new Error("post failed"); });

        await swHandler?.({ data: { type: "LOCAL_FETCH", id: "7", request: { method: "GET", url: "/y", headers: {} } }, ports: [port] });
        expect(port.postMessage).toHaveBeenCalledWith(expect.objectContaining({ type: "LOCAL_FETCH_RESPONSE", id: "7", response: expect.objectContaining({ status: 500 }) }));
    });

    it("ignores non-LOCAL_FETCH messages and messages without a port", async () => {
        const bridge = await freshBridge();
        bridge.attachServiceWorkerBridge();
        expect(() => swHandler?.({ data: { type: "OTHER" } })).not.toThrow();
        expect(() => swHandler?.({ data: { type: "LOCAL_FETCH", id: "1", request: {} }, ports: [] })).not.toThrow();
    });

    it("replies without a transferable body when the worker omits one", async () => {
        const bridge = await freshBridge();
        bridge.attachServiceWorkerBridge();
        const port = { postMessage: vi.fn() };
        const pending = swHandler?.({ data: { type: "LOCAL_FETCH", id: "33", request: { method: "GET", url: "/z", headers: {} } }, ports: [port] });
        const worker = lastWorker();
        await vi.waitFor(() => expect(worker.postMessage).toHaveBeenCalledWith(expect.objectContaining({ id: "33" }), expect.anything()));
        worker.onmessage?.({ data: { type: "LOCAL_RESPONSE", id: "33", response: { status: 204, headers: {} } } });
        await pending;
        expect(port.postMessage).toHaveBeenCalledWith(expect.objectContaining({ id: "33" }), []);
    });

    it("stringifies a non-Error thrown while forwarding", async () => {
        const bridge = await freshBridge();
        bridge.attachServiceWorkerBridge();
        bridge.startLocalServerWorker();
        lastWorker().postMessage.mockImplementation(() => { throw "string failure"; });
        const port = { postMessage: vi.fn() };
        await swHandler?.({ data: { type: "LOCAL_FETCH", id: "9", request: { method: "GET", url: "/y", headers: {} } }, ports: [port] });
        expect(port.postMessage).toHaveBeenCalledWith(expect.objectContaining({ response: expect.objectContaining({ status: 500 }) }));
    });
});

describe("pending request rejection", () => {
    function startFetch(id: string): { port: { postMessage: ReturnType<typeof vi.fn> }; pending: unknown } {
        const port = { postMessage: vi.fn() };
        const pending = swHandler?.({ data: { type: "LOCAL_FETCH", id, request: { method: "GET", url: "/p", headers: {} } }, ports: [port] });
        return { port, pending };
    }

    it("rejects in-flight requests when the worker reports WORKER_ERROR", async () => {
        vi.spyOn(console, "error").mockImplementation(() => {});
        const bridge = await freshBridge();
        bridge.attachServiceWorkerBridge();
        const { port, pending } = startFetch("71");
        const worker = lastWorker();
        await vi.waitFor(() => expect(worker.postMessage).toHaveBeenCalledWith(expect.objectContaining({ id: "71" }), expect.anything()));
        worker.onmessage?.({ data: { type: "WORKER_ERROR", error: { message: "crash" } } });
        await pending;
        expect(port.postMessage).toHaveBeenCalledWith(expect.objectContaining({ response: expect.objectContaining({ status: 500 }) }));
    });

    it("rejects in-flight requests when the worker fires onerror", async () => {
        vi.spyOn(console, "error").mockImplementation(() => {});
        const bridge = await freshBridge();
        bridge.attachServiceWorkerBridge();
        const { port, pending } = startFetch("51");
        const worker = lastWorker();
        await vi.waitFor(() => expect(worker.postMessage).toHaveBeenCalledWith(expect.objectContaining({ id: "51" }), expect.anything()));
        worker.onerror?.({ message: "fatal" });
        await pending;
        expect(port.postMessage).toHaveBeenCalledWith(expect.objectContaining({ response: expect.objectContaining({ status: 500 }) }));
    });

    it("rejects a request when its LOCAL_RESPONSE carries an error", async () => {
        const bridge = await freshBridge();
        bridge.attachServiceWorkerBridge();
        const { port, pending } = startFetch("114");
        const worker = lastWorker();
        await vi.waitFor(() => expect(worker.postMessage).toHaveBeenCalledWith(expect.objectContaining({ id: "114" }), expect.anything()));
        worker.onmessage?.({ data: { type: "LOCAL_RESPONSE", id: "114", error: "boom" } });
        await pending;
        expect(port.postMessage).toHaveBeenCalledWith(expect.objectContaining({ response: expect.objectContaining({ status: 500 }) }));
    });

    it("falls back to a default message when WORKER_ERROR omits one", async () => {
        vi.spyOn(console, "error").mockImplementation(() => {});
        const bridge = await freshBridge();
        bridge.attachServiceWorkerBridge();
        const { port, pending } = startFetch("u1");
        const worker = lastWorker();
        await vi.waitFor(() => expect(worker.postMessage).toHaveBeenCalledWith(expect.objectContaining({ id: "u1" }), expect.anything()));
        worker.onmessage?.({ data: { type: "WORKER_ERROR" } });
        await pending;
        expect(port.postMessage).toHaveBeenCalledWith(expect.objectContaining({ response: expect.objectContaining({ status: 500 }) }));
    });

    it("ignores a LOCAL_RESPONSE for an unknown id and HTTP_REQUEST without a native handler", async () => {
        const bridge = await freshBridge();
        bridge.startLocalServerWorker();
        const worker = lastWorker();
        expect(() => worker.onmessage?.({ data: { type: "LOCAL_RESPONSE", id: "ghost", response: {} } })).not.toThrow();
        expect(() => worker.onmessage?.({ data: { type: "HTTP_REQUEST", id: "1", request: {} } })).not.toThrow();
    });
});

describe("localFetch", () => {
    it("posts a GET LOCAL_REQUEST with no body transfer and builds a Response from the reply", async () => {
        const bridge = await freshBridge();
        const promise = bridge.localFetch(new Request("http://x/api/notes"));

        const worker = lastWorker();
        await vi.waitFor(() => expect(worker.postMessage).toHaveBeenCalledWith(
            expect.objectContaining({ type: "LOCAL_REQUEST", request: expect.objectContaining({ method: "GET", body: null }) }),
            []
        ));

        const posted = worker.postMessage.mock.calls.at(-1)?.[0] as { id: string };
        const body = new TextEncoder().encode("hello").buffer;
        worker.onmessage?.({ data: { type: "LOCAL_RESPONSE", id: posted.id, response: { status: 201, headers: { "content-type": "text/plain" }, body } } });

        const res = await promise;
        expect(res.status).toBe(201);
        expect(res.headers.get("content-type")).toBe("text/plain");
        expect(await res.text()).toBe("hello");
    });

    it("transfers the body for non-GET requests and defaults a falsy status to 200", async () => {
        const bridge = await freshBridge();
        const promise = bridge.localFetch(new Request("http://x/api/notes", { method: "POST", body: "payload" }));

        const worker = lastWorker();
        await vi.waitFor(() => expect(worker.postMessage).toHaveBeenCalledWith(
            expect.objectContaining({ type: "LOCAL_REQUEST", request: expect.objectContaining({ method: "POST" }) }),
            [expect.any(ArrayBuffer)]
        ));

        const posted = worker.postMessage.mock.calls.at(-1)?.[0] as { id: string };
        worker.onmessage?.({ data: { type: "LOCAL_RESPONSE", id: posted.id, response: { status: 0, headers: {} } } });

        const res = await promise;
        expect(res.status).toBe(200);
    });

    it("builds a Response when the worker reply omits headers", async () => {
        const bridge = await freshBridge();
        const promise = bridge.localFetch(new Request("http://x/api/notes"));

        const worker = lastWorker();
        await vi.waitFor(() => expect(worker.postMessage).toHaveBeenCalledWith(
            expect.objectContaining({ type: "LOCAL_REQUEST" }),
            []
        ));

        const posted = worker.postMessage.mock.calls.at(-1)?.[0] as { id: string };
        // No `headers` field → the header-copy branch is skipped.
        worker.onmessage?.({ data: { type: "LOCAL_RESPONSE", id: posted.id, response: { status: 200 } } });

        const res = await promise;
        expect(res.status).toBe(200);
        expect(res.headers.get("content-type")).toBeNull();
    });
});

describe("isLocalApiRequest", () => {
    it("matches only the local API prefixes", async () => {
        const bridge = await freshBridge();
        for (const path of ["/bootstrap", "/api/notes", "/sync/changed", "/search/q"]) {
            expect(bridge.isLocalApiRequest(new URL(`http://x${path}`))).toBe(true);
        }
        expect(bridge.isLocalApiRequest(new URL("http://x/app.js"))).toBe(false);
        expect(bridge.isLocalApiRequest(new URL("http://x/"))).toBe(false);
    });
});
