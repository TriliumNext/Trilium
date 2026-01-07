import type { WebSocketMessage } from "@triliumnext/commons";
import { sendMessageToAllClients as sendMessage } from "./messaging/index.js";

/**
 * WebSocket service abstraction for core.
 * 
 * This module provides a simple interface for sending messages to clients.
 * The actual transport mechanism is provided by the messaging provider
 * configured during initialization.
 * 
 * @deprecated Use the messaging module directly instead.
 */
export default {
    /**
     * Send a message to all connected clients.
     */
    sendMessageToAllClients(message: WebSocketMessage) {
        sendMessage(message);
    }
}
