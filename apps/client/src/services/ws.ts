import { WebSocketMessage } from "@triliumnext/commons";

import appContext from "../components/app_context.js";
import type { EntityChange } from "../server_types.js";
import bundleService from "./bundle.js";
import froca from "./froca.js";
import frocaUpdater from "./froca_updater.js";
import { t } from "./i18n.js";
import options from "./options.js";
import server from "./server.js";
import toastService from "./toast.js";
import utils from "./utils.js";

type MessageHandler = (message: WebSocketMessage) => void;
let messageHandlers: MessageHandler[] = [];

let ws: WebSocket;
let lastAcceptedEntityChangeId = window.glob.maxEntityChangeIdAtLoad ?? 0;
let lastAcceptedEntityChangeSyncId = window.glob.maxEntityChangeSyncIdAtLoad ?? 0;
let lastProcessedEntityChangeId = window.glob.maxEntityChangeIdAtLoad ?? 0;
let lastPingTs: number;
let frontendUpdateDataQueue: EntityChange[] = [];

export function logError(message: string) {
    console.error(utils.now(), message); // needs to be separate from .trace()

    if (ws && ws.readyState === 1) {
        ws.send(
            JSON.stringify({
                type: "log-error",
                error: message,
                stack: new Error().stack
            })
        );
    }
}

function logInfo(message: string) {
    console.log(utils.now(), message);

    if (ws && ws.readyState === 1) {
        ws.send(
            JSON.stringify({
                type: "log-info",
                info: message
            })
        );
    }
}

window.logError = logError;
window.logInfo = logInfo;

export function subscribeToMessages(messageHandler: MessageHandler) {
    messageHandlers.push(messageHandler);
}

export function unsubscribeToMessage(messageHandler: MessageHandler) {
    messageHandlers = messageHandlers.filter(handler => handler !== messageHandler);
}

/**
 * Dispatch a message to all handlers and process it.
 * This is the main entry point for incoming messages from any provider
 * (WebSocket, Worker, etc.)
 */
export async function dispatchMessage(message: WebSocketMessage) {
    // Notify all subscribers
    for (const messageHandler of messageHandlers) {
        messageHandler(message);
    }

    // Use string type for flexibility - server sends more message types than are typed
    const messageType = message.type as string;
    const msg = message as any;

    // Process the message
    if (messageType === "ping") {
        lastPingTs = Date.now();
    } else if (messageType === "reload-frontend") {
        utils.reloadFrontendApp("received request from backend to reload frontend");
    } else if (messageType === "frontend-update") {
        await executeFrontendUpdate(msg.data.entityChanges);
    } else if (messageType === "sync-hash-check-failed") {
        toastService.showError(t("ws.sync-check-failed"), 60000);
    } else if (messageType === "consistency-checks-failed") {
        toastService.showError(t("ws.consistency-checks-failed"), 50 * 60000);
    } else if (messageType === "api-log-messages") {
        appContext.triggerEvent("apiLogMessages", { noteId: msg.noteId, messages: msg.messages });
    } else if (messageType === "toast") {
        toastService.showMessage(msg.message, msg.timeout);
    } else if (messageType === "execute-script") {
        const originEntity = msg.originEntityId ? await froca.getNote(msg.originEntityId) : null;

        bundleService.getAndExecuteBundle(msg.currentNoteId, originEntity, msg.script, msg.params);
    }
}

// used to serialize frontend update operations
let consumeQueuePromise: Promise<void> | null = null;

// to make sure each change event is processed only once. Not clear if this is still necessary
const processedEntityChangeIds = new Set();

function logRows(entityChanges: EntityChange[]) {
    const filteredRows = entityChanges.filter((row) => !processedEntityChangeIds.has(row.id) && (row.entityName !== "options" || row.entityId !== "openNoteContexts"));

    if (filteredRows.length > 0) {
        console.debug(utils.now(), "Frontend update data: ", filteredRows);
    }
}

async function executeFrontendUpdate(entityChanges: EntityChange[]) {
    lastPingTs = Date.now();

    if (entityChanges.length > 0) {
        logRows(entityChanges);

        frontendUpdateDataQueue.push(...entityChanges);

        // we set lastAcceptedEntityChangeId even before frontend update processing and send ping so that backend can start sending more updates

        for (const entityChange of entityChanges) {
            if (!entityChange.id) {
                continue;
            }

            lastAcceptedEntityChangeId = Math.max(lastAcceptedEntityChangeId, entityChange.id);

            if (entityChange.isSynced) {
                lastAcceptedEntityChangeSyncId = Math.max(lastAcceptedEntityChangeSyncId, entityChange.id);
            }
        }

        sendPing();

        // first wait for all the preceding consumers to finish
        while (consumeQueuePromise) {
            await consumeQueuePromise;
        }

        try {
            // it's my turn, so start it up
            consumeQueuePromise = consumeFrontendUpdateData();

            await consumeQueuePromise;
        } finally {
            // finish and set to null to signal somebody else can pick it up
            consumeQueuePromise = null;
        }
    }
}

/**
 * WebSocket message handler - parses the event and dispatches to generic handler.
 * This is only used in WebSocket mode (not standalone).
 */
async function handleWebSocketMessage(event: MessageEvent<string>) {
    const message = JSON.parse(event.data) as WebSocketMessage;
    await dispatchMessage(message);
}

let entityChangeIdReachedListeners: {
    desiredEntityChangeId: number;
    resolvePromise: () => void;
    start: number;
}[] = [];

function waitForEntityChangeId(desiredEntityChangeId: number) {
    if (desiredEntityChangeId <= lastProcessedEntityChangeId) {
        return Promise.resolve();
    }

    console.debug(`Waiting for ${desiredEntityChangeId}, last processed is ${lastProcessedEntityChangeId}, last accepted ${lastAcceptedEntityChangeId}`);

    return new Promise<void>((res, rej) => {
        entityChangeIdReachedListeners.push({
            desiredEntityChangeId,
            resolvePromise: res,
            start: Date.now()
        });
    });
}

function waitForMaxKnownEntityChangeId() {
    return waitForEntityChangeId(server.getMaxKnownEntityChangeId());
}

function checkEntityChangeIdListeners() {
    entityChangeIdReachedListeners.filter((l) => l.desiredEntityChangeId <= lastProcessedEntityChangeId).forEach((l) => l.resolvePromise());

    entityChangeIdReachedListeners = entityChangeIdReachedListeners.filter((l) => l.desiredEntityChangeId > lastProcessedEntityChangeId);

    entityChangeIdReachedListeners
        .filter((l) => Date.now() > l.start - 60000)
        .forEach((l) =>
            console.log(
                `Waiting for entityChangeId ${l.desiredEntityChangeId} while last processed is ${lastProcessedEntityChangeId} (last accepted ${lastAcceptedEntityChangeId}) for ${Math.floor((Date.now() - l.start) / 1000)}s`
            )
        );
}

async function consumeFrontendUpdateData() {
    if (frontendUpdateDataQueue.length > 0) {
        const allEntityChanges = frontendUpdateDataQueue;
        frontendUpdateDataQueue = [];

        const nonProcessedEntityChanges = allEntityChanges.filter((ec) => !processedEntityChangeIds.has(ec.id));

        try {
            await utils.timeLimit(frocaUpdater.processEntityChanges(nonProcessedEntityChanges), 30000);
        } catch (e: any) {
            logError(`Encountered error ${e.message}: ${e.stack}, reloading frontend.`);

            if (!glob.isDev && !options.is("debugModeEnabled")) {
                // if there's an error in updating the frontend, then the easy option to recover is to reload the frontend completely

                utils.reloadFrontendApp();
            } else {
                console.log("nonProcessedEntityChanges causing the timeout", nonProcessedEntityChanges);

                toastService.showError(t("ws.encountered-error", { message: e.message }));
            }
        }

        for (const entityChange of nonProcessedEntityChanges) {
            processedEntityChangeIds.add(entityChange.id);

            if (entityChange.id) {
                lastProcessedEntityChangeId = Math.max(lastProcessedEntityChangeId, entityChange.id);
            }
        }
    }

    checkEntityChangeIdListeners();
}

function connectWebSocket() {
    const loc = window.location;
    const webSocketUri = `${loc.protocol === "https:" ? "wss:" : "ws:"}//${loc.host}${loc.pathname}`;

    // use wss for secure messaging
    const ws = new WebSocket(webSocketUri);
    ws.onopen = () => console.debug(utils.now(), `Connected to server ${webSocketUri} with WebSocket`);
    ws.onmessage = handleWebSocketMessage;
    // we're not handling ws.onclose here because reconnection is done in sendPing()

    return ws;
}

async function sendPing() {
    if (!ws) {
        // In standalone mode, there's no WebSocket — nothing to ping.
        return;
    }

    if (Date.now() - lastPingTs > 30000) {
        console.warn(utils.now(), "Lost websocket connection to the backend");
        toastService.showPersistent({
            id: "lost-websocket-connection",
            title: t("ws.lost-websocket-connection-title"),
            message: t("ws.lost-websocket-connection-message"),
            icon: "no-signal"
        });
    }

    if (ws.readyState === ws.OPEN) {
        toastService.closePersistent("lost-websocket-connection");
        ws.send(
            JSON.stringify({
                type: "ping",
                lastEntityChangeId: lastAcceptedEntityChangeId
            })
        );
    } else if (ws.readyState === ws.CLOSED || ws.readyState === ws.CLOSING) {
        console.log(utils.now(), "WS closed or closing, trying to reconnect");

        ws = connectWebSocket();
    }
}

setTimeout(() => {
    if (glob.device === "print") return;
    if (!glob.dbInitialized) return;

    if (glob.isStandalone) {
        // In standalone mode, listen for messages from the local worker via custom event
        window.addEventListener("trilium:ws-message", ((event: CustomEvent<WebSocketMessage>) => {
            dispatchMessage(event.detail);
        }) as EventListener);
        console.debug(utils.now(), "Standalone mode: listening for worker messages");
        return;
    }

    // Normal mode: use WebSocket
    ws = connectWebSocket();

    lastPingTs = Date.now();

    setInterval(sendPing, 1000);
}, 0);

export function throwError(message: string) {
    logError(message);

    throw new Error(message);
}

export default {
    logError,
    subscribeToMessages,
    waitForMaxKnownEntityChangeId,
    getMaxKnownEntityChangeSyncId: () => lastAcceptedEntityChangeSyncId
};
