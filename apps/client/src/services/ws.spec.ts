import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { WebSocketMessage } from "@triliumnext/commons";
import { buildNote } from "../test/easy-froca";

// Mutable spies the mocked dependencies delegate to, so we can assert on them
// and swap behaviour per test without re-mocking.
const toast = vi.hoisted(() => ({
    showError: vi.fn(),
    showMessage: vi.fn(),
    showPersistent: vi.fn(),
    closePersistent: vi.fn()
}));
const bundle = vi.hoisted(() => ({ getAndExecuteBundle: vi.fn() }));
const appCtx = vi.hoisted(() => ({ triggerEvent: vi.fn() }));
const frocaUpdater = vi.hoisted(() => ({ processEntityChanges: vi.fn(async () => {}) }));
const utilsCtrl = vi.hoisted(() => ({
    reloadFrontendApp: vi.fn(),
    timeLimit: vi.fn(async (p: Promise<unknown>, _ms?: number) => p)
}));
const optionsCtrl = vi.hoisted(() => ({ is: vi.fn(() => false) }));

vi.mock("./toast.js", () => ({ default: toast }));
vi.mock("./bundle.js", () => ({ default: bundle }));
vi.mock("../components/app_context.js", () => ({ default: appCtx }));
vi.mock("./froca_updater.js", () => ({ default: frocaUpdater }));
vi.mock("./options.js", () => ({ default: optionsCtrl }));
vi.mock("./utils.js", async (orig) => {
    const actual = (await orig()) as Record<string, unknown>;
    return {
        ...actual,
        default: {
            ...(actual.default as object),
            now: () => "now",
            reloadFrontendApp: (...args: unknown[]) => utilsCtrl.reloadFrontendApp(...args),
            timeLimit: (...args: [Promise<unknown>, number]) => utilsCtrl.timeLimit(...args)
        }
    };
});

type WsModule = typeof import("./ws.js");

/** Loads the REAL ws module (setup.ts globally mocks ./ws.js). */
async function loadWs(): Promise<WsModule> {
    return (await vi.importActual<WsModule>("./ws.js"));
}

const baseGlob = { isMainWindow: true } as any;

beforeEach(() => {
    vi.clearAllMocks();
    optionsCtrl.is.mockReturnValue(false);
    utilsCtrl.timeLimit.mockImplementation(async (p: Promise<unknown>) => p);
    frocaUpdater.processEntityChanges.mockImplementation(async () => {});
    (window as any).glob = { ...baseGlob };
    delete (window as any).electronApi;
});

afterEach(() => {
    vi.useRealTimers();
});

describe("dispatchMessage", () => {
    it("notifies subscribers and unsubscribes correctly", async () => {
        const ws = await loadWs();
        const received: WebSocketMessage[] = [];
        const handler = (m: WebSocketMessage) => received.push(m);
        ws.subscribeToMessages(handler);

        const ping = { type: "ping" } as WebSocketMessage;
        await ws.dispatchMessage(ping);
        expect(received).toEqual([ping]);

        ws.unsubscribeToMessage(handler);
        await ws.dispatchMessage({ type: "ping" } as WebSocketMessage);
        // unsubscribed -> no further messages
        expect(received).toEqual([ping]);
    });

    it("routes each message type to the right side effect", async () => {
        const ws = await loadWs();

        await ws.dispatchMessage({ type: "reload-frontend", reason: "x" } as WebSocketMessage);
        expect(utilsCtrl.reloadFrontendApp).toHaveBeenCalledWith(expect.stringContaining("reload"));

        await ws.dispatchMessage({ type: "sync-hash-check-failed" } as any);
        await ws.dispatchMessage({ type: "consistency-checks-failed" } as any);
        expect(toast.showError).toHaveBeenCalledTimes(2);

        await ws.dispatchMessage({ type: "api-log-messages", noteId: "n1", messages: ["a"] } as any);
        expect(appCtx.triggerEvent).toHaveBeenCalledWith("apiLogMessages", { noteId: "n1", messages: ["a"] });

        await ws.dispatchMessage({ type: "toast", message: "hi", timeout: 5 } as any);
        expect(toast.showMessage).toHaveBeenCalledWith("hi", 5);
    });

    it("execute-script resolves the origin entity from froca when an id is present", async () => {
        const ws = await loadWs();
        const note = buildNote({ title: "Origin" });

        await ws.dispatchMessage({
            type: "execute-script",
            originEntityId: note.noteId,
            currentNoteId: "cur",
            script: "return 1;",
            params: [1, 2]
        } as any);
        expect(bundle.getAndExecuteBundle).toHaveBeenCalledWith("cur", note, "return 1;", [1, 2]);
    });

    it("execute-script passes a null origin entity when no id is provided", async () => {
        const ws = await loadWs();

        await ws.dispatchMessage({
            type: "execute-script",
            currentNoteId: "cur2",
            script: "x",
            params: []
        } as any);
        expect(bundle.getAndExecuteBundle).toHaveBeenCalledWith("cur2", null, "x", []);
    });

    it("ignores unknown message types", async () => {
        const ws = await loadWs();
        await ws.dispatchMessage({ type: "totally-unknown" } as any);
        expect(toast.showError).not.toHaveBeenCalled();
        expect(bundle.getAndExecuteBundle).not.toHaveBeenCalled();
    });
});

describe("frontend-update / executeFrontendUpdate", () => {
    it("does nothing extra when there are no entity changes", async () => {
        const ws = await loadWs();
        await ws.dispatchMessage({ type: "frontend-update", data: { entityChanges: [] } } as any);
        expect(frocaUpdater.processEntityChanges).not.toHaveBeenCalled();
    });

    it("queues changes, tracks accepted ids and processes them once", async () => {
        const ws = await loadWs();
        const changes = [
            { id: 5, entityName: "notes", entityId: "n1", isSynced: true },
            { id: 7, entityName: "options", entityId: "openNoteContexts", isSynced: false },
            { id: undefined, entityName: "notes", entityId: "n2" }
        ];
        await ws.dispatchMessage({ type: "frontend-update", data: { entityChanges: changes } } as any);

        expect(frocaUpdater.processEntityChanges).toHaveBeenCalledTimes(1);
        // synced id 5 advances the sync watermark
        expect(ws.default.getMaxKnownEntityChangeSyncId()).toBeGreaterThanOrEqual(5);

        // re-dispatching the same already-processed ids is a no-op for the updater
        frocaUpdater.processEntityChanges.mockClear();
        await ws.dispatchMessage({ type: "frontend-update", data: { entityChanges: [{ id: 5, entityName: "notes", entityId: "n1" }] } } as any);
        expect(frocaUpdater.processEntityChanges).toHaveBeenCalledWith([]);
    });

    it("reloads the frontend when processing fails outside dev/debug mode", async () => {
        const ws = await loadWs();
        utilsCtrl.timeLimit.mockRejectedValueOnce(Object.assign(new Error("boom"), { stack: "stk" }));
        optionsCtrl.is.mockReturnValue(false);
        (window as any).glob.isDev = false;

        await ws.dispatchMessage({ type: "frontend-update", data: { entityChanges: [{ id: 101, entityName: "notes", entityId: "nA" }] } } as any);
        expect(utilsCtrl.reloadFrontendApp).toHaveBeenCalled();
    });

    it("shows a toast instead of reloading when debug mode is enabled", async () => {
        const ws = await loadWs();
        utilsCtrl.timeLimit.mockRejectedValueOnce(Object.assign(new Error("boom2"), { stack: "stk" }));
        optionsCtrl.is.mockReturnValue(true);
        (window as any).glob.isDev = false;

        await ws.dispatchMessage({ type: "frontend-update", data: { entityChanges: [{ id: 102, entityName: "notes", entityId: "nB" }] } } as any);
        expect(toast.showError).toHaveBeenCalled();
        expect(utilsCtrl.reloadFrontendApp).not.toHaveBeenCalled();
    });

    it("serializes concurrent updates, and a later consumer finds the queue already drained", async () => {
        const ws = await loadWs();
        let resolveFirst!: () => void;
        // Hold the first consumer open so the 2nd and 3rd dispatches both queue
        // their changes behind it. When the first consumer's body finally runs,
        // it drains ALL queued changes; the trailing consumer then sees an empty
        // queue (the false branch of `frontendUpdateDataQueue.length > 0`).
        frocaUpdater.processEntityChanges
            .mockImplementationOnce(() => new Promise<void>((res) => { resolveFirst = () => res(); }))
            .mockImplementation(async () => {});

        const p1 = ws.dispatchMessage({ type: "frontend-update", data: { entityChanges: [{ id: 201, entityName: "notes", entityId: "q1" }] } } as any);
        await Promise.resolve();
        const p2 = ws.dispatchMessage({ type: "frontend-update", data: { entityChanges: [{ id: 202, entityName: "notes", entityId: "q2" }] } } as any);
        const p3 = ws.dispatchMessage({ type: "frontend-update", data: { entityChanges: [{ id: 203, entityName: "notes", entityId: "q3" }] } } as any);

        resolveFirst();
        await Promise.all([p1, p2, p3]);
        // first consumer (held) processed q1; the second consumer drained q2+q3;
        // the third consumer found nothing left -> only 2 real processing calls
        expect(frocaUpdater.processEntityChanges).toHaveBeenCalledTimes(2);
    });
});

describe("waitForMaxKnownEntityChangeId", () => {
    it("resolves immediately when the desired id is already processed", async () => {
        const ws = await loadWs();
        const server = (await import("./server.js")).default;
        server.getMaxKnownEntityChangeId = vi.fn(() => 0);
        await expect(ws.default.waitForMaxKnownEntityChangeId()).resolves.toBeUndefined();
    });

    it("waits for a pending id and resolves once changes catch up", async () => {
        const ws = await loadWs();
        const server = (await import("./server.js")).default;
        // pick an id far above whatever has been processed by earlier tests
        server.getMaxKnownEntityChangeId = vi.fn(() => 999999);

        let resolved = false;
        const wait = ws.default.waitForMaxKnownEntityChangeId().then(() => { resolved = true; });

        // not yet
        await Promise.resolve();
        expect(resolved).toBe(false);

        // a frontend-update past the desired id triggers checkEntityChangeIdListeners
        await ws.dispatchMessage({ type: "frontend-update", data: { entityChanges: [{ id: 999999, entityName: "notes", entityId: "catchup" }] } } as any);
        await wait;
        expect(resolved).toBe(true);
    });
});

describe("logError / logInfo / throwError and outgoing transport", () => {
    it("throwError logs and throws", async () => {
        const ws = await loadWs();
        const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
        expect(() => ws.throwError("kaboom")).toThrow("kaboom");
        expect(errSpy).toHaveBeenCalled();
    });

    it("window.logError / window.logInfo are wired up", async () => {
        await loadWs();
        const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
        const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
        (window as any).logError("oops");
        (window as any).logInfo("note");
        expect(errSpy).toHaveBeenCalled();
        expect(logSpy).toHaveBeenCalled();
    });

    it("sends outgoing log messages over the IPC bridge when present", async () => {
        const send = vi.fn();
        (window as any).electronApi = { ws: { send, onMessage: vi.fn() } };
        vi.resetModules();
        const ws = await loadWs();
        vi.spyOn(console, "error").mockImplementation(() => {});

        ws.logError("via-ipc");
        expect(send).toHaveBeenCalledWith(expect.objectContaining({ type: "log-error", error: "via-ipc" }));
    });
});

// --- Transport / module-load scenarios -------------------------------------
// The `connectWebSocket`/`sendPing` paths and the top-level connection
// bootstrap only run when the module is loaded in WebSocket mode with a live
// `WebSocket` global, so we reload the module per scenario under fake timers.

let lastSocket: FakeSocket;

class FakeSocket {
    static OPEN = 1;
    static CLOSED = 3;
    static CLOSING = 2;
    OPEN = 1;
    CLOSED = 3;
    CLOSING = 2;
    readyState = 1;
    onopen: (() => void) | null = null;
    onmessage: ((e: MessageEvent<string>) => void) | null = null;
    sent: string[] = [];
    url: string;
    constructor(url: string) {
        this.url = url;
        lastSocket = this;
    }
    send(data: string) {
        this.sent.push(data);
    }
}

async function loadWsFresh(): Promise<WsModule> {
    vi.resetModules();
    return loadWs();
}

describe("WebSocket transport", () => {
    beforeEach(() => {
        vi.useFakeTimers();
        (window as any).WebSocket = FakeSocket;
        (window as any).glob = { ...baseGlob, dbInitialized: true };
        vi.spyOn(console, "debug").mockImplementation(() => {});
        vi.spyOn(console, "log").mockImplementation(() => {});
        vi.spyOn(console, "warn").mockImplementation(() => {});
        vi.spyOn(console, "error").mockImplementation(() => {});
    });

    it("connects on bootstrap, wiring onopen/onmessage and deriving the URI from the origin", async () => {
        const ws = await loadWsFresh();
        vi.advanceTimersByTime(0); // run the bootstrap setTimeout(..., 0)

        expect(lastSocket).toBeTruthy();
        // ws: scheme derived from non-https origin + host + pathname
        expect(lastSocket.url.startsWith("ws:")).toBe(true);

        // onopen just logs (debug) and onmessage dispatches a parsed message
        lastSocket.onopen?.();
        const handled: string[] = [];
        ws.subscribeToMessages((m) => handled.push((m as any).type));
        lastSocket.onmessage?.({ data: JSON.stringify({ type: "ping" }) } as MessageEvent<string>);
        await vi.waitFor(() => expect(handled).toContain("ping"));
    });

    it("derives a wss:// URI from an https origin", async () => {
        const realLocation = window.location;
        (window as any).location = { protocol: "https:", host: "example.com", pathname: "/" };
        try {
            await loadWsFresh();
            vi.advanceTimersByTime(0);
            expect(lastSocket.url).toBe("wss://example.com/");
        } finally {
            (window as any).location = realLocation;
        }
    });

    it("uses the injected wsBaseUrl when provided", async () => {
        (window as any).glob = { ...baseGlob, dbInitialized: true, wsBaseUrl: "ws://127.0.0.1:9999/" };
        await loadWsFresh();
        vi.advanceTimersByTime(0);
        expect(lastSocket.url).toBe("ws://127.0.0.1:9999/");
    });

    it("pings over an open socket and clears the lost-connection toast", async () => {
        await loadWsFresh();
        vi.advanceTimersByTime(0);
        lastSocket.readyState = FakeSocket.OPEN;

        // interval fires sendPing
        vi.advanceTimersByTime(1000);
        expect(toast.closePersistent).toHaveBeenCalledWith("lost-websocket-connection");
        const ping = JSON.parse(lastSocket.sent.at(-1)!);
        expect(ping.type).toBe("ping");
    });

    it("shows a persistent toast after the connection is considered lost", async () => {
        await loadWsFresh();
        vi.advanceTimersByTime(0);
        lastSocket.readyState = FakeSocket.OPEN;

        // advance > 30s so Date.now() - lastPingTs exceeds the threshold
        vi.advanceTimersByTime(31000);
        expect(toast.showPersistent).toHaveBeenCalledWith(expect.objectContaining({ id: "lost-websocket-connection" }));
    });

    it("reconnects when the socket is closed or closing", async () => {
        await loadWsFresh();
        vi.advanceTimersByTime(0);
        const first = lastSocket;
        first.readyState = FakeSocket.CLOSED;

        vi.advanceTimersByTime(1000);
        // a brand-new socket was created by connectWebSocket()
        expect(lastSocket).not.toBe(first);
    });

    it("does not bootstrap a socket in print mode", async () => {
        lastSocket = undefined as any;
        (window as any).glob = { ...baseGlob, dbInitialized: true, device: "print" };
        await loadWsFresh();
        vi.advanceTimersByTime(0);
        expect(lastSocket).toBeUndefined();
    });

    it("does not bootstrap a socket before the DB is initialized", async () => {
        lastSocket = undefined as any;
        (window as any).glob = { ...baseGlob, dbInitialized: false };
        await loadWsFresh();
        vi.advanceTimersByTime(0);
        expect(lastSocket).toBeUndefined();
    });

    it("listens for worker custom events in standalone mode (no socket)", async () => {
        lastSocket = undefined as any;
        (window as any).glob = { ...baseGlob, dbInitialized: true, isStandalone: true };
        const ws = await loadWsFresh();
        vi.advanceTimersByTime(0);
        expect(lastSocket).toBeUndefined();

        const seen: string[] = [];
        ws.subscribeToMessages((m) => seen.push((m as any).type));
        window.dispatchEvent(new CustomEvent("trilium:ws-message", { detail: { type: "ping" } }));
        expect(seen).toContain("ping");
    });

    it("listens over the IPC bridge in electron mode and pings without a socket", async () => {
        lastSocket = undefined as any;
        let ipcHandler: ((m: unknown) => void) | undefined;
        const send = vi.fn();
        (window as any).glob = { ...baseGlob, dbInitialized: true };
        (window as any).electronApi = {
            ws: {
                send,
                onMessage: (cb: (m: unknown) => void) => { ipcHandler = cb; return () => {}; }
            }
        };
        const ws = await loadWsFresh();
        vi.advanceTimersByTime(0);
        expect(lastSocket).toBeUndefined();
        expect(ipcHandler).toBeTypeOf("function");

        const seen: string[] = [];
        ws.subscribeToMessages((m) => seen.push((m as any).type));
        ipcHandler?.({ type: "ping" });
        await vi.waitFor(() => expect(seen).toContain("ping"));

        // the interval ping uses sendOutgoing over IPC, not a socket
        vi.advanceTimersByTime(1000);
        expect(send).toHaveBeenCalledWith(expect.objectContaining({ type: "ping" }));
    });

    it("logError over the socket transport stringifies and sends when the socket is open", async () => {
        const ws = await loadWsFresh();
        vi.advanceTimersByTime(0);
        lastSocket.readyState = FakeSocket.OPEN;
        ws.logError("socket-error");
        const payload = JSON.parse(lastSocket.sent.at(-1)!);
        expect(payload).toMatchObject({ type: "log-error", error: "socket-error" });
    });

    it("sendOutgoing returns false (no message sent) when the socket is not open and no IPC bridge exists", async () => {
        const ws = await loadWsFresh();
        vi.advanceTimersByTime(0);
        lastSocket.readyState = 0; // CONNECTING -> sendOutgoing's `readyState === 1` check fails
        lastSocket.sent = [];
        ws.logError("dropped");
        // not open -> nothing queued on the socket
        expect(lastSocket.sent).toEqual([]);
    });
});

describe("checkEntityChangeIdListeners timeout logging", () => {
    it("logs still-waiting listeners that started in the past", async () => {
        const ws = await loadWs();
        const server = (await import("./server.js")).default;
        server.getMaxKnownEntityChangeId = vi.fn(() => 10_000_000);
        const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});

        // register a listener that will stay pending
        const wait = ws.default.waitForMaxKnownEntityChangeId();
        // a frontend-update that does NOT reach the desired id still runs
        // checkEntityChangeIdListeners, which logs the long-waiting listener
        await ws.dispatchMessage({ type: "frontend-update", data: { entityChanges: [{ id: 1, entityName: "notes", entityId: "z" }] } } as any);
        expect(logSpy.mock.calls.some((c) => String(c.join(" ")).includes("Waiting for entityChangeId"))).toBe(true);

        // resolve it so the promise doesn't dangle
        server.getMaxKnownEntityChangeId = vi.fn(() => 0);
        await ws.dispatchMessage({ type: "frontend-update", data: { entityChanges: [{ id: 10_000_001, entityName: "notes", entityId: "z2" }] } } as any);
        await wait;
    });
});
