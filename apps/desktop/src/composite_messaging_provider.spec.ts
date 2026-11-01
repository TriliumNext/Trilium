import type { WebSocketMessage } from "@triliumnext/commons";
import type { ClientMessageHandler } from "@triliumnext/core";
import type WebSocketMessagingProvider from "@triliumnext/server/src/services/ws_messaging_provider.js";
import type express from "express";
import type { Server as HttpServer } from "http";
import { describe, expect, it, vi } from "vitest";

import CompositeMessagingProvider from "./composite_messaging_provider.js";
import type IpcMessagingProvider from "./ipc_messaging_provider.js";

/** Minimal stand-in for one leg of the composite that records interactions and
 *  lets the test drive the registered client-message handler. */
function makeFakeLeg() {
    let handler: ClientMessageHandler | undefined;
    return {
        setClientMessageHandler: vi.fn((h: ClientMessageHandler) => { handler = h; }),
        sendMessageToAllClients: vi.fn(),
        sendMessageToClient: vi.fn(() => true),
        getClientCount: vi.fn(() => 0),
        dispose: vi.fn(),
        attachToHttpServer: vi.fn(),
        /** Simulate an inbound message arriving on this transport. */
        emit(id: string, message: unknown) { void handler?.(id, message); }
    };
}

const MESSAGE = { type: "ping" } as unknown as WebSocketMessage;

function build() {
    const ipc = makeFakeLeg();
    const ws = makeFakeLeg();
    const composite = new CompositeMessagingProvider(
        ipc as unknown as IpcMessagingProvider,
        ws as unknown as WebSocketMessagingProvider
    );
    return { ipc, ws, composite };
}

describe("CompositeMessagingProvider", () => {
    it("namespaces inbound client IDs per transport", () => {
        const { ipc, ws, composite } = build();
        const received: Array<[string, unknown]> = [];
        composite.setClientMessageHandler((id, msg) => { received.push([id, msg]); });

        ipc.emit("5", MESSAGE);
        ws.emit("abc123", MESSAGE);

        expect(received).toEqual([
            ["ipc:5", MESSAGE],
            ["ws:abc123", MESSAGE]
        ]);
    });

    it("broadcasts to both transports", () => {
        const { ipc, ws, composite } = build();
        composite.sendMessageToAllClients(MESSAGE);

        expect(ipc.sendMessageToAllClients).toHaveBeenCalledWith(MESSAGE);
        expect(ws.sendMessageToAllClients).toHaveBeenCalledWith(MESSAGE);
    });

    it("routes a per-client reply back over the transport it arrived on", () => {
        const { ipc, ws, composite } = build();

        expect(composite.sendMessageToClient("ipc:5", MESSAGE)).toBe(true);
        expect(ipc.sendMessageToClient).toHaveBeenCalledWith("5", MESSAGE);
        expect(ws.sendMessageToClient).not.toHaveBeenCalled();

        expect(composite.sendMessageToClient("ws:abc123", MESSAGE)).toBe(true);
        expect(ws.sendMessageToClient).toHaveBeenCalledWith("abc123", MESSAGE);
    });

    it("returns false for an unroutable client ID without touching either leg", () => {
        const { ipc, ws, composite } = build();

        expect(composite.sendMessageToClient("bogus", MESSAGE)).toBe(false);
        expect(ipc.sendMessageToClient).not.toHaveBeenCalled();
        expect(ws.sendMessageToClient).not.toHaveBeenCalled();
    });

    it("sums client counts and disposes both legs", () => {
        const { ipc, ws, composite } = build();
        ipc.getClientCount.mockReturnValue(2);
        ws.getClientCount.mockReturnValue(3);

        expect(composite.getClientCount()).toBe(5);

        composite.dispose();
        expect(ipc.dispose).toHaveBeenCalled();
        expect(ws.dispose).toHaveBeenCalled();
    });

    it("attaches only the WebSocket leg to the HTTP server", () => {
        const { ipc, ws, composite } = build();
        const httpServer = {} as unknown as HttpServer;
        const sessionParser = (() => {}) as unknown as express.RequestHandler;

        composite.attachToHttpServer(httpServer, sessionParser);

        expect(ws.attachToHttpServer).toHaveBeenCalledWith(httpServer, sessionParser);
        expect(ipc.attachToHttpServer).not.toHaveBeenCalled();
    });
});
