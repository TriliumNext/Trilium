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

// Re-export types
export * from "./types.js";
