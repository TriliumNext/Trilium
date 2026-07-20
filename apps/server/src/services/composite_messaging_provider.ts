import type { WebSocketMessage } from "@triliumnext/commons";
import type { ClientMessageHandler, MessagingProvider } from "@triliumnext/core";

/**
 * Fans a single messaging channel out over several transports.
 *
 * The desktop app talks to its own renderer over Electron IPC
 * (`IpcMessagingProvider` in `apps/desktop`), but browsers connecting to the
 * desktop's TCP HTTP listener (localhost, or the LAN with `allowLanAccess`)
 * still need the session-authenticated WebSocket transport for entity
 * updates. This provider broadcasts to every delegate and delivers incoming
 * client messages from any of them.
 *
 * Client IDs stay disjoint across the delegates (IPC uses numeric
 * `webContents` IDs, WebSocket uses random alphanumeric strings), and each
 * delegate's `sendMessageToClient` returns `false` for an ID it doesn't own,
 * so targeted sends simply try the delegates in order.
 */
export default class CompositeMessagingProvider implements MessagingProvider {
    constructor(private readonly providers: MessagingProvider[]) {}

    setClientMessageHandler(handler: ClientMessageHandler): void {
        for (const provider of this.providers) {
            provider.setClientMessageHandler(handler);
        }
    }

    sendMessageToAllClients(message: WebSocketMessage): void {
        for (const provider of this.providers) {
            provider.sendMessageToAllClients(message);
        }
    }

    sendMessageToClient(clientId: string, message: WebSocketMessage): boolean {
        return this.providers.some((provider) => provider.sendMessageToClient(clientId, message));
    }

    getClientCount(): number {
        return this.providers.reduce((count, provider) => count + (provider.getClientCount?.() ?? 0), 0);
    }

    dispose(): void {
        for (const provider of this.providers) {
            provider.dispose?.();
        }
    }
}
