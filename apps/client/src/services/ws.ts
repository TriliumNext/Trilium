import utils from "./utils.js";
import toastService from "./toast.js";
import server from "./server.js";
import options from "./options.js";
import frocaUpdater from "./froca_updater.js";
import appContext from "../components/app_context.js";
import { t } from "./i18n.js";
import type { EntityChange } from "../server_types.js";
import { WebSocketMessage } from "@triliumnext/commons";
import toast from "./toast.js";

type MessageHandler = (message: WebSocketMessage) => void;
let messageHandlers: MessageHandler[] = [];

let ws: WebSocket;
let lastAcceptedEntityChangeId = window.glob.maxEntityChangeIdAtLoad;
let lastAcceptedEntityChangeSyncId = window.glob.maxEntityChangeSyncIdAtLoad;
let lastProcessedEntityChangeId = window.glob.maxEntityChangeIdAtLoad;
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

async function handleMessage(event: MessageEvent<any>) {
    const message = JSON.parse(event.data);

    for (const messageHandler of messageHandlers) {
        messageHandler(message);
    }

    if (message.type === "ping") {
        lastPingTs = Date.now();
    } else if (message.type === "reload-frontend") {
        utils.reloadFrontendApp("received request from backend to reload frontend");
    } else if (message.type === "frontend-update") {
        await executeFrontendUpdate(message.data.entityChanges);
    } else if (message.type === "sync-hash-check-failed") {
        toastService.showError(t("ws.sync-check-failed"), 60000);
    } else if (message.type === "consistency-checks-failed") {
        toastService.showError(t("ws.consistency-checks-failed"), 50 * 60000);
    } else if (message.type === "api-log-messages") {
        appContext.triggerEvent("apiLogMessages", { noteId: message.noteId, messages: message.messages });
    } else if (message.type === "toast") {
        toastService.showMessage(message.message);
    } else if (message.type === "execute-script") {
        // TODO: Remove after porting the file
        // @ts-ignore
        const bundleService = (await import("./bundle.js")).default as any;
        // TODO: Remove after porting the file
        // @ts-ignore
        const froca = (await import("./froca.js")).default as any;
        const originEntity = message.originEntityId ? await froca.getNote(message.originEntityId) : null;

        bundleService.getAndExecuteBundle(message.currentNoteId, originEntity, message.script, message.params);
    }
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
            desiredEntityChangeId: desiredEntityChangeId,
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
    ws.onmessage = handleMessage;
    // we're not handling ws.onclose here because reconnection is done in sendPing()

    return ws;
}

async function sendPing() {
    if (Date.now() - lastPingTs > 30000) {
        console.warn(utils.now(), "Lost websocket connection to the backend");
        toast.showPersistent({
            id: "lost-websocket-connection",
            title: t("ws.lost-websocket-connection-title"),
            message: t("ws.lost-websocket-connection-message"),
            icon: "no-signal"
        });
    }

    if (ws.readyState === ws.OPEN) {
        toast.closePersistent("lost-websocket-connection");
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
