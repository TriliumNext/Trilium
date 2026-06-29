import type { WebSocketMessage } from "@triliumnext/commons";
import type { MessagingProvider } from "./types.js";

let messagingProvider: MessagingProvider | null = null;

/**
 * Initialize the messaging system with a provider.
 * This should be called during application startup.
 */
export function initMessaging(provider: MessagingProvider): void {
    messagingProvider = provider;
}

/**
 * Get the current messaging provider.
 * Throws if messaging hasn't been initialized.
 */
export function getMessagingProvider(): MessagingProvider {
    if (!messagingProvider) {
        throw new Error("Messaging provider not initialized. Call initMessaging() first.");
    }
    return messagingProvider;
}

/**
 * Check if messaging has been initialized.
 */
export function isMessagingInitialized(): boolean {
    return messagingProvider !== null;
}

/**
 * Send a message to all connected clients.
 * This is a convenience function that uses the current provider.
 */
export function sendMessageToAllClients(message: WebSocketMessage): void {
    if (!messagingProvider) {
        // Silently ignore if no provider - allows core to work without messaging
        console.debug("[Messaging] No provider initialized, message not sent:", message.type);
        return;
    }
    messagingProvider.sendMessageToAllClients(message);
}

/**
 * Message types excluded from broadcast logging: "frontend-update" fires on
 * every write transaction and embeds full entity payloads, "ping" fires on
 * every no-change transaction and carries no data, "api-log-messages" would
 * recursively log API log output, and "sync-failed" repeats on every failed
 * sync attempt.
 */
const UNLOGGED_MESSAGE_TYPES = new Set<WebSocketMessage["type"]>(["frontend-update", "ping", "sync-failed", "api-log-messages"]);

/**
 * Whether a broadcast message should be logged by the messaging provider,
 * filtering out types that are too frequent or noisy to log in full.
 */
export function shouldLogMessage(message: WebSocketMessage): boolean {
    return !UNLOGGED_MESSAGE_TYPES.has(message.type);
}

// Re-export types
export * from "./types.js";
