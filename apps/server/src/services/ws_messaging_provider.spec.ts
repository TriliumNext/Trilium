import type { WebSocketMessage } from "@triliumnext/commons";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const OPEN = 1;
const CLOSED = 3;

type Handler = (...args: any[]) => void;

const { state, getLogMock, configMock, randomStringMock, WebSocketServerMock } = vi.hoisted(() => {
    const state: { instances: any[] } = { instances: [] };

    class WebSocketServerMock {
        options: any;
        clients = new Set<any>();
        handlers: Record<string, (...a: any[]) => void> = {};
        closed = false;

        constructor(options: any) {
            this.options = options;
            state.instances.push(this);
        }
        on(event: string, cb: (...a: any[]) => void) {
            this.handlers[event] = cb;
            return this;
        }
        emit(event: string, ...args: any[]) {
            return this.handlers[event]?.(...args);
        }
        close() {
            this.closed = true;
        }
    }

    return {
        state,
        WebSocketServerMock,
        getLogMock: { error: vi.fn(), info: vi.fn() },
        configMock: { General: { noAuthentication: false } as { noAuthentication: boolean } | undefined },
        randomStringMock: vi.fn(() => "client-id")
    };
});

vi.mock("ws", () => ({
    WebSocketServer: WebSocketServerMock,
    WebSocket: { OPEN: 1 } // keep in sync with the module-level OPEN constant
}));
vi.mock("./config.js", () => ({ default: configMock }));
vi.mock("./utils.js", () => ({ randomString: randomStringMock }));
vi.mock("@triliumnext/core", () => ({ getLog: () => getLogMock }));

import WebSocketMessagingProvider from "./ws_messaging_provider.js";

function makeSocket(readyState = OPEN) {
    const handlers: Record<string, Handler> = {};
    return {
        readyState,
        sent: [] as string[],
        handlers,
        on(event: string, cb: Handler) {
            handlers[event] = cb;
            return this;
        },
        send(data: string) {
            this.sent.push(data);
        },
        emit(event: string, ...args: any[]) {
            return handlers[event]?.(...args);
        }
    };
}

describe("WebSocketMessagingProvider", () => {
    let provider: WebSocketMessagingProvider;

    beforeEach(() => {
        provider = new WebSocketMessagingProvider();
        state.instances = [];
        getLogMock.error.mockClear();
        getLogMock.info.mockClear();
        configMock.General = { noAuthentication: false };
        randomStringMock.mockReturnValue("client-id");
        vi.spyOn(console, "log").mockImplementation(() => {});
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    function init() {
        const httpServer = {} as any;
        const sessionParser = vi.fn((_req: any, _params: any, cb: () => void) => cb());
        provider.init(httpServer, sessionParser as any);
        return { server: state.instances[0], sessionParser };
    }

    describe("init / verifyClient", () => {
        it("allows a logged-in session", () => {
            const { server } = init();
            const done = vi.fn();
            server.options.verifyClient({ req: { session: { loggedIn: true } } }, done);
            expect(done).toHaveBeenCalledWith(true);
            expect(getLogMock.error).not.toHaveBeenCalled();
        });

        it("allows when authentication is disabled", () => {
            configMock.General = { noAuthentication: true };
            const { server } = init();
            const done = vi.fn();
            server.options.verifyClient({ req: { session: { loggedIn: false } } }, done);
            expect(done).toHaveBeenCalledWith(true);
        });

        it("rejects and logs when not logged in and auth is required", () => {
            const { server } = init();
            const done = vi.fn();
            server.options.verifyClient({ req: { session: { loggedIn: false } } }, done);
            expect(done).toHaveBeenCalledWith(false);
            expect(getLogMock.error).toHaveBeenCalled();
        });

        it("rejects when the config has no General section", () => {
            configMock.General = undefined;
            const { server } = init();
            const done = vi.fn();
            server.options.verifyClient({ req: { session: { loggedIn: false } } }, done);
            // `config.General && config.General.noAuthentication` short-circuits to a
            // falsy value, so the connection is not allowed.
            expect(done.mock.calls[0][0]).toBeFalsy();
        });
    });

    describe("connection lifecycle", () => {
        it("tracks a connected client, dispatches messages, and untracks on close", async () => {
            const { server } = init();
            const handler = vi.fn();
            provider.setClientMessageHandler(handler);

            const ws = makeSocket();
            server.emit("connection", ws, {});
            expect(provider.getClientCount()).toBe(0); // server.clients still empty (we manage map)
            expect(provider.sendMessageToClient("client-id", { type: "ping" } as any)).toBe(true);

            await Promise.resolve(ws.emit("message", JSON.stringify({ type: "hello" })));
            expect(handler).toHaveBeenCalledWith("client-id", { type: "hello" });

            ws.emit("close");
            expect(provider.sendMessageToClient("client-id", { type: "ping" } as any)).toBe(false);
        });

        it("ignores incoming messages when no handler is registered", async () => {
            const { server } = init();
            const ws = makeSocket();
            server.emit("connection", ws, {});
            // With no handler registered the message listener parses the payload
            // and returns (undefined) without dispatching — emitting must not throw.
            expect(ws.emit("message", JSON.stringify({ type: "x" }))).toBeUndefined();
            await Promise.resolve(); // let the fire-and-forget async body settle
        });

        it("logs server errors via the error handler", () => {
            const { server } = init();
            expect(() => server.emit("error", new Error("ws boom"))).not.toThrow();
        });
    });

    describe("sendMessageToAllClients", () => {
        it("sends to OPEN clients and logs non-suppressed message types", () => {
            const { server } = init();
            const open = makeSocket(OPEN);
            const closed = makeSocket(CLOSED);
            server.clients.add(open);
            server.clients.add(closed);

            provider.sendMessageToAllClients({ type: "frontend-update" } as WebSocketMessage);
            expect(open.sent).toHaveLength(1);
            expect(closed.sent).toHaveLength(0);
            expect(getLogMock.info).toHaveBeenCalled();
        });

        it("does not log for suppressed message types", () => {
            init();
            provider.sendMessageToAllClients({ type: "sync-failed" } as WebSocketMessage);
            provider.sendMessageToAllClients({ type: "api-log-messages" } as WebSocketMessage);
            expect(getLogMock.info).not.toHaveBeenCalled();
        });

        it("is a no-op when the server is not initialized", () => {
            expect(() =>
                provider.sendMessageToAllClients({ type: "frontend-update" } as WebSocketMessage)
            ).not.toThrow();
            expect(getLogMock.info).not.toHaveBeenCalled();
        });
    });

    describe("sendMessageToClient", () => {
        it("returns false for an unknown client", () => {
            init();
            expect(provider.sendMessageToClient("missing", { type: "ping" } as any)).toBe(false);
        });

        it("returns false for a client that is not OPEN", () => {
            const { server } = init();
            const ws = makeSocket(CLOSED);
            server.emit("connection", ws, {});
            expect(provider.sendMessageToClient("client-id", { type: "ping" } as any)).toBe(false);
        });

        it("sends and returns true for an OPEN client", () => {
            const { server } = init();
            const ws = makeSocket(OPEN);
            server.emit("connection", ws, {});
            expect(provider.sendMessageToClient("client-id", { type: "ping" } as any)).toBe(true);
            expect(ws.sent).toHaveLength(1);
        });
    });

    describe("getClientCount", () => {
        it("returns the server's client set size", () => {
            const { server } = init();
            server.clients.add(makeSocket());
            server.clients.add(makeSocket());
            expect(provider.getClientCount()).toBe(2);
        });

        it("returns 0 when the server is not initialized", () => {
            expect(provider.getClientCount()).toBe(0);
        });
    });

    describe("dispose", () => {
        it("closes the server and clears the client map", () => {
            const { server } = init();
            const ws = makeSocket(OPEN);
            server.emit("connection", ws, {});

            provider.dispose();
            expect(server.closed).toBe(true);
            // After dispose, server is still referenced but map is cleared.
            expect(provider.sendMessageToClient("client-id", { type: "ping" } as any)).toBe(false);
        });

        it("is safe to call before init", () => {
            expect(() => provider.dispose()).not.toThrow();
        });
    });
});
