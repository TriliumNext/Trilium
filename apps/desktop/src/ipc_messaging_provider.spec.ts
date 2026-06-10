import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

type IpcHandler = (event: { sender: { id: number } }, message: unknown) => void | Promise<void>;
type SendTrace = { windowId: number; channel: string; payload: unknown };

const ipcMainListeners = new Map<string, IpcHandler[]>();
const sends: SendTrace[] = [];
let nextWindowId = 1;
let windows: FakeBrowserWindow[] = [];

class FakeBrowserWindow {
    private destroyed = false;
    public readonly webContents: { id: number; send: (channel: string, payload: unknown) => void };

    constructor(public readonly id: number) {
        const send = (channel: string, payload: unknown) => {
            if (this.destroyed) return;
            sends.push({ windowId: this.id, channel, payload });
        };
        this.webContents = { id, send };
        windows.push(this);
    }

    isDestroyed() {
        return this.destroyed;
    }

    destroy() {
        this.destroyed = true;
    }
}

vi.mock("electron", () => ({
    default: {
        BrowserWindow: {
            getAllWindows: () => windows
        },
        ipcMain: {
            on(channel: string, listener: IpcHandler) {
                const list = ipcMainListeners.get(channel) ?? [];
                list.push(listener);
                ipcMainListeners.set(channel, list);
            },
            removeAllListeners(channel: string) {
                ipcMainListeners.delete(channel);
            }
        }
    }
}));

// `getLog()` throws when the log service hasn't been initialised via
// `initializeCore` — and we don't want to spin up core in unit tests just to
// satisfy a logger. Partial-mock core so `getLog` returns no-op stubs while
// every other core export keeps its real implementation.
vi.mock("@triliumnext/core", async (importOriginal) => {
    const actual = await importOriginal<typeof import("@triliumnext/core")>();
    return {
        ...actual,
        getLog: () => ({ info: vi.fn(), error: vi.fn() })
    };
});

const { default: IpcMessagingProvider } = await import("./ipc_messaging_provider.js");

function newWindow(): FakeBrowserWindow {
    return new FakeBrowserWindow(nextWindowId++);
}

function deliverFromRenderer(windowId: number, payload: unknown) {
    const list = ipcMainListeners.get("trilium-ws-from-renderer") ?? [];
    for (const fn of list) {
        fn({ sender: { id: windowId } }, payload);
    }
}

describe("IpcMessagingProvider", () => {
    let provider: InstanceType<typeof IpcMessagingProvider>;

    beforeEach(() => {
        ipcMainListeners.clear();
        sends.length = 0;
        windows = [];
        nextWindowId = 1;
        provider = new IpcMessagingProvider();
        provider.init();
    });

    afterEach(() => {
        provider.dispose();
    });

    describe("sendMessageToAllClients", () => {
        it("delivers the payload to every open window", () => {
            const a = newWindow();
            const b = newWindow();

            provider.sendMessageToAllClients({ type: "ping" } as any);

            expect(sends).toEqual([
                { windowId: a.id, channel: "trilium-ws-message", payload: { type: "ping" } },
                { windowId: b.id, channel: "trilium-ws-message", payload: { type: "ping" } }
            ]);
        });

        it("still delivers noisy log-filtered message types (sync-failed / api-log-messages)", () => {
            const w = newWindow();

            provider.sendMessageToAllClients({ type: "sync-failed" } as any);
            provider.sendMessageToAllClients({ type: "api-log-messages" } as any);

            expect(sends).toEqual([
                { windowId: w.id, channel: "trilium-ws-message", payload: { type: "sync-failed" } },
                { windowId: w.id, channel: "trilium-ws-message", payload: { type: "api-log-messages" } }
            ]);
        });

        it("skips destroyed windows", () => {
            const live = newWindow();
            const dead = newWindow();
            dead.destroy();

            provider.sendMessageToAllClients({ type: "toast", message: "hi" } as any);

            expect(sends).toHaveLength(1);
            expect(sends[0].windowId).toBe(live.id);
        });
    });

    describe("sendMessageToClient", () => {
        it("delivers the payload to the matching window only", () => {
            const a = newWindow();
            const b = newWindow();

            const ok = provider.sendMessageToClient(String(b.webContents.id), { type: "ping" } as any);

            expect(ok).toBe(true);
            expect(sends).toEqual([
                { windowId: b.id, channel: "trilium-ws-message", payload: { type: "ping" } }
            ]);
            expect(sends.find(s => s.windowId === a.id)).toBeUndefined();
        });

        it("returns false for unknown / destroyed / malformed client IDs", () => {
            const a = newWindow();
            a.destroy();

            expect(provider.sendMessageToClient(String(a.webContents.id), { type: "ping" } as any)).toBe(false);
            expect(provider.sendMessageToClient("99999", { type: "ping" } as any)).toBe(false);
            expect(provider.sendMessageToClient("not-a-number", { type: "ping" } as any)).toBe(false);
            expect(sends).toEqual([]);
        });
    });

    describe("incoming renderer messages", () => {
        it("forwards parsed objects to the registered handler, keyed by webContents.id", async () => {
            const handler = vi.fn();
            provider.setClientMessageHandler(handler);

            const a = newWindow();
            deliverFromRenderer(a.webContents.id, { type: "ping", lastEntityChangeId: 7 });
            // Allow the async handler invocation to settle.
            await Promise.resolve();

            expect(handler).toHaveBeenCalledWith(String(a.webContents.id), {
                type: "ping",
                lastEntityChangeId: 7
            });
        });

        it("accepts JSON strings for parity with the WebSocket wire format", async () => {
            const handler = vi.fn();
            provider.setClientMessageHandler(handler);

            const a = newWindow();
            deliverFromRenderer(a.webContents.id, JSON.stringify({ type: "log-error", error: "boom" }));
            await Promise.resolve();

            expect(handler).toHaveBeenCalledWith(String(a.webContents.id), {
                type: "log-error",
                error: "boom"
            });
        });

        it("discards non-JSON renderer strings without invoking the handler", async () => {
            const handler = vi.fn();
            provider.setClientMessageHandler(handler);

            const a = newWindow();
            deliverFromRenderer(a.webContents.id, "this is not valid json {");
            await Promise.resolve();

            expect(handler).not.toHaveBeenCalled();
        });

        it("noops when no handler is registered", async () => {
            const a = newWindow();
            // Should not throw.
            deliverFromRenderer(a.webContents.id, { type: "ping" });
            await Promise.resolve();
        });

        it("swallows handler errors instead of crashing the main process", async () => {
            const handler = vi.fn().mockRejectedValue(new Error("boom"));
            provider.setClientMessageHandler(handler);

            const a = newWindow();
            // Must not reject / throw even though the handler rejects.
            deliverFromRenderer(a.webContents.id, { type: "ping" });
            await Promise.resolve();
            await Promise.resolve();

            expect(handler).toHaveBeenCalled();
        });
    });

    describe("client count", () => {
        it("counts only non-destroyed windows", () => {
            const a = newWindow();
            const b = newWindow();
            newWindow().destroy();
            expect(provider.getClientCount()).toBe(2);
            a.destroy();
            expect(provider.getClientCount()).toBe(1);
            b.destroy();
            expect(provider.getClientCount()).toBe(0);
        });
    });

    describe("dispose", () => {
        it("removes its ipcMain listener so a second init can register cleanly", () => {
            provider.dispose();
            expect(ipcMainListeners.get("trilium-ws-from-renderer")).toBeUndefined();

            // Re-init should be safe and the handler should fire again.
            provider.init();
            const handler = vi.fn();
            provider.setClientMessageHandler(handler);
            const a = newWindow();
            deliverFromRenderer(a.webContents.id, { type: "ping" });
            return Promise.resolve().then(() => {
                expect(handler).toHaveBeenCalled();
            });
        });
    });
});
