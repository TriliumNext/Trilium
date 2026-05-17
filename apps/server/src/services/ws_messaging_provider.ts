import type { WebSocketMessage } from "@triliumnext/commons";
import type { ClientMessageHandler, MessagingProvider } from "@triliumnext/core";
import type { IncomingMessage, Server as HttpServer } from "http";
import type express from "express";
import { WebSocket, WebSocketServer } from "ws";

import config from "./config.js";
import log from "./log.js";
import { isElectron, randomString } from "./utils.js";

type SessionParser = (req: IncomingMessage, params: {}, cb: () => void) => void;

/**
 * WebSocket-based implementation of MessagingProvider.
 *
 * Handles the raw WebSocket transport: server setup, connection management,
 * message serialization, and client tracking.
 */
export default class WebSocketMessagingProvider implements MessagingProvider {
    private webSocketServer!: WebSocketServer;
    private clientMap = new Map<string, WebSocket>();
    private clientDbMap = new Map<string, string>(); // clientId → dbId
    private clientMessageHandler?: ClientMessageHandler;

    init(httpServer: HttpServer, sessionParser: express.RequestHandler) {
        this.webSocketServer = new WebSocketServer({
            verifyClient: (info, done) => {
                sessionParser(info.req as express.Request, {} as express.Response, () => {
                    const allowed = isElectron || (info.req as any).session.loggedIn || (config.General && config.General.noAuthentication);

                    if (!allowed) {
                        log.error("WebSocket connection not allowed because session is neither electron nor logged in.");
                    }

                    done(allowed);
                });
            },
            server: httpServer
        });

        this.webSocketServer.on("connection", (ws, req) => {
            const id = randomString(10);
            (ws as any).id = id;
            this.clientMap.set(id, ws);

            // Extract dbId from query string if provided (e.g. ws://...?dbId=xyz)
            const url = new URL(req.url || "", "http://localhost");
            const dbId = url.searchParams.get("dbId");
            if (dbId) {
                this.clientDbMap.set(id, dbId);
            }

            console.log(`websocket client connected${dbId ? ` (db: ${dbId})` : ""}`);

            ws.on("message", async (messageJson) => {
                const message = JSON.parse(messageJson as any);

                // Allow clients to register their dbId after connection
                if (message.type === "register-db" && message.dbId) {
                    this.clientDbMap.set(id, message.dbId);
                    return;
                }

                if (this.clientMessageHandler) {
                    await this.clientMessageHandler(id, message);
                }
            });

            ws.on("close", () => {
                this.clientMap.delete(id);
                this.clientDbMap.delete(id);
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

    sendMessageToAllClients(message: WebSocketMessage, dbId?: string): void {
        const jsonStr = JSON.stringify(message);

        if (this.webSocketServer) {
            if (message.type !== "sync-failed" && message.type !== "api-log-messages") {
                log.info(`Sending message to ${dbId ? `db:${dbId}` : "all"} clients: ${jsonStr}`);
            }

            for (const [clientId, ws] of this.clientMap) {
                if (ws.readyState !== WebSocket.OPEN) continue;

                // If dbId is specified, only send to clients registered to that database.
                // Clients without a registered dbId (legacy/default) receive all messages.
                if (dbId) {
                    const clientDb = this.clientDbMap.get(clientId);
                    if (clientDb && clientDb !== dbId) continue;
                }

                ws.send(jsonStr);
            }
        }
    }

    sendMessageToClient(clientId: string, message: WebSocketMessage): boolean {
        const client = this.clientMap.get(clientId);
        if (!client || client.readyState !== WebSocket.OPEN) {
            return false;
        }

        client.send(JSON.stringify(message));
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
