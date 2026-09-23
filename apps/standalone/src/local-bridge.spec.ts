import { afterEach, describe, expect, it, vi } from "vitest";

// A controllable stand-in for the bundled local-server-worker. vi.hoisted lets the
// (hoisted) vi.mock factory share the instance registry with the test body.
const { workerInstances, leadership, saved } = vi.hoisted(() => ({
    workerInstances: [] as MockWorker[],
    // Most of this suite exercises the leader, which is the tab that owns the
    // worker. Followers take a different path — see the leadership describe.
    leadership: { isLeader: true },
    // What saveDatabase() handed the device, and what the device said back.
    saved: {
        fileName: "",
        chunks: [] as Uint8Array[],
        target: null as unknown,
        result: { status: "saved", location: "/documents/Trilium/db.tnbackup" } as {
            status: string;
            location?: string;
            message?: string;
        }
    }
}));

vi.mock("./leader_election.js", () => ({ isLeader: () => leadership.isLeader }));

// The Capacitor plugins are not there under happy-dom, and what matters on this side is which
// target the backup asked for and what reached it — see capacitor_download.spec.ts for the writing.
vi.mock("./services/capacitor_download.js", () => ({
    BACKUP_TARGET: { directory: "DOCUMENTS", folder: "Trilium", sweep: false },
    saveChunksToDevice: async (
        fileName: string, chunks: AsyncIterable<Uint8Array>, target: unknown
    ) => {
        saved.fileName = fileName;
        saved.target = target;
        saved.chunks = [];
        try {
            for await (const chunk of chunks) {
                saved.chunks.push(chunk);
            }
        } catch (e) {
            // The real one reports a broken source rather than rejecting; see its own spec.
            return { fileName, status: "failed", message: (e as Error).message };
        }
        return { fileName, ...saved.result };
    }
}));

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
    leadership.isLeader = true;
    saved.result = { status: "saved", location: "/documents/Trilium/db.tnbackup" };
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
    // Download frames pile up across tests otherwise: their removal timers never get to run.
    document.querySelectorAll("iframe").forEach((frame) => frame.remove());
    document.getElementById("trilium-error-overlay")?.remove();
    vi.restoreAllMocks();
});

describe("startup progress", () => {
    it("advances the splash as the worker reports its startup phases", async () => {
        document.body.innerHTML = `
            <div id="splash">
                <div class="splash-bar"><div class="splash-bar-fill"></div></div>
                <div id="splash-status"></div>
            </div>`;
        const bridge = await freshBridge();
        const { initSplashProgress } = await import("../../client/src/services/splash.js");
        initSplashProgress([
            { id: "sqlite", weight: 1, status: "Loading the database engine…" },
            { id: "core", weight: 1, status: "Loading Trilium…" },
            { id: "application", weight: 2, status: "Loading the application…" }
        ]);

        bridge.startLocalServerWorker();
        lastWorker().onmessage?.({ data: { type: "STARTUP_PROGRESS", phase: "core" } });

        expect(document.getElementById("splash-status")?.textContent).toBe("Loading Trilium…");
        expect(document.querySelector<HTMLElement>(".splash-bar-fill")?.style.width).toBe("50%");

        document.body.innerHTML = "";
    });
});

describe("startLocalServerWorker", () => {
    it("creates the worker once and sends an INIT message", async () => {
        const bridge = await freshBridge();
        const worker = bridge.startLocalServerWorker();
        expect(workerInstances).toHaveLength(1);
        expect(worker.postMessage).toHaveBeenCalledWith(
            expect.objectContaining({ type: "INIT", useNativeHttp: false }),
            // The security channel's worker end, transferred rather than copied.
            [ expect.anything() ]
        );

        // Second call returns the same instance without creating another worker.
        expect(bridge.startLocalServerWorker()).toBe(worker);
        expect(workerInstances).toHaveLength(1);
    });

    it("flags native HTTP when a handler was registered first", async () => {
        const bridge = await freshBridge();
        bridge.registerNativeHttpHandler(vi.fn());
        bridge.startLocalServerWorker();
        expect(lastWorker().postMessage).toHaveBeenCalledWith(
            expect.objectContaining({ useNativeHttp: true }),
            [ expect.anything() ]
        );
    });
});

describe("worker message handling", () => {
    it("shows an error overlay on FATAL_ERROR", async () => {
        vi.spyOn(console, "error").mockImplementation(() => {});
        const bridge = await freshBridge();
        bridge.startLocalServerWorker();
        lastWorker().onmessage?.({ data: { type: "FATAL_ERROR", message: "boom" } });
        const overlay = document.getElementById("trilium-error-overlay");
        expect(overlay?.textContent).toContain("boom");
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

    it("shows an overlay and rejects pending requests on WORKER_ERROR", async () => {
        vi.spyOn(console, "error").mockImplementation(() => {});
        const bridge = await freshBridge();
        bridge.startLocalServerWorker();

        lastWorker().onmessage?.({ data: { type: "WORKER_ERROR", error: { message: "crash", stack: "at boom" } } });

        const overlay = document.getElementById("trilium-error-overlay");
        expect(overlay?.textContent).toContain("crash");
        expect(overlay?.textContent).toContain("at boom");
    });

    it("shows an overlay on worker onerror without throwing", async () => {
        vi.spyOn(console, "error").mockImplementation(() => {});
        const bridge = await freshBridge();
        bridge.startLocalServerWorker();

        expect(() => lastWorker().onerror?.({ message: "fatal" })).not.toThrow();
        expect(document.getElementById("trilium-error-overlay")?.textContent).toContain("fatal");
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

    it("relays a backup download's port straight to the worker, transferred", async () => {
        const bridge = await freshBridge();
        bridge.attachServiceWorkerBridge();

        const port = { postMessage: vi.fn() };
        await swHandler?.({ data: { type: "LOCAL_BACKUP_STREAM" }, ports: [port] });

        expect(lastWorker().postMessage)
            .toHaveBeenCalledWith(expect.objectContaining({ type: "BACKUP_STREAM", port }), [ port ]);

        // Without a port there is nothing to relay, and nothing to trip over either.
        expect(() => swHandler?.({ data: { type: "LOCAL_BACKUP_STREAM" }, ports: [] })).not.toThrow();
    });

    it("hands the passphrase to the worker on the relayed message, and only once", async () => {
        const bridge = await freshBridge();
        bridge.attachServiceWorkerBridge();
        void bridge.downloadDatabase("Backup.tnbackup", "123456");

        const port = { postMessage: vi.fn() };
        await swHandler?.({ data: { type: "LOCAL_BACKUP_STREAM" }, ports: [port] });
        expect(lastWorker().postMessage).toHaveBeenCalledWith(
            expect.objectContaining({ type: "BACKUP_STREAM", passphrase: "123456" }), [ port ]);

        // A stream that arrives with no download of its own gets no leftover passphrase.
        const secondPort = { postMessage: vi.fn() };
        await swHandler?.({ data: { type: "LOCAL_BACKUP_STREAM" }, ports: [secondPort] });
        expect(lastWorker().postMessage).toHaveBeenLastCalledWith(
            expect.objectContaining({ type: "BACKUP_STREAM", passphrase: undefined }), [ secondPort ]);
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
        // `/custom/` carries custom request handlers and resource providers, which a frontend
        // script reaches with a plain fetch rather than through `server.ts`.
        for (const path of ["/bootstrap", "/api/notes", "/sync/changed", "/search/q", "/custom/my-handler"]) {
            expect(bridge.isLocalApiRequest(new URL(`http://x${path}`))).toBe(true);
        }
        expect(bridge.isLocalApiRequest(new URL("http://x/app.js"))).toBe(false);
        expect(bridge.isLocalApiRequest(new URL("http://x/"))).toBe(false);
    });
});

describe("backup download keepalive", () => {
    it("pings the service worker for exactly as long as the worker says a stream runs", async () => {
        vi.useFakeTimers();
        const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null));
        const bridge = await freshBridge();
        void bridge.downloadDatabase("Backup.tnbackup");

        lastWorker().onmessage?.({ data: { type: "BACKUP_STREAM_ACTIVE", active: true } });
        await vi.advanceTimersByTimeAsync(25_000);
        expect(fetchSpy).toHaveBeenCalledWith("/local-backup-ping");
        expect(fetchSpy).toHaveBeenCalledTimes(2);

        lastWorker().onmessage?.({ data: { type: "BACKUP_STREAM_ACTIVE", active: false } });
        await vi.advanceTimersByTimeAsync(60_000);
        expect(fetchSpy).toHaveBeenCalledTimes(2);

        vi.useRealTimers();
    });

    it("does not ping for a stream the page consumes itself", async () => {
        vi.useFakeTimers();
        const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null));
        const bridge = await freshBridge();
        bridge.startLocalServerWorker();

        // saveDatabase() holds the stream open in the page, so there is no service worker waiting
        // on it — and on iOS there is no service worker at all.
        lastWorker().onmessage?.({ data: { type: "BACKUP_STREAM_ACTIVE", active: true } });
        await vi.advanceTimersByTimeAsync(60_000);

        expect(fetchSpy).not.toHaveBeenCalled();
        vi.useRealTimers();
    });
});

describe("downloadDatabase", () => {
    it("navigates a hidden frame at the download URL, and starts the worker for it", async () => {
        vi.useFakeTimers();
        const bridge = await freshBridge();

        void bridge.downloadDatabase("Backup 2026-08-08 10-00-00.db");

        // A frame rather than an anchor: anchor downloads bypass the service worker in Firefox.
        const frame = document.querySelector("iframe");
        expect(frame?.hidden).toBe(true);
        expect(frame?.src).toContain(
            `/local-backup-download?fileName=${encodeURIComponent("Backup 2026-08-08 10-00-00.db")}`);
        expect(workerInstances.length).toBe(1);

        // The frame outlives the service worker's whole wait for the stream, then goes.
        await vi.advanceTimersByTimeAsync(59_000);
        expect(document.querySelector("iframe")).not.toBeNull();
        await vi.advanceTimersByTimeAsync(2_000);
        expect(document.querySelector("iframe")).toBeNull();

        vi.useRealTimers();
    });

    it("resolves with the outcome the worker reports when the stream ends", async () => {
        const bridge = await freshBridge();
        const pending = bridge.downloadDatabase("Backup.tnbackup");

        lastWorker().onmessage?.({ data: { type: "BACKUP_STREAM_ACTIVE", active: true } });
        lastWorker().onmessage?.({
            data: { type: "BACKUP_STREAM_ACTIVE", active: false, result: { status: "done" } }
        });

        expect(await pending).toEqual({ status: "done" });
    });

    it("resolves as failed when nothing ever picks the download up", async () => {
        vi.useFakeTimers();
        const bridge = await freshBridge();
        const pending = bridge.downloadDatabase("Backup.tnbackup");

        // The chain died silently inside the hidden frame; no worker message ever arrives.
        await vi.advanceTimersByTimeAsync(46_000);

        expect(await pending).toMatchObject({ status: "failed" });
        vi.useRealTimers();
    });
});

describe("saveDatabase", () => {
    /** What the bridge asked the worker to stream, including the port to play it down. */
    function backupMessage(worker: MockWorker): { port?: MessagePort; passphrase?: string } {
        return worker.postMessage.mock.calls
            .map(([ message ]) => message as { type: string; port?: MessagePort; passphrase?: string })
            .find((message) => message.type === "BACKUP_STREAM") ?? {};
    }

    /** The port the bridge handed the worker, played from the worker's side. */
    function backupPort(worker: MockWorker): MessagePort {
        const port = backupMessage(worker).port;
        if (!port) {
            throw new Error("no BACKUP_STREAM sent");
        }
        return port;
    }

    /** Answers the bridge's pulls with `chunks`, then ends — what the local worker does. */
    function serveStream(port: MessagePort, chunks: Uint8Array[]) {
        let next = 0;
        port.onmessage = (event) => {
            const message = event.data as { type?: string };
            if (message?.type !== "pull") {
                return;
            }
            if (next < chunks.length) {
                const chunk = chunks[next++];
                port.postMessage({ type: "chunk", data: chunk.buffer.slice(0) });
            } else {
                port.postMessage({ type: "end" });
            }
        };
        port.postMessage({ type: "begin", byteSize: chunks.reduce((sum, c) => sum + c.length, 0) });
    }

    it("streams the backup to the device and reports where it went", async () => {
        const bridge = await freshBridge();
        const progress: number[] = [];
        const pending = bridge.saveDatabase("db.tnbackup", "hunter2", (sent) => progress.push(sent));

        // The dynamic import of the save module resolves before the stream is asked for.
        await vi.waitFor(() => backupPort(lastWorker()));
        serveStream(backupPort(lastWorker()), [ Uint8Array.from([ 1, 2, 3 ]), Uint8Array.from([ 4, 5 ]) ]);
        lastWorker().onmessage?.({
            data: { type: "BACKUP_STREAM_PROGRESS", sentBytes: 3, totalBytes: 5 }
        });

        expect(await pending).toEqual({ status: "done", location: "/documents/Trilium/db.tnbackup" });
        expect(saved.chunks).toEqual([ Uint8Array.from([ 1, 2, 3 ]), Uint8Array.from([ 4, 5 ]) ]);
        expect(saved.fileName).toBe("db.tnbackup");
        // Documents, not the share sheet's scratch directory: a backup outlives the sheet.
        expect(saved.target).toMatchObject({ directory: "DOCUMENTS", sweep: false });
        // The passphrase rides the worker message rather than any URL.
        expect(backupMessage(lastWorker()).passphrase).toBe("hunter2");
        expect(progress).toEqual([ 3 ]);
    });

    it("is done, not cancelled, when the user dismisses the share sheet", async () => {
        const bridge = await freshBridge();
        saved.result = { status: "cancelled", location: "/documents/Trilium/db.tnbackup" };
        const pending = bridge.saveDatabase("db.tnbackup");

        await vi.waitFor(() => backupPort(lastWorker()));
        serveStream(backupPort(lastWorker()), [ Uint8Array.from([ 1 ]) ]);

        // The file was written before the sheet opened, so there is a backup either way.
        expect(await pending).toEqual({ status: "done", location: "/documents/Trilium/db.tnbackup" });
    });

    it("fails when the stream never begins, and refuses outright in a follower tab", async () => {
        const bridge = await freshBridge();
        const pending = bridge.saveDatabase("db.tnbackup");

        await vi.waitFor(() => backupPort(lastWorker()));
        backupPort(lastWorker()).postMessage({ type: "error", message: "The database is not ready yet." });

        expect(await pending).toMatchObject({
            status: "failed",
            message: "The database is not ready yet."
        });

        leadership.isLeader = false;
        expect(await bridge.saveDatabase("db.tnbackup")).toMatchObject({ status: "failed" });
    });
});

describe("restoreBackup", () => {
    /** The message the bridge sent to the worker to start a restore. */
    function restoreMessage(worker: MockWorker) {
        const sent = worker.postMessage.mock.calls
            .map(([ message ]) => message as { type: string; id: string; backup?: File; passphrase?: string })
            .find((message) => message.type === "RESTORE_BACKUP");
        if (!sent) {
            throw new Error("no restore was started");
        }

        return sent;
    }

    it("hands the file itself to the worker, rather than anything read out of it", async () => {
        const bridge = await freshBridge();
        const backup = new File([ "database bytes" ], "backup.db");

        void bridge.restoreBackup({ backup, passphrase: "hunter2" });

        const sent = restoreMessage(lastWorker());
        // The same File, not a copy: structured cloning passes it by reference, which is the whole
        // reason this does not go through the request path.
        expect(sent.backup).toBe(backup);
        expect(sent.passphrase).toBe("hunter2");
        // No transfer list, since a File is not transferable and must not be treated as one.
        expect(lastWorker().postMessage).toHaveBeenLastCalledWith(sent);
    });

    it("relays what the worker reports, and settles on the outcome", async () => {
        const bridge = await freshBridge();
        const seen: unknown[] = [];
        const restoring = bridge.restoreBackup({
            backup: new File([ "bytes" ], "backup.db"),
            onProgress: (progress) => seen.push(progress)
        });
        const worker = lastWorker();
        const { id } = restoreMessage(worker);

        worker.onmessage?.({ data: { type: "RESTORE_PROGRESS", id, progress: { stage: "staging", fraction: 0.5 } } });
        worker.onmessage?.({ data: { type: "RESTORE_RESULT", id, result: { status: "restored" } } });

        await expect(restoring).resolves.toEqual({ status: "restored" });
        expect(seen).toEqual([ { stage: "staging", fraction: 0.5 } ]);
    });

    it("keeps two restores apart, and stops listening once one has answered", async () => {
        const bridge = await freshBridge();
        const first = bridge.restoreBackup({ backup: new File([ "one" ], "one.db") });
        const worker = lastWorker();
        const { id } = restoreMessage(worker);

        worker.onmessage?.({ data: { type: "RESTORE_RESULT", id, result: { status: "restored" } } });
        await expect(first).resolves.toEqual({ status: "restored" });

        // A late or repeated answer for a restore that is over has nobody to tell, and must not throw.
        expect(() => worker.onmessage?.({ data: { type: "RESTORE_RESULT", id, result: { status: "error" } } }))
            .not.toThrow();
        // Nor does a message for a restore that was never started.
        expect(() => worker.onmessage?.({ data: { type: "RESTORE_PROGRESS", id: "other", progress: {} } }))
            .not.toThrow();
    });

    it("refuses in a follower rather than opening a second database", async () => {
        const bridge = await freshBridge();
        leadership.isLeader = false;

        await expect(bridge.restoreBackup({ backup: new File([ "bytes" ], "backup.db") }))
            .rejects.toThrow(/tab that owns the database/);
        expect(workerInstances).toHaveLength(0);
    });
});

describe("leadership", () => {
    it("a follower refuses to serve and never starts a worker", async () => {
        const bridge = await freshBridge();
        bridge.attachServiceWorkerBridge();
        leadership.isLeader = false;

        const port = { postMessage: vi.fn() };
        await swHandler?.({
            data: { type: "LOCAL_FETCH", id: "9", request: { method: "GET", url: "/api/x", headers: {} } },
            ports: [port]
        });

        // Starting a worker here would open a second database against the same
        // OPFS pool — the exact failure leadership exists to prevent.
        expect(workerInstances).toHaveLength(0);
        expect(port.postMessage).toHaveBeenCalledWith({ type: "NOT_LEADER", id: "9" });
    });

    it("answers the service worker's leader probe", async () => {
        const bridge = await freshBridge();
        bridge.attachServiceWorkerBridge();

        const leaderPort = { postMessage: vi.fn() };
        await swHandler?.({ data: { type: "WHO_IS_LEADER" }, ports: [leaderPort] });
        expect(leaderPort.postMessage).toHaveBeenCalledWith({ type: "LEADER_REPLY", isLeader: true });

        leadership.isLeader = false;
        const followerPort = { postMessage: vi.fn() };
        await swHandler?.({ data: { type: "WHO_IS_LEADER" }, ports: [followerPort] });
        expect(followerPort.postMessage).toHaveBeenCalledWith({ type: "LEADER_REPLY", isLeader: false });
    });

    it("a follower refuses a backup stream rather than starting a worker for it", async () => {
        const bridge = await freshBridge();
        bridge.attachServiceWorkerBridge();
        leadership.isLeader = false;

        const port = { postMessage: vi.fn() };
        await swHandler?.({ data: { type: "LOCAL_BACKUP_STREAM" }, ports: [port] });

        expect(workerInstances).toHaveLength(0);
        // Said on the port, so the download answers 503 instead of hanging on a stream
        // no worker will ever produce.
        expect(port.postMessage).toHaveBeenCalledWith(
            expect.objectContaining({ type: "error" }));
    });

    it("a follower refuses to download a backup, since the passphrase never leaves its tab", async () => {
        const bridge = await freshBridge();
        leadership.isLeader = false;

        const result = await bridge.downloadDatabase("Backup.tnbackup", "123456");

        expect(result).toMatchObject({ status: "failed" });
        expect(workerInstances).toHaveLength(0);
        // Nothing was navigated either: a frame would have downloaded an unencrypted backup.
        expect(document.querySelector("iframe")).toBeNull();
    });

    it("announceLeadership tells the controlling service worker", async () => {
        const bridge = await freshBridge();
        const controller = { postMessage: vi.fn() };
        Object.defineProperty(navigator, "serviceWorker", {
            value: { addEventListener: vi.fn(), controller },
            configurable: true
        });

        bridge.announceLeadership();
        expect(controller.postMessage).toHaveBeenCalledWith({ type: "LEADER_ANNOUNCE" });
    });

    it("survives announcing with no controlling service worker", async () => {
        const bridge = await freshBridge(false);
        expect(() => bridge.announceLeadership()).not.toThrow();
    });
});

describe("security settings", () => {
    /**
     * The worker's end of the security channel, handed over with INIT.
     *
     * A channel of its own rather than the worker's message handler, because that handler is
     * reachable from inside the worker: backend scripts run through `eval()` in its realm, so a
     * command sitting on `self.onmessage` is one a script can issue without the browser ever
     * drawing its confirmation dialog.
     */
    function securityPort(worker: MockWorker): MessagePort {
        const init = worker.postMessage.mock.calls
            .map(([message]) => message as { type: string; securityPort?: MessagePort })
            .find((message) => message.type === "INIT");
        if (!init?.securityPort) {
            throw new Error("INIT carried no security port");
        }
        return init.securityPort;
    }

    /** What the page sent over that channel, as the worker would see it. */
    type SecurityChange = { id: string; setting: string; enabled: boolean };

    function changesSentTo(port: MessagePort): Promise<SecurityChange[]> {
        const seen: SecurityChange[] = [];
        port.onmessage = (event) => {
            const msg = event.data as SecurityChange & { type: string };
            if (msg?.type === "SECURITY_SET") {
                seen.push(msg);
            }
        };
        return vi.waitFor(() => {
            expect(seen.length).toBeGreaterThan(0);
            return seen;
        });
    }

    it("sends the change over the port, and answers what the worker wrote", async () => {
        const bridge = await freshBridge();
        const port = securityPort(bridge.startLocalServerWorker() as unknown as MockWorker);
        const seen = changesSentTo(port);

        const change = bridge.requestSecurityChange("backendScriptingEnabled", true);
        const [ sent ] = await seen;
        expect(sent).toMatchObject({ setting: "backendScriptingEnabled", enabled: true });

        port.postMessage({ type: "SECURITY_SET_RESULT", id: sent.id, written: true });
        await expect(change).resolves.toBe(true);
    });

    it("never puts the change on the worker's own message handler", async () => {
        const bridge = await freshBridge();
        const worker = bridge.startLocalServerWorker() as unknown as MockWorker;
        const seen = changesSentTo(securityPort(worker));

        bridge.requestSecurityChange("backendScriptingEnabled", true);
        await seen;

        // Only INIT ever goes to the worker itself. A SECURITY_SET there would be a command a
        // backend script could issue for itself, since eval() runs in the worker's realm.
        const toWorker = worker.postMessage.mock.calls
            .map(([message]) => (message as { type: string }).type);
        expect(toWorker).not.toContain("SECURITY_SET");
    });

    it("answers no when the worker refused to write it", async () => {
        const bridge = await freshBridge();
        const port = securityPort(bridge.startLocalServerWorker() as unknown as MockWorker);
        const seen = changesSentTo(port);

        const change = bridge.requestSecurityChange("sqlConsoleEnabled", true);
        const [ sent ] = await seen;
        // A worker whose settings file is not locked reports the change as unwritten rather than
        // pretending; anything but an outright `true` leaves the setting where it was.
        port.postMessage({ type: "SECURITY_SET_RESULT", id: sent.id, written: "yes" });

        await expect(change).resolves.toBe(false);
    });

    it("ignores a result that answers a different change", async () => {
        const bridge = await freshBridge();
        const port = securityPort(bridge.startLocalServerWorker() as unknown as MockWorker);
        const change = bridge.requestSecurityChange("backendScriptingEnabled", true);

        port.postMessage({ type: "SECURITY_SET_RESULT", id: "some other change", written: true });

        let settled = false;
        void change.then(() => { settled = true; });
        await new Promise((resolve) => setTimeout(resolve, 10));
        expect(settled).toBe(false);
    });

    it("gives up rather than hanging when the worker never answers", async () => {
        vi.useFakeTimers();
        try {
            const bridge = await freshBridge();
            const change = bridge.requestSecurityChange("backendScriptingEnabled", true);

            await vi.advanceTimersByTimeAsync(30_000);

            await expect(change).resolves.toBe(false);
        } finally {
            vi.useRealTimers();
        }
    });

    it("a follower writes nothing, since the file belongs to the leader's worker", async () => {
        const bridge = await freshBridge();
        leadership.isLeader = false;

        await expect(bridge.requestSecurityChange("backendScriptingEnabled", true)).resolves.toBe(false);

        // No worker either: one here would open a second database against the same OPFS pool.
        expect(workerInstances).toHaveLength(0);
    });
});

describe("cross-tab ws relay", () => {
    it("relays the worker's ws messages to the other tabs", async () => {
        const posted: unknown[] = [];
        class MockBroadcastChannel {
            onmessage: ((e: { data: unknown }) => void) | null = null;
            postMessage = vi.fn((m: unknown) => { posted.push(m); });
            close = vi.fn();
        }
        vi.stubGlobal("BroadcastChannel", MockBroadcastChannel);

        const bridge = await freshBridge();
        bridge.startLocalServerWorker();
        lastWorker().onmessage?.({ data: { type: "WS_MESSAGE", message: { kind: "entity-change" } } });

        // Only the leader has a worker, so without this relay a follower would
        // never learn the entity changed.
        expect(posted).toEqual([{ kind: "entity-change" }]);
        vi.unstubAllGlobals();
    });

    it("dispatches a relayed message into this tab", async () => {
        const channels: MockBroadcastChannel[] = [];
        class MockBroadcastChannel {
            onmessage: ((e: { data: unknown }) => void) | null = null;
            postMessage = vi.fn();
            close = vi.fn();
            constructor() { channels.push(this); }
        }
        vi.stubGlobal("BroadcastChannel", MockBroadcastChannel);

        const bridge = await freshBridge();
        bridge.attachServiceWorkerBridge();
        const dispatchSpy = vi.spyOn(window, "dispatchEvent");

        channels.at(-1)?.onmessage?.({ data: { kind: "from-leader" } });

        const event = dispatchSpy.mock.calls.at(-1)?.[0] as CustomEvent;
        expect(event.type).toBe("trilium:ws-message");
        expect(event.detail).toEqual({ kind: "from-leader" });
        vi.unstubAllGlobals();
    });

    it("works when BroadcastChannel is unavailable", async () => {
        vi.stubGlobal("BroadcastChannel", undefined);
        const bridge = await freshBridge();
        bridge.startLocalServerWorker();

        expect(() => lastWorker().onmessage?.({ data: { type: "WS_MESSAGE", message: { kind: "x" } } })).not.toThrow();
        vi.unstubAllGlobals();
    });
});
