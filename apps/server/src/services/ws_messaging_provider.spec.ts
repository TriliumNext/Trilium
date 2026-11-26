import type { WebSocketMessage } from "@triliumnext/commons";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const OPEN = 1;
const CLOSED = 3;
const PAGE_TOKEN = "the-page's-csrf-token";

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
vi.mock("../routes/csrf_protection.js", () => ({
    isValidCsrfToken: (_req: unknown, token: unknown) => token === PAGE_TOKEN
}));
vi.mock("@triliumnext/core", async () => {
    // use the real shouldLogMessage so the suppression tests cover the actual filter
    const { shouldLogMessage } = await vi.importActual<typeof import("@triliumnext/core/src/services/messaging/index.js")>(
        "@triliumnext/core/src/services/messaging/index.js"
    );
    return { getLog: () => getLogMock, shouldLogMessage };
});

import WebSocketMessagingProvider, {
    CSRF_REFUSED_CLOSE_CODE,
    isHttpAttachableMessagingProvider
} from "./ws_messaging_provider.js";

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
        closed: false,
        closeCode: undefined as number | undefined,
        close(code?: number) {
            this.closed = true;
            this.closeCode = code;
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
        vi.useRealTimers();
    });

    it("is recognised as HTTP-attachable (the capability www.ts gates the WS server on)", () => {
        expect(isHttpAttachableMessagingProvider(provider)).toBe(true);
        // A plain IPC-style provider without attachToHttpServer must not qualify.
        expect(isHttpAttachableMessagingProvider({
            sendMessageToAllClients() {},
            sendMessageToClient: () => false,
            setClientMessageHandler() {}
        })).toBe(false);
    });

    function init() {
        const httpServer = {} as any;
        const sessionParser = vi.fn((_req: any, _params: any, cb: () => void) => cb());
        provider.attachToHttpServer(httpServer, sessionParser as any);
        return { server: state.instances[0], sessionParser };
    }

    /** Opens a connection and sends the page's token, as the client does first. */
    function admit(server: any, ws = makeSocket()) {
        server.emit("connection", ws, {});
        ws.emit("message", JSON.stringify({ type: "csrf-token", token: PAGE_TOKEN }));
        return ws;
    }

    describe("init / verifyClient", () => {
        it("allows an interactive session", () => {
            const { server } = init();
            const done = vi.fn();
            server.options.verifyClient(
                { req: { session: { loggedIn: true, sessionKind: "interactive" } } },
                done
            );
            expect(done).toHaveBeenCalledWith(true);
            expect(getLogMock.error).not.toHaveBeenCalled();
        });

        it("refuses a sync session and a logged-in session without a kind", () => {
            const { server } = init();
            for (const session of [ { loggedIn: true, sessionKind: "sync" }, { loggedIn: true } ]) {
                const done = vi.fn();
                server.options.verifyClient({ req: { session } }, done);
                expect(done).toHaveBeenCalledWith(false);
            }
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

    describe("the CSRF token of a connection", () => {
        it("serves a connection nothing until its first message is the page's token", async () => {
            const { server } = init();
            const handler = vi.fn();
            provider.setClientMessageHandler(handler);
            const ws = makeSocket();
            server.emit("connection", ws, {});

            provider.sendMessageToAllClients({ type: "sync-finished" } as WebSocketMessage);
            expect(provider.sendMessageToClient("client-id", { type: "ping" } as any)).toBe(false);
            expect(provider.getClientCount()).toBe(0);
            expect(ws.sent).toEqual([]);

            ws.emit("message", JSON.stringify({ type: "csrf-token", token: PAGE_TOKEN }));
            expect(handler).not.toHaveBeenCalled();
            expect(provider.getClientCount()).toBe(1);
            expect(provider.sendMessageToClient("client-id", { type: "ping" } as any)).toBe(true);
        });

        it("closes a connection on a wrong first message, and reads no more from it", async () => {
            const { server } = init();
            const handler = vi.fn();
            provider.setClientMessageHandler(handler);

            for (const first of [
                JSON.stringify({ type: "csrf-token", token: "another" }),
                JSON.stringify({ type: "ping" }),
                "{not json"
            ]) {
                const ws = makeSocket();
                server.emit("connection", ws, {});
                ws.emit("message", first);
                ws.emit("message", JSON.stringify({ type: "csrf-token", token: PAGE_TOKEN }));

                expect(ws.closeCode).toBe(CSRF_REFUSED_CLOSE_CODE);
                expect(provider.getClientCount()).toBe(0);
            }
            expect(handler).not.toHaveBeenCalled();
            expect(getLogMock.info)
                .toHaveBeenCalledWith(expect.stringContaining("wrong CSRF token"));
        });

        it("closes a connection that sends no token within 10 seconds", () => {
            vi.useFakeTimers();
            const { server } = init();
            const silent = makeSocket();
            server.emit("connection", silent, {});
            const served = admit(server, makeSocket());

            vi.advanceTimersByTime(10_000);

            expect(silent.closeCode).toBe(CSRF_REFUSED_CLOSE_CODE);
            expect(served.closed).toBe(false);
            expect(getLogMock.info)
                .toHaveBeenCalledWith(expect.stringContaining("no CSRF token in time"));
        });

        it("forgets the deadline of a connection that closes first", () => {
            vi.useFakeTimers();
            const { server } = init();
            const ws = makeSocket();
            server.emit("connection", ws, {});
            ws.emit("close");

            vi.advanceTimersByTime(10_000);
            expect(ws.closed).toBe(false);
        });
    });

    describe("connection lifecycle", () => {
        it("tracks a served client, dispatches messages, and untracks on close", async () => {
            const { server } = init();
            const handler = vi.fn();
            provider.setClientMessageHandler(handler);

            const ws = admit(server);
            expect(provider.sendMessageToClient("client-id", { type: "ping" } as any)).toBe(true);

            await Promise.resolve(ws.emit("message", JSON.stringify({ type: "hello" })));
            expect(handler).toHaveBeenCalledWith("client-id", { type: "hello" });

            ws.emit("close");
            expect(provider.sendMessageToClient("client-id", { type: "ping" } as any)).toBe(false);
        });

        it("ignores incoming messages when no handler is registered", async () => {
            const { server } = init();
            const ws = admit(server);
            // With no handler registered the message listener parses the payload
            // and returns (undefined) without dispatching — emitting must not throw.
            expect(ws.emit("message", JSON.stringify({ type: "x" }))).toBeUndefined();
            await Promise.resolve(); // let the fire-and-forget async body settle
        });

        it("logs a malformed message or a failing handler instead of rejecting", async () => {
            const { server } = init();
            const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
            provider.setClientMessageHandler(vi.fn(async () => {
                throw new Error("handler failed");
            }));
            const ws = admit(server);

            ws.emit("message", "{not json");
            ws.emit("message", JSON.stringify({ type: "hello" }));

            await vi.waitFor(() => expect(consoleError).toHaveBeenCalledTimes(2));
            expect(consoleError.mock.calls.map(([ prefix, error ]) => [ prefix, (error as Error).constructor.name ])).toEqual([
                [ "Failed to process websocket message:", "SyntaxError" ],
                [ "Failed to process websocket message:", "Error" ]
            ]);
            expect((consoleError.mock.calls[1][1] as Error).message).toBe("handler failed");
        });

        it("logs server errors via the error handler", () => {
            const { server } = init();
            expect(() => server.emit("error", new Error("ws boom"))).not.toThrow();
        });

        it("handles a per-connection error without throwing and untracks the client", () => {
            // A protocol error on a single socket (e.g. WS_ERR_INVALID_CLOSE_CODE) must not
            // bubble up as an uncaught exception that crashes the process. See issue #9598.
            const { server } = init();
            const ws = admit(server);
            expect(provider.sendMessageToClient("client-id", { type: "ping" } as any)).toBe(true);

            expect(() => ws.emit("error", new Error("WS_ERR_INVALID_CLOSE_CODE"))).not.toThrow();
            expect(provider.sendMessageToClient("client-id", { type: "ping" } as any)).toBe(false);
        });
    });

    describe("sendMessageToAllClients", () => {
        it("sends to OPEN clients and logs non-suppressed message types", () => {
            const { server } = init();
            randomStringMock.mockReturnValueOnce("open").mockReturnValueOnce("closed");
            const open = admit(server, makeSocket(OPEN));
            const closed = admit(server, makeSocket(CLOSED));

            provider.sendMessageToAllClients({ type: "sync-finished" } as WebSocketMessage);
            expect(open.sent).toHaveLength(1);
            expect(closed.sent).toHaveLength(0);
            expect(getLogMock.info).toHaveBeenCalled();
        });

        it("does not log for suppressed message types", () => {
            const { server } = init();
            const open = admit(server);

            provider.sendMessageToAllClients({ type: "frontend-update" } as WebSocketMessage);
            provider.sendMessageToAllClients({ type: "sync-failed" } as WebSocketMessage);
            provider.sendMessageToAllClients({ type: "api-log-messages" } as WebSocketMessage);

            expect(getLogMock.info).not.toHaveBeenCalled();
            // suppressing the log must not suppress delivery
            expect(open.sent).toHaveLength(3);
        });

        it("is a no-op when the server is not initialized", () => {
            expect(() =>
                provider.sendMessageToAllClients({ type: "frontend-update" } as WebSocketMessage)
            ).not.toThrow();
            expect(getLogMock.info).not.toHaveBeenCalled();
        });
    });

    describe("disconnectAllClients", () => {
        it("asks every open client to reload, then closes every connection", () => {
            const { server } = init();
            const open = makeSocket(OPEN);
            const closed = makeSocket(CLOSED);
            server.clients.add(open);
            server.clients.add(closed);

            provider.disconnectAllClients("password changed");

            expect(open.sent.map((data) => JSON.parse(data))).toEqual([
                { type: "reload-frontend", reason: "password changed" }
            ]);
            expect(closed.sent).toHaveLength(0);
            expect(open.closed).toBe(true);
            expect(closed.closed).toBe(true);
        });

        it("is a no-op when the server is not initialized", () => {
            expect(() => provider.disconnectAllClients("password changed")).not.toThrow();
        });
    });

    describe("sendMessageToClient", () => {
        it("returns false for an unknown client", () => {
            init();
            expect(provider.sendMessageToClient("missing", { type: "ping" } as any)).toBe(false);
        });

        it("returns false for a client that is not OPEN", () => {
            const { server } = init();
            admit(server, makeSocket(CLOSED));
            expect(provider.sendMessageToClient("client-id", { type: "ping" } as any)).toBe(false);
        });

        it("sends and returns true for an OPEN client", () => {
            const { server } = init();
            const ws = admit(server);
            expect(provider.sendMessageToClient("client-id", { type: "ping" } as any)).toBe(true);
            expect(ws.sent).toHaveLength(1);
        });
    });

    describe("getClientCount", () => {
        it("counts the connections that are served", () => {
            const { server } = init();
            randomStringMock
                .mockReturnValueOnce("a")
                .mockReturnValueOnce("b")
                .mockReturnValueOnce("c");
            admit(server);
            admit(server);
            server.emit("connection", makeSocket(), {});
            expect(provider.getClientCount()).toBe(2);
        });

        it("returns 0 when the server is not initialized", () => {
            expect(provider.getClientCount()).toBe(0);
        });
    });

    describe("dispose", () => {
        it("closes the server and clears the client map", () => {
            const { server } = init();
            admit(server);

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
