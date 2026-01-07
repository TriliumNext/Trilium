import type { EntityChange, WebSocketMessage } from "@triliumnext/commons";

/**
 * Handler function for incoming messages from clients.
 */
export type MessageHandler = (message: WebSocketMessage) => void | Promise<void>;

/**
 * Represents a connected client that can receive messages.
 */
export interface MessageClient {
    /** Unique identifier for this client */
    readonly id: string;
    /** Send a message to this specific client */
    send(message: WebSocketMessage): void;
    /** Check if the client is still connected */
    isConnected(): boolean;
}

/**
 * Provider interface for server-to-client messaging.
 * 
 * This abstraction allows different transport mechanisms:
 * - WebSocket for traditional server environments
 * - Worker postMessage for browser environments
 * - Mock implementations for testing
 */
export interface MessagingProvider {
    /**
     * Send a message to all connected clients.
     * This is the primary method used by core services like TaskContext.
     */
    sendMessageToAllClients(message: WebSocketMessage): void;

    /**
     * Send a message to a specific client by ID.
     * Returns false if the client is not found or disconnected.
     */
    sendMessageToClient?(clientId: string, message: WebSocketMessage): boolean;

    /**
     * Subscribe to incoming messages from clients.
     * Returns an unsubscribe function.
     */
    onMessage?(handler: MessageHandler): () => void;

    /**
     * Get the number of connected clients.
     */
    getClientCount?(): number;

    /**
     * Called when the provider should clean up resources.
     */
    dispose?(): void;
}

/**
 * Extended interface for server-side messaging with entity change support.
 * This is used by the WebSocket implementation to handle entity sync.
 */
export interface ServerMessagingProvider extends MessagingProvider {
    /**
     * Send entity changes to all clients (for frontend-update messages).
     */
    sendEntityChangesToAllClients(entityChanges: EntityChange[]): void;

    /**
     * Set the last synced push ID for sync status messages.
     */
    setLastSyncedPush(entityChangeId: number): void;

    /**
     * Notify clients that sync pull is in progress.
     */
    syncPullInProgress(): void;

    /**
     * Notify clients that sync push is in progress.
     */
    syncPushInProgress(): void;

    /**
     * Notify clients that sync has finished.
     */
    syncFinished(): void;

    /**
     * Notify clients that sync has failed.
     */
    syncFailed(): void;

    /**
     * Request all clients to reload their frontend.
     */
    reloadFrontend(reason: string): void;
}
