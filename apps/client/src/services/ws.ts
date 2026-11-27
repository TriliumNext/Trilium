import { WebSocketMessage } from "@triliumnext/commons";

import appContext from "../components/app_context.js";
import type { EntityChange } from "../server_types.js";
import froca from "./froca.js";
import frocaUpdater, { getLoggableEntityChange } from "./froca_updater.js";
import { t } from "./i18n.js";
import options from "./options.js";
import server from "./server.js";
import toastService, { showUnhandledError } from "./toast.js";
import utils, { getErrorMessage, isPreAuthScreen } from "./utils.js";

type MessageHandler = (message: WebSocketMessage) => void;
let messageHandlers: MessageHandler[] = [];

let ws: WebSocket;
// In Electron desktop, messaging goes over Chromium IPC (no TCP socket,
// no auth). The bridge is exposed by the preload script; when present we
// skip the WebSocket entirely.
/* v8 ignore next -- `window` is always defined wherever this module loads (browser/electron); the SSR-style guard's else arm is unreachable */
const ipcWs = typeof window !== "undefined" ? window.electronApi?.ws : undefined;
let lastAcceptedEntityChangeId = window.glob.maxEntityChangeIdAtLoad ?? 0;
let lastAcceptedEntityChangeSyncId = window.glob.maxEntityChangeSyncIdAtLoad ?? 0;
let lastProcessedEntityChangeId = window.glob.maxEntityChangeIdAtLoad ?? 0;
let lastPingTs: number;
let unansweredPingSince: number | null = null;
let frontendUpdateDataQueue: EntityChange[] = [];

/** The close code that the backend sends when it refuses the CSRF token of a connection. */
const CSRF_REFUSED_CLOSE_CODE = 4403;
/** Whether the token was renewed after a refusal since the last admitted connection. */
let isCsrfTokenRenewed = false;
let isRenewingCsrfToken = false;
/** Whether the renewed token was refused too, after which the socket stays closed. */
let areLiveUpdatesRefused = false;

function sendOutgoing(message: object): boolean {
    if (ipcWs) {
        ipcWs.send(message);
        return true;
    }
    if (ws && ws.readyState === 1) {
        ws.send(JSON.stringify(message));
        return true;
    }
    return false;
}

export function logError(message: string) {
    console.error(utils.now(), message); // needs to be separate from .trace()

    sendOutgoing({
        type: "log-error",
        error: message,
        stack: new Error().stack
    });
}

function logInfo(message: string) {
    console.log(utils.now(), message);

    sendOutgoing({
        type: "log-info",
        info: message
    });
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
        unansweredPingSince = null;
        toastService.closePersistent("lost-websocket-connection");

        // The backend expires the protected session with a one-shot `reload-frontend` broadcast;
        // if the connection was down at that moment, the client would keep showing decrypted
        // notes indefinitely. Ping replies carry the live backend state, so recover here.
        if (msg.protectedSessionAvailable === false && glob.isProtectedSessionAvailable) {
            utils.reloadFrontendApp("protected session expired on the backend");
        }
    } else if (messageType === "reload-frontend") {
        utils.reloadFrontendApp("received request from backend to reload frontend");
    } else if (messageType === "reload-froca") {
        logInfo(`Reloading froca: ${msg.reason}`);
        await reloadFroca();
    } else if (messageType === "frontend-update") {
        await executeFrontendUpdate(msg.data.entityChanges);
    } else if (messageType === "sync-hash-check-failed") {
        // Not auto-dismissed after the usual few seconds: syncing stays broken until the user acts,
        // and the backend only reports it once (it would otherwise recur with every sync attempt).
        // The sector list is interpolated unescaped ({{- }}) since the toast renders its message as
        // text: i18next's HTML escaping would only turn the `entityName/sector` slash into a
        // literal `&#x2F;`.
        toastService.showErrorTitleAndMessage(
            t("ws.sync-hash-check-failed-title"),
            t("ws.sync-hash-check-failed", { sectors: (msg.sectors ?? []).join(", ") }),
            50 * 60000
        );
    } else if (messageType === "consistency-checks-failed") {
        toastService.showError(t("ws.consistency-checks-failed"), 50 * 60000);
    } else if (messageType === "api-log-messages") {
        appContext.triggerEvent("apiLogMessages", { noteId: msg.noteId, messages: msg.messages });
    } else if (messageType === "toast") {
        toastService.showMessage(msg.message, msg.timeout);
    } else if (messageType === "unhandled-error") {
        showUnhandledError(msg.message, msg.stack);
    } else if (messageType === "execute-script") {
        const originEntity = msg.originEntityId ? await froca.getNote(msg.originEntityId) : null;
        const { default: bundleService } = await import("./bundle.js");

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
        console.debug(utils.now(), "Frontend update data: ",
            filteredRows.map(getLoggableEntityChange));
    }
}

async function executeFrontendUpdate(entityChanges: EntityChange[]) {
    lastPingTs = Date.now();
    unansweredPingSince = null;
    toastService.closePersistent("lost-websocket-connection");

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

        await runInUpdateQueue(consumeFrontendUpdateData);
    }
}

/**
 * Rebuilds froca from the backend and has the widgets switch to the new objects. It runs in the
 * update queue, so entity changes that arrive meanwhile apply on top of the rebuilt cache.
 */
export async function reloadFroca() {
    await runInUpdateQueue(async () => {
        try {
            await froca.reloadAll();
            await appContext.triggerEvent("frocaReloaded", {});
        } catch (e: unknown) {
            // A partly rebuilt froca is not safe to keep using.
            utils.reloadFrontendApp(`rebuilding froca failed: ${getErrorMessage(e)}`);
        }
    });
}

/**
 * Runs `task` once the tasks queued before it finish. `task` must handle its own errors: a
 * rejection would also reject every task waiting behind it, leaving their changes unapplied.
 */
async function runInUpdateQueue(task: () => Promise<void>) {
    // first wait for all the preceding consumers to finish
    while (consumeQueuePromise) {
        await consumeQueuePromise;
    }

    try {
        // it's my turn, so start it up
        consumeQueuePromise = task();

        await consumeQueuePromise;
    } finally {
        // finish and set to null to signal somebody else can pick it up
        consumeQueuePromise = null;
    }
}

/**
 * WebSocket message handler - parses the event and dispatches to generic handler.
 * This is only used in WebSocket mode (not standalone).
 */
async function handleWebSocketMessage(event: MessageEvent<string>) {
    // Messages arrive only over a connection that the backend admitted.
    isCsrfTokenRenewed = false;
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
                utils.reloadFrontendApp(`processing entity changes failed: ${e.message}`);
            } else {
                console.log("nonProcessedEntityChanges causing the timeout",
                    nonProcessedEntityChanges.map(getLoggableEntityChange));

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
    // In Electron, the page lives on `trilium-app://app/`, so deriving the
    // WS URL from window.location would point at an unreachable host. The
    // server injects an absolute `wsBaseUrl` (ws://127.0.0.1:<port>/) for
    // that case; everywhere else we still derive it from the page origin.
    const loc = window.location;
    const webSocketUri = window.glob.wsBaseUrl
        ?? `${loc.protocol === "https:" ? "wss:" : "ws:"}//${loc.host}${loc.pathname}`;

    // use wss for secure messaging
    const ws = new WebSocket(webSocketUri);
    ws.onopen = () => {
        // The backend admits a connection only when its first message is the page's CSRF token.
        ws.send(JSON.stringify({ type: "csrf-token", token: glob.csrfToken }));
        console.debug(utils.now(), `Connected to server ${webSocketUri} with WebSocket`);
    };
    ws.onmessage = handleWebSocketMessage;
    // Reconnection is done in sendPing(), except after a refused token.
    ws.onclose = (event) => {
        if (event.code === CSRF_REFUSED_CLOSE_CODE) {
            void renewRefusedToken();
        }
    };

    return ws;
}

/** Connects again once with a new CSRF token, and stops after a second refusal. */
async function renewRefusedToken() {
    if (isCsrfTokenRenewed) {
        areLiveUpdatesRefused = true;
        showLostConnectionToast();
        return;
    }

    isCsrfTokenRenewed = true;
    isRenewingCsrfToken = true;
    try {
        await server.refreshCsrfToken();
    } finally {
        isRenewingCsrfToken = false;
    }
    ws = connectWebSocket();
}

function showLostConnectionToast() {
    toastService.showPersistent({
        id: "lost-websocket-connection",
        title: t("ws.lost-websocket-connection-title"),
        message: t("ws.lost-websocket-connection-message"),
        icon: "no-signal"
    });
}

async function sendPing() {
    if (ipcWs) {
        // IPC transport: no socket to disconnect, so we only need to nudge
        // the server for pending entity changes. No lost-connection toast
        // and no reconnect.
        sendOutgoing({ type: "ping", lastEntityChangeId: lastAcceptedEntityChangeId });
        return;
    }

    if (!ws) {
        // In standalone mode, there's no WebSocket — nothing to ping.
        return;
    }

    const now = Date.now();
    const isConnectionLost = unansweredPingSince !== null && now - unansweredPingSince > 30000;

    if (isConnectionLost) {
        console.warn(utils.now(), "Lost websocket connection to the backend");
        showLostConnectionToast();
    }

    if (ws.readyState === ws.OPEN) {
        if (!isConnectionLost) {
            toastService.closePersistent("lost-websocket-connection");
        }
        if (unansweredPingSince === null) {
            unansweredPingSince = now;
        }
        ws.send(
            JSON.stringify({
                type: "ping",
                lastEntityChangeId: lastAcceptedEntityChangeId
            })
        );
    } else {
        if (unansweredPingSince === null) {
            unansweredPingSince = now;
        }
        const isReconnectHeld = isRenewingCsrfToken || areLiveUpdatesRefused;
        if ((ws.readyState === ws.CLOSED || ws.readyState === ws.CLOSING) && !isReconnectHeld) {
            console.log(utils.now(), "WS closed or closing, trying to reconnect");

            ws = connectWebSocket();
        }
    }
}

setTimeout(() => {
    if (glob.device === "print") return;
    // Skip on the setup screen (!dbInitialized) and on the login / set-password pre-auth
    // screens (isPreAuthScreen) — otherwise the browser opens a WebSocket it isn't authorised
    // for, which the server refuses (#10589).
    if (!glob.dbInitialized || isPreAuthScreen()) return;

    if (glob.isStandalone) {
        // In standalone mode, listen for messages from the local worker via custom event
        window.addEventListener("trilium:ws-message", ((event: CustomEvent<WebSocketMessage>) => {
            dispatchMessage(event.detail);
        }) as EventListener);
        console.debug(utils.now(), "Standalone mode: listening for worker messages");
        return;
    }

    if (ipcWs) {
        // Electron desktop: messages arrive via the preload-exposed IPC
        // bridge instead of a WebSocket. The server-side counterpart is
        // IpcMessagingProvider.
        ipcWs.onMessage((message) => {
            void dispatchMessage(message as WebSocketMessage);
        });
        console.debug(utils.now(), "Electron mode: listening for IPC messages");

        lastPingTs = Date.now();
        setInterval(sendPing, 1000);
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
    reloadFroca,
    getMaxKnownEntityChangeSyncId: () => lastAcceptedEntityChangeSyncId
};
