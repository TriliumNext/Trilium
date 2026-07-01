import type { WebSocketMessage } from "@triliumnext/commons";
import { getLog, shouldLogMessage, type ClientMessageHandler, type MessagingProvider } from "@triliumnext/core";
import type { IncomingMessage, Server as HttpServer } from "http";
import type express from "express";
import { WebSocket, WebSocketServer } from "ws";

import config from "./config.js";
import { randomString } from "./utils.js";

type SessionParser = (req: IncomingMessage, params: {}, cb: () => void) => void;

/**
 * WebSocket-based implementation of MessagingProvider.
 *
 * Handles the raw WebSocket transport: server setup, connection management,
 * message serialization, and client tracking.
 *
 * Note: this provider is no longer used by the Electron desktop build —
 * desktop runs IpcMessagingProvider instead so the renderer↔server messaging
 * channel never crosses a TCP socket. See `apps/server/src/main.ts`.
 */
interface ClientEntry {
    ws: WebSocket;
    userId?: string;
}

export default class WebSocketMessagingProvider implements MessagingProvider {
    private webSocketServer!: WebSocketServer;
    private clientMap = new Map<string, ClientEntry>();
    private clientMessageHandler?: ClientMessageHandler;

    init(httpServer: HttpServer, sessionParser: express.RequestHandler) {
        this.webSocketServer = new WebSocketServer({
            verifyClient: (info, done) => {
                sessionParser(info.req as express.Request, {} as express.Response, () => {
                    const allowed = (info.req as any).session.loggedIn || (config.General && config.General.noAuthentication);

                    if (!allowed) {
                        getLog().error("WebSocket connection not allowed: session is not logged in.");
                    }

                    done(allowed);
                });
            },
            server: httpServer
        });

        this.webSocketServer.on("connection", (ws, req) => {
            const id = randomString(10);
            (ws as any).id = id;
            const userId: string | undefined = (req as any).session?.userId;
            this.clientMap.set(id, { ws, userId });

            console.log(`websocket client connected (clientId=${id})`);

            ws.on("error", (error) => {
                // A protocol error on a single connection (e.g. WS_ERR_INVALID_CLOSE_CODE from a
                // malformed close frame sent by a browser going to sleep) emits an "error" event on
                // this socket. Without a listener, Node's EventEmitter rethrows it as an uncaught
                // exception and crashes the whole process. Log and drop the connection instead.
                // https://github.com/TriliumNext/Trilium/issues/9598
                console.error("WebSocket connection error:", error);
                this.clientMap.delete(id);
            });

            ws.on("message", (messageJson) => {
                void (async () => {
                    try {
                        const message = JSON.parse(messageJson as any);

                        if (this.clientMessageHandler) {
                            await this.clientMessageHandler(id, message);
                        }
                    } catch (e) {
                        // A malformed message (invalid JSON) or a failing handler must not
                        // crash the process via an unhandled rejection on this floating promise.
                        console.error("Failed to process websocket message:", e);
                    }
                })();
            });

            ws.on("close", () => {
                this.clientMap.delete(id);
            });
        });

        this.webSocketServer.on("error", (error) => {
            // https://github.com/zadam/trilium/issues/3374#issuecomment-1341053765
            console.log(error);
        });
    }

    /**
     * Register a handler for incoming client messages.
     */
    setClientMessageHandler(handler: ClientMessageHandler) {
        this.clientMessageHandler = handler;
    }

    sendMessageToAllClients(message: WebSocketMessage): void {
        const jsonStr = JSON.stringify(message);

        if (this.webSocketServer) {
            if (shouldLogMessage(message)) {
                getLog().info(`Sending message to all clients: ${jsonStr}`);
            }

            this.webSocketServer.clients.forEach((client) => {
                if (client.readyState === WebSocket.OPEN) {
                    client.send(jsonStr);
                }
            });
        }
    }

    sendMessageToUserClients(userId: string, message: WebSocketMessage): void {
        const jsonStr = JSON.stringify(message);
        for (const entry of this.clientMap.values()) {
            if (entry.userId === userId && entry.ws.readyState === WebSocket.OPEN) {
                entry.ws.send(jsonStr);
            }
        }
    }

    sendMessageToClient(clientId: string, message: WebSocketMessage): boolean {
        const entry = this.clientMap.get(clientId);
        if (!entry || entry.ws.readyState !== WebSocket.OPEN) {
            return false;
        }

        entry.ws.send(JSON.stringify(message));
        return true;
    }

    getClientCount(): number {
        return this.webSocketServer?.clients?.size ?? 0;
    }

    dispose(): void {
        this.webSocketServer?.close();
        this.clientMap.clear();
    }
}
