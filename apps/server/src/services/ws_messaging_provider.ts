import type { WebSocketMessage } from "@triliumnext/commons";
import { getLog, shouldLogMessage, type ClientMessageHandler, type MessagingProvider } from "@triliumnext/core";
import type { IncomingMessage, Server as HttpServer } from "http";
import type express from "express";
import { WebSocket, WebSocketServer } from "ws";

import config from "./config.js";
import { randomString } from "./utils.js";

type SessionParser = (req: IncomingMessage, params: {}, cb: () => void) => void;

/**
 * A messaging provider that serves clients over the TCP HTTP listener and so
 * needs the `http.Server` (and session parser for auth) handed to it once www.ts
 * has built them. www.ts detects this capability via the type guard below rather
 * than a concrete `instanceof`, so a desktop composite that wraps a WS provider
 * qualifies too.
 */
export interface HttpAttachableMessagingProvider extends MessagingProvider {
    attachToHttpServer(httpServer: HttpServer, sessionParser: express.RequestHandler): void;
    /** Asks every client connected over the TCP listener to reload, then closes its connection. */
    disconnectAllClients(reason: string): void;
}

export function isHttpAttachableMessagingProvider(provider: MessagingProvider): provider is HttpAttachableMessagingProvider {
    return typeof (provider as Partial<HttpAttachableMessagingProvider>).attachToHttpServer === "function";
}

/**
 * WebSocket-based implementation of MessagingProvider.
 *
 * Handles the raw WebSocket transport: server setup, connection management,
 * message serialization, and client tracking.
 *
 * Used directly by the server build, and by the Electron desktop build only when
 * the user has opted into LAN/network access — there it's wrapped in a composite
 * alongside the IPC provider so browser clients get live updates while the trusted
 * renderer keeps talking over IPC. Without that opt-in the desktop binds no WS
 * endpoint. See `apps/desktop/src/composite_messaging_provider.ts`.
 */
export default class WebSocketMessagingProvider implements HttpAttachableMessagingProvider {
    private webSocketServer!: WebSocketServer;
    private clientMap = new Map<string, WebSocket>();
    private clientMessageHandler?: ClientMessageHandler;

    attachToHttpServer(httpServer: HttpServer, sessionParser: express.RequestHandler) {
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
            this.clientMap.set(id, ws);

            console.log(`websocket client connected`);

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

    /**
     * Asks every client to reload, then closes its connection. `verifyClient` checks the session
     * only when a connection opens, so a revoked session keeps receiving messages until then.
     */
    disconnectAllClients(reason: string): void {
        const jsonStr = JSON.stringify({ type: "reload-frontend", reason } satisfies WebSocketMessage);

        for (const client of this.webSocketServer?.clients ?? []) {
            if (client.readyState === WebSocket.OPEN) {
                client.send(jsonStr);
            }
            client.close();
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
