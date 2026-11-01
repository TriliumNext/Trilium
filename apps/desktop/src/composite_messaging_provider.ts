import type { WebSocketMessage } from "@triliumnext/commons";
import type { ClientMessageHandler, MessagingProvider } from "@triliumnext/core";
import type WebSocketMessagingProvider from "@triliumnext/server/src/services/ws_messaging_provider.js";
import type express from "express";
import type { Server as HttpServer } from "http";

import type IpcMessagingProvider from "./ipc_messaging_provider.js";

// Client IDs are namespaced per transport so a per-client reply is routed back over
// the same transport it arrived on. The IPC provider keys clients by numeric
// webContents id and the WS provider by a random string, so these prefixes are the
// only thing that reliably disambiguates them.
const IPC_PREFIX = "ipc:";
const WS_PREFIX = "ws:";

/**
 * Fans server→client messaging out across BOTH transports the desktop can serve:
 *  - the Electron-IPC channel to the trusted renderer window(s), and
 *  - a WebSocket endpoint on the TCP HTTP listener for browser clients.
 *
 * The WS half exists only when the user has opted into LAN/network access (see
 * `apps/desktop/src/main.ts`); without it the desktop uses `IpcMessagingProvider`
 * alone and no WS port is bound. www.ts hands this provider the `http.Server` via
 * `attachToHttpServer()` (detected through the HttpAttachable capability), which we
 * forward to the wrapped WS provider.
 */
export default class CompositeMessagingProvider implements MessagingProvider {
    constructor(
        private readonly ipc: IpcMessagingProvider,
        private readonly ws: WebSocketMessagingProvider
    ) {}

    attachToHttpServer(httpServer: HttpServer, sessionParser: express.RequestHandler): void {
        this.ws.attachToHttpServer(httpServer, sessionParser);
    }

    disconnectAllClients(reason: string): void {
        this.ws.disconnectAllClients(reason);
    }

    setClientMessageHandler(handler: ClientMessageHandler): void {
        this.ipc.setClientMessageHandler((id, message) => handler(`${IPC_PREFIX}${id}`, message));
        this.ws.setClientMessageHandler((id, message) => handler(`${WS_PREFIX}${id}`, message));
    }

    sendMessageToAllClients(message: WebSocketMessage): void {
        this.ipc.sendMessageToAllClients(message);
        this.ws.sendMessageToAllClients(message);
    }

    sendMessageToClient(clientId: string, message: WebSocketMessage): boolean {
        if (clientId.startsWith(IPC_PREFIX)) {
            return this.ipc.sendMessageToClient(clientId.slice(IPC_PREFIX.length), message);
        }
        if (clientId.startsWith(WS_PREFIX)) {
            return this.ws.sendMessageToClient(clientId.slice(WS_PREFIX.length), message);
        }
        return false;
    }

    getClientCount(): number {
        // Both concrete legs implement these unconditionally, so no optional-call guard.
        return this.ipc.getClientCount() + this.ws.getClientCount();
    }

    dispose(): void {
        this.ipc.dispose();
        this.ws.dispose();
    }
}
