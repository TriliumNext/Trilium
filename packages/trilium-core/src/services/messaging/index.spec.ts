import type { WebSocketMessage } from "@triliumnext/commons";
import { describe, expect, it, vi } from "vitest";

import {
    getMessagingProvider,
    initMessaging,
    isMessagingInitialized,
    sendMessageToAllClients
} from "./index.js";
import type { ClientMessageHandler, MessagingProvider } from "./types.js";

function buildFakeProvider(): MessagingProvider & { sent: WebSocketMessage[] } {
    const sent: WebSocketMessage[] = [];
    return {
        sent,
        sendMessageToAllClients: vi.fn((message: WebSocketMessage) => sent.push(message)),
        sendMessageToClient: vi.fn(() => true),
        setClientMessageHandler: vi.fn((_handler: ClientMessageHandler) => {})
    };
}

describe("messaging provider (core)", () => {
    // The core test bootstrap (initializeCore) intentionally does not register a
    // messaging provider, so these tests start from the uninitialized state and
    // then install a fake. Each spec file runs in its own fork, so the mutation
    // of the module singleton does not leak to other files.
    it("reports uninitialized state, throws on get, and no-ops sends until a provider is set", () => {
        expect(isMessagingInitialized()).toBe(false);
        expect(() => getMessagingProvider()).toThrow(/not initialized/);

        // Without a provider, sends are silently dropped (just a debug log).
        const debugSpy = vi.spyOn(console, "debug").mockImplementation(() => {});
        sendMessageToAllClients({ type: "ping" });
        expect(debugSpy).toHaveBeenCalledOnce();
        debugSpy.mockRestore();
    });

    it("routes messages through the provider once initialized", () => {
        const fake = buildFakeProvider();
        initMessaging(fake);

        expect(isMessagingInitialized()).toBe(true);
        expect(getMessagingProvider()).toBe(fake);

        sendMessageToAllClients({ type: "ping" });
        expect(fake.sendMessageToAllClients).toHaveBeenCalledWith({ type: "ping" });
        expect(fake.sent).toEqual([{ type: "ping" }]);
    });
});
