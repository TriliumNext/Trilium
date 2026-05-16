import type { WebSocketMessage } from "@triliumnext/commons";
import type { ClientMessageHandler, MessageHandler,MessagingProvider } from "@triliumnext/core";

/**
 * Messaging provider for browser Worker environments.
 *
 * This provider uses the Worker's postMessage API to communicate
 * with the main thread. It's designed to be used inside a Web Worker
 * that runs the core services.
 *
 * Message flow:
 * - Outbound (worker → main): Uses self.postMessage() with type: "WS_MESSAGE"
 * - Inbound (main → worker): Listens to onmessage for type: "WS_MESSAGE"
 */
export default class WorkerMessagingProvider implements MessagingProvider {
    private messageHandlers: MessageHandler[] = [];
    private clientMessageHandler?: ClientMessageHandler;
    private isDisposed = false;

    constructor() {
        // Listen for incoming messages from the main thread
        self.addEventListener("message", this.handleIncomingMessage);
    }

    private handleIncomingMessage = (event: MessageEvent) => {
        if (this.isDisposed) return;

        const { type, message } = event.data || {};

        if (type === "WS_MESSAGE" && message) {
            // Dispatch to the client message handler (used by ws.ts for log-error, log-info, ping)
            if (this.clientMessageHandler) {
                try {
                    this.clientMessageHandler("main-thread", message);
                } catch (e) {
                    console.error("[WorkerMessagingProvider] Error in client message handler:", e);
                }
            }

            // Dispatch to all registered handlers
            for (const handler of this.messageHandlers) {
                try {
                    handler(message as WebSocketMessage);
                } catch (e) {
                    console.error("[WorkerMessagingProvider] Error in message handler:", e);
                }
            }
        }
    };

    /**
     * Send a message to all clients (in this case, the main thread).
     * The main thread is responsible for further distribution if needed.
     */
    sendMessageToAllClients(message: WebSocketMessage): void {
        if (this.isDisposed) {
            console.warn("[WorkerMessagingProvider] Cannot send message - provider is disposed");
            return;
        }

        try {
            self.postMessage({
                type: "WS_MESSAGE",
                message
            });
        } catch (e) {
            console.error("[WorkerMessagingProvider] Error sending message:", e);
        }
    }

    /**
     * Send a message to a specific client.
     * In worker context, there's only one client (the main thread), so clientId is ignored.
     */
    sendMessageToClient(_clientId: string, message: WebSocketMessage): boolean {
        if (this.isDisposed) {
            return false;
        }

        this.sendMessageToAllClients(message);
        return true;
    }

    /**
     * Register a handler for incoming client messages.
     */
    setClientMessageHandler(handler: ClientMessageHandler): void {
        this.clientMessageHandler = handler;
    }

    /**
     * Subscribe to incoming messages from the main thread.
     */
    onMessage(handler: MessageHandler): () => void {
        this.messageHandlers.push(handler);

        return () => {
            this.messageHandlers = this.messageHandlers.filter(h => h !== handler);
        };
    }

    /**
     * Get the number of connected "clients".
     * In worker context, there's always exactly 1 client (the main thread).
     */
    getClientCount(): number {
        return this.isDisposed ? 0 : 1;
    }

    /**
     * Clean up resources.
     */
    dispose(): void {
        if (this.isDisposed) return;

        this.isDisposed = true;
        self.removeEventListener("message", this.handleIncomingMessage);
        this.messageHandlers = [];
    }
}
