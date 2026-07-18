import type { WebSocketMessage } from "@triliumnext/commons";
import { afterEach, describe, expect, it, vi } from "vitest";

import WorkerMessagingProvider from "./messaging_provider.js";

const created: WorkerMessagingProvider[] = [];

function makeProvider(): WorkerMessagingProvider {
    const provider = new WorkerMessagingProvider();
    created.push(provider);
    return provider;
}

function dispatch(data: unknown) {
    self.dispatchEvent(new MessageEvent("message", { data }));
}

const wsMessage = { type: "frontend-update", data: {} } as unknown as WebSocketMessage;

afterEach(() => {
    while (created.length) {
        created.pop()?.dispose();
    }
    vi.restoreAllMocks();
});

describe("WorkerMessagingProvider inbound", () => {
    it("dispatches WS_MESSAGE to the client handler and all registered handlers", () => {
        const provider = makeProvider();
        const clientHandler = vi.fn();
        const handlerA = vi.fn();
        const handlerB = vi.fn();
        provider.setClientMessageHandler(clientHandler);
        provider.onMessage(handlerA);
        provider.onMessage(handlerB);

        dispatch({ type: "WS_MESSAGE", message: wsMessage });

        expect(clientHandler).toHaveBeenCalledWith("main-thread", wsMessage);
        expect(handlerA).toHaveBeenCalledWith(wsMessage);
        expect(handlerB).toHaveBeenCalledWith(wsMessage);
    });

    it("ignores non-WS_MESSAGE and empty events", () => {
        const provider = makeProvider();
        const handler = vi.fn();
        provider.onMessage(handler);

        dispatch({ type: "SOMETHING_ELSE", message: wsMessage });
        dispatch(undefined);
        dispatch({ type: "WS_MESSAGE" });

        expect(handler).not.toHaveBeenCalled();
    });

    it("does nothing once disposed", () => {
        const provider = makeProvider();
        const handler = vi.fn();
        provider.onMessage(handler);
        provider.dispose();

        // dispose() also removes the event listener, so a normal dispatch never
        // reaches the handler. Invoke it directly to exercise the in-handler
        // disposed guard as well.
        dispatch({ type: "WS_MESSAGE", message: wsMessage });
        const internal = provider as unknown as { handleIncomingMessage(e: MessageEvent): void };
        internal.handleIncomingMessage(new MessageEvent("message", { data: { type: "WS_MESSAGE", message: wsMessage } }));

        expect(handler).not.toHaveBeenCalled();
    });

    it("isolates errors thrown by the client handler and message handlers", () => {
        const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
        const provider = makeProvider();
        provider.setClientMessageHandler(() => { throw new Error("client boom"); });
        provider.onMessage(() => { throw new Error("handler boom"); });

        expect(() => dispatch({ type: "WS_MESSAGE", message: wsMessage })).not.toThrow();
        expect(consoleSpy).toHaveBeenCalledTimes(2);
    });

    it("onMessage returns an unsubscribe function", () => {
        const provider = makeProvider();
        const handler = vi.fn();
        const unsubscribe = provider.onMessage(handler);
        unsubscribe();

        dispatch({ type: "WS_MESSAGE", message: wsMessage });
        expect(handler).not.toHaveBeenCalled();
    });
});

describe("WorkerMessagingProvider outbound", () => {
    it("posts WS_MESSAGE envelopes to all clients", () => {
        const postSpy = vi.spyOn(self, "postMessage").mockImplementation(() => {});
        const provider = makeProvider();

        provider.sendMessageToAllClients(wsMessage);
        expect(postSpy).toHaveBeenCalledWith({ type: "WS_MESSAGE", message: wsMessage });
    });

    it("sendMessageToClient delegates to sendMessageToAllClients and returns true", () => {
        const postSpy = vi.spyOn(self, "postMessage").mockImplementation(() => {});
        const provider = makeProvider();

        expect(provider.sendMessageToClient("ignored", wsMessage)).toBe(true);
        expect(postSpy).toHaveBeenCalledWith({ type: "WS_MESSAGE", message: wsMessage });
    });

    it("warns and skips sending when disposed", () => {
        const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
        const postSpy = vi.spyOn(self, "postMessage").mockImplementation(() => {});
        const provider = makeProvider();
        provider.dispose();

        provider.sendMessageToAllClients(wsMessage);
        expect(provider.sendMessageToClient("x", wsMessage)).toBe(false);
        expect(postSpy).not.toHaveBeenCalled();
        expect(warnSpy).toHaveBeenCalled();
    });

    it("isolates errors thrown while posting", () => {
        const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
        vi.spyOn(self, "postMessage").mockImplementation(() => { throw new Error("post boom"); });
        const provider = makeProvider();

        expect(() => provider.sendMessageToAllClients(wsMessage)).not.toThrow();
        expect(consoleSpy).toHaveBeenCalled();
    });
});

describe("WorkerMessagingProvider lifecycle", () => {
    it("reports a single client until disposed, then zero", () => {
        const provider = makeProvider();
        expect(provider.getClientCount()).toBe(1);
        provider.dispose();
        expect(provider.getClientCount()).toBe(0);
    });

    it("dispose() is idempotent", () => {
        const provider = makeProvider();
        provider.dispose();
        expect(() => provider.dispose()).not.toThrow();
    });
});
