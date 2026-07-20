import type { WebSocketMessage } from "@triliumnext/commons";
import type { ClientMessageHandler, MessagingProvider } from "@triliumnext/core";
import { describe, expect, it, vi } from "vitest";

import CompositeMessagingProvider from "./composite_messaging_provider.js";

function makeProvider(overrides: Partial<MessagingProvider> = {}): MessagingProvider {
    return {
        setClientMessageHandler: vi.fn(),
        sendMessageToAllClients: vi.fn(),
        sendMessageToClient: vi.fn().mockReturnValue(false),
        getClientCount: vi.fn().mockReturnValue(0),
        dispose: vi.fn(),
        ...overrides
    };
}

const message: WebSocketMessage = { type: "reload-frontend", reason: "test" };

describe("CompositeMessagingProvider", () => {
    it("registers the client message handler on every delegate", () => {
        const a = makeProvider();
        const b = makeProvider();
        const handler: ClientMessageHandler = vi.fn();

        new CompositeMessagingProvider([a, b]).setClientMessageHandler(handler);

        expect(a.setClientMessageHandler).toHaveBeenCalledWith(handler);
        expect(b.setClientMessageHandler).toHaveBeenCalledWith(handler);
    });

    it("broadcasts to every delegate", () => {
        const a = makeProvider();
        const b = makeProvider();

        new CompositeMessagingProvider([a, b]).sendMessageToAllClients(message);

        expect(a.sendMessageToAllClients).toHaveBeenCalledWith(message);
        expect(b.sendMessageToAllClients).toHaveBeenCalledWith(message);
    });

    it("targeted send tries delegates in order and reports whether any accepted", () => {
        const a = makeProvider();
        const b = makeProvider({ sendMessageToClient: vi.fn().mockReturnValue(true) });
        const composite = new CompositeMessagingProvider([a, b]);

        expect(composite.sendMessageToClient("client-1", message)).toBe(true);
        expect(a.sendMessageToClient).toHaveBeenCalledWith("client-1", message);
        expect(b.sendMessageToClient).toHaveBeenCalledWith("client-1", message);

        expect(new CompositeMessagingProvider([a]).sendMessageToClient("client-1", message)).toBe(false);
    });

    it("sums client counts, tolerating delegates without getClientCount", () => {
        const a = makeProvider({ getClientCount: vi.fn().mockReturnValue(2) });
        const b = makeProvider({ getClientCount: undefined });
        const c = makeProvider({ getClientCount: vi.fn().mockReturnValue(3) });

        expect(new CompositeMessagingProvider([a, b, c]).getClientCount()).toBe(5);
    });

    it("disposes every delegate, tolerating delegates without dispose", () => {
        const a = makeProvider();
        const b = makeProvider({ dispose: undefined });

        new CompositeMessagingProvider([a, b]).dispose();

        expect(a.dispose).toHaveBeenCalled();
    });
});
