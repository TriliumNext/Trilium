import { WebSocketServer as WebSocketServer, WebSocket } from "ws";
import { isElectron, randomString } from "./utils.js";
import log from "./log.js";
import sql from "./sql.js";
import cls from "./cls.js";
import config from "./config.js";
import syncMutexService from "./sync_mutex.js";
import protectedSessionService from "./protected_session.js";
import becca from "../becca/becca.js";
import AbstractBeccaEntity from "../becca/entities/abstract_becca_entity.js";

import type { IncomingMessage, Server as HttpServer } from "http";
import { WebSocketMessage, type EntityChange } from "@triliumnext/commons";

let webSocketServer!: WebSocketServer;
let lastSyncedPush: number;

type SessionParser = (req: IncomingMessage, params: {}, cb: () => void) => void;
function init(httpServer: HttpServer, sessionParser: SessionParser) {
    webSocketServer = new WebSocketServer({
        verifyClient: (info, done) => {
            sessionParser(info.req, {}, () => {
                const allowed = isElectron || (info.req as any).session.loggedIn || (config.General && config.General.noAuthentication);

                if (!allowed) {
                    log.error("WebSocket connection not allowed because session is neither electron nor logged in.");
                }

                done(allowed);
            });
        },
        server: httpServer
    });

    webSocketServer.on("connection", (ws, req) => {
        (ws as any).id = randomString(10);

        console.log(`websocket client connected`);

        ws.on("message", async (messageJson) => {
            const message = JSON.parse(messageJson as any);

            if (message.type === "log-error") {
                log.info(`JS Error: ${message.error}\r
Stack: ${message.stack}`);
            } else if (message.type === "log-info") {
                log.info(`JS Info: ${message.info}`);
            } else if (message.type === "ping") {
                await syncMutexService.doExclusively(() => sendPing(ws));
            } else {
                log.error("Unrecognized message: ");
                log.error(message);
            }
        });
    });

    webSocketServer.on("error", (error) => {
        // https://github.com/zadam/trilium/issues/3374#issuecomment-1341053765
        console.log(error);
    });
}

function sendMessage(client: WebSocket, message: WebSocketMessage) {
    const jsonStr = JSON.stringify(message);

    if (client.readyState === WebSocket.OPEN) {
        client.send(jsonStr);
    }
}

function sendMessageToAllClients(message: WebSocketMessage) {
    const jsonStr = JSON.stringify(message);

    if (webSocketServer) {
        if (message.type !== "sync-failed" && message.type !== "api-log-messages") {
            log.info(`Sending message to all clients: ${jsonStr}`);
        }

        webSocketServer.clients.forEach(function each(client) {
            if (client.readyState === WebSocket.OPEN) {
                client.send(jsonStr);
            }
        });
    }
}

function fillInAdditionalProperties(entityChange: EntityChange) {
    if (entityChange.isErased) {
        return;
    }

    // fill in some extra data needed by the frontend
    // first try to use becca, which works for non-deleted entities
    // only when that fails, try to load from the database
    if (entityChange.entityName === "attributes") {
        entityChange.entity = becca.getAttribute(entityChange.entityId);

        if (!entityChange.entity) {
            entityChange.entity = sql.getRow(/*sql*/`SELECT * FROM attributes WHERE attributeId = ?`, [entityChange.entityId]);
        }
    } else if (entityChange.entityName === "branches") {
        entityChange.entity = becca.getBranch(entityChange.entityId);

        if (!entityChange.entity) {
            entityChange.entity = sql.getRow(/*sql*/`SELECT * FROM branches WHERE branchId = ?`, [entityChange.entityId]);
        }
    } else if (entityChange.entityName === "notes") {
        entityChange.entity = becca.getNote(entityChange.entityId);

        if (!entityChange.entity) {
            entityChange.entity = sql.getRow(/*sql*/`SELECT * FROM notes WHERE noteId = ?`, [entityChange.entityId]);

            if (entityChange.entity?.isProtected) {
                entityChange.entity.title = protectedSessionService.decryptString(entityChange.entity.title || "");
            }
        }
    } else if (entityChange.entityName === "revisions") {
        entityChange.noteId = sql.getValue<string>(
            /*sql*/`SELECT noteId
                                                    FROM revisions
                                                    WHERE revisionId = ?`,
            [entityChange.entityId]
        );
    } else if (entityChange.entityName === "note_reordering") {
        entityChange.positions = {};

        const parentNote = becca.getNote(entityChange.entityId);

        if (parentNote) {
            for (const childBranch of parentNote.getChildBranches()) {
                if (childBranch?.branchId) {
                    entityChange.positions[childBranch.branchId] = childBranch.notePosition;
                }
            }
        }
    } else if (entityChange.entityName === "options") {
        entityChange.entity = becca.getOption(entityChange.entityId);

        if (!entityChange.entity) {
            entityChange.entity = sql.getRow(/*sql*/`SELECT * FROM options WHERE name = ?`, [entityChange.entityId]);
        }
    } else if (entityChange.entityName === "attachments") {
        entityChange.entity = becca.getAttachment(entityChange.entityId);

        if (!entityChange.entity) {
            entityChange.entity = sql.getRow(
                /*sql*/`SELECT attachments.*, LENGTH(blobs.content) AS contentLength
                                                    FROM attachments
                                                    JOIN blobs USING (blobId)
                                                    WHERE attachmentId = ?`,
                [entityChange.entityId]
            );

            if (entityChange.entity?.isProtected) {
                entityChange.entity.title = protectedSessionService.decryptString(entityChange.entity.title || "");
            }
        }
    }

    if (entityChange.entity instanceof AbstractBeccaEntity) {
        entityChange.entity = entityChange.entity.getPojo();
    }
}

// entities with higher number can reference the entities with lower number
const ORDERING: Record<string, number> = {
    etapi_tokens: 0,
    attributes: 2,
    branches: 2,
    blobs: 0,
    note_reordering: 2,
    revisions: 2,
    attachments: 3,
    notes: 1,
    options: 0,
};

function sendPing(client: WebSocket, entityChangeIds = []) {
    if (entityChangeIds.length === 0) {
        sendMessage(client, { type: "ping" });

        return;
    }

    const entityChanges = sql.getManyRows<EntityChange>(/*sql*/`SELECT * FROM entity_changes WHERE id IN (???)`, entityChangeIds);
    if (!entityChanges) {
        return;
    }

    // sort entity changes since froca expects "referential order", i.e. referenced entities should already exist
    // in froca.
    // Froca needs this since it is an incomplete copy, it can't create "skeletons" like becca.
    entityChanges.sort((a, b) => ORDERING[a.entityName] - ORDERING[b.entityName]);

    for (const entityChange of entityChanges) {
        try {
            fillInAdditionalProperties(entityChange);
        } catch (e: any) {
            log.error(`Could not fill additional properties for entity change ${JSON.stringify(entityChange)} because of error: ${e.message}: ${e.stack}`);
        }
    }

    sendMessage(client, {
        type: "frontend-update",
        data: {
            lastSyncedPush,
            entityChanges
        }
    });
}

function sendTransactionEntityChangesToAllClients() {
    if (webSocketServer) {
        const entityChangeIds = cls.getAndClearEntityChangeIds();

        webSocketServer.clients.forEach((client) => sendPing(client, entityChangeIds));
    }
}

function syncPullInProgress() {
    sendMessageToAllClients({ type: "sync-pull-in-progress", lastSyncedPush });
}

function syncPushInProgress() {
    sendMessageToAllClients({ type: "sync-push-in-progress", lastSyncedPush });
}

function syncFinished() {
    sendMessageToAllClients({ type: "sync-finished", lastSyncedPush });
}

function syncFailed() {
    sendMessageToAllClients({ type: "sync-failed", lastSyncedPush });
}

function reloadFrontend(reason: string) {
    sendMessageToAllClients({ type: "reload-frontend", reason });
}

function setLastSyncedPush(entityChangeId: number) {
    lastSyncedPush = entityChangeId;
}

export default {
    init,
    sendMessageToAllClients,
    syncPushInProgress,
    syncPullInProgress,
    syncFinished,
    syncFailed,
    sendTransactionEntityChangesToAllClients,
    setLastSyncedPush,
    reloadFrontend
};
