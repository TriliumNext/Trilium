import type { WebSocketMessage } from "@triliumnext/commons";
import {
    becca_loader,
    type ClientMessageHandler,
    cls,
    entity_changes,
    events,
    getLog,
    initializeCore,
    type MessagingProvider,
    options,
    type PlatformProvider,
    ws
} from "@triliumnext/core";
import ServerBackupService from "@triliumnext/server/src/backup_provider.js";
import AsyncLocalStorageExecutionContext from "@triliumnext/server/src/cls_provider.js";
import { loadCoreSchema } from "@triliumnext/server/src/core_assets.js";
import NodejsCryptoProvider from "@triliumnext/server/src/crypto_provider.js";
import NodejsInAppHelpProvider from "@triliumnext/server/src/in_app_help_provider.js";
import ServerLogService from "@triliumnext/server/src/log_provider.js";
import config from "@triliumnext/server/src/services/config.js";
import dataDirs from "@triliumnext/server/src/services/data_dir.js";
import { recoverInterruptedRestore } from "@triliumnext/server/src/services/database_restore.js";
import NodeRequestProvider from "@triliumnext/server/src/services/request.js";
import { RESOURCE_DIR } from "@triliumnext/server/src/services/resource_dir.js";
import { consumeSetupMarker, setupPlatform } from "@triliumnext/server/src/services/setup_marker.js";
import BetterSqlite3Provider from "@triliumnext/server/src/sql_provider.js";
import NodejsZipProvider from "@triliumnext/server/src/zip_provider.js";
import type { Application } from "express";
import fs from "fs";
import path from "path";

import { dispatch } from "../express_dispatch.js";
import { MAIN_PROCESS_OPTIONS } from "./protocol_types.js";
import type { BackendToMain, MainToBackend, PortRequest, PortResponse } from "./protocol_types.js";

/**
 * Trilium's backend — `@triliumnext/core`, SQLite and the Express app — running
 * inside an Electron `utilityProcess` instead of the main process.
 *
 * A long synchronous operation (a `VACUUM`, a flat-text search over a large
 * database) pins this process' only thread instead of the main process', which
 * is also Chromium's browser-process UI thread and therefore the thread that
 * routes input to the renderer and serves every `trilium-app://` request.
 *
 * The renderer reaches this process over a `MessagePort` handed to it at
 * startup, so an API call never touches main. That is the arrangement the
 * standalone build already uses between the page and its SQLite worker, down to
 * the `localFetch(Request): Promise<Response>` shape the client calls.
 */
const parentPort = process.parentPort;

let clientMessageHandler: ClientMessageHandler | undefined;
let expressApp: Application | undefined;

parentPort.on("message", (event) => {
    const [ transferred ] = event.ports ?? [];
    if (transferred) {
        attachRendererPort(transferred);
        return;
    }
    const message = event.data as MainToBackend;
    if (message.type === "client-message") {
        void clientMessageHandler?.(message.clientId, message.message);
    }
});

start().catch((err) => {
    send({ type: "crash", message: String(err instanceof Error ? err.stack ?? err.message : err) });
});

async function start() {
    recoverInterruptedRestore();

    const dbProvider = new BetterSqlite3Provider();
    dbProvider.loadFromFile(dataDirs.DOCUMENT_PATH, config.General.readOnly);

    await initializeCore({
        dbConfig: {
            provider: dbProvider,
            isReadOnly: config.General.readOnly,
            async onTransactionCommit() {
                ws.sendTransactionEntityChangesToAllClients();
            },
            async onTransactionRollback() {
                const entityChangeIds = cls.getAndClearEntityChangeIds();

                if (entityChangeIds.length > 0) {
                    getLog().info("Transaction rollback dirtied the becca, forcing reload.");

                    becca_loader.load();
                }

                entity_changes.recalculateMaxEntityChangeId();
            }
        },
        crypto: new NodejsCryptoProvider(),
        zip: new NodejsZipProvider(),
        zipExportProviderFactory: (await import("@triliumnext/server/src/services/export/zip/factory.js")).serverZipExportProviderFactory,
        request: new NodeRequestProvider(),
        executionContext: new AsyncLocalStorageExecutionContext(),
        messaging: new BridgedMessagingProvider(),
        schema: loadCoreSchema(),
        platform: new BackendPlatformProvider(),
        translations: (await import("@triliumnext/server/src/services/i18n.js")).initializeTranslations,
        getDemoArchive: async () => fs.readFileSync(path.join(RESOURCE_DIR, "db", "demo.zip")),
        inAppHelp: new NodejsInAppHelpProvider(),
        log: new ServerLogService(),
        backup: new ServerBackupService(options, {
            allowCustomDirectory: true,
            // The passphrase lives in the OS keyring behind Electron's
            // safeStorage, which only the main process can reach.
            getPassphrase: async () => null,
            setPassphrase: async () => {}
        }),
        image: (await import("@triliumnext/server/src/services/image_provider.js")).serverImageProvider,
        config,
        setupMarker: consumeSetupMarker(),
        setupPlatform,
        extraAppInfo: {
            nodeVersion: process.version,
            dataDirectory: path.resolve(dataDirs.TRILIUM_DATA_DIR)
        }
    });

    const startTriliumServer = (await import("@triliumnext/server/src/www.js")).default;
    expressApp = await startTriliumServer();

    watchMirroredOptions();
    send({ type: "ready", optionSnapshot: snapshotOptions() });
}

function send(message: BackendToMain) {
    parentPort.postMessage(message);
}

/**
 * Serves the renderer's API traffic. One message is one request, and the reply
 * carries the whole body — a streaming response is buffered here rather than
 * chunked across the port.
 */
function attachRendererPort(port: Electron.MessagePortMain) {
    port.on("message", async (event) => {
        const request = event.data as PortRequest;
        port.postMessage(await serve(request));
    });
    port.start();
}

async function serve(request: PortRequest): Promise<PortResponse> {
    try {
        const synthetic = serveSyntheticDelay(request);
        if (synthetic) {
            return synthetic;
        }
        if (!expressApp) {
            throw new Error("backend is still starting");
        }
        const init: RequestInit = {
            method: request.method,
            headers: request.headers
        };
        if (request.body) {
            init.body = Buffer.from(request.body);
        }
        const result = await dispatch(expressApp, new Request(request.url, init));
        return {
            id: request.id,
            status: result.status,
            statusText: result.statusText,
            headers: [ ...result.headers.entries() ],
            body: new Uint8Array(await result.arrayBuffer())
        };
    } catch (err) {
        return {
            id: request.id,
            status: 500,
            statusText: "Internal Server Error",
            headers: [ [ "content-type", "text/plain" ] ],
            body: new TextEncoder().encode(String(err))
        };
    }
}

/**
 * Stands in for a long synchronous backend operation, so the probe does not need
 * a database large enough for a `VACUUM` to take seconds. Spins the CPU without
 * yielding, exactly as `sql.execute("VACUUM")` and
 * `searchNotesForAutocomplete()` do. Only reachable when the spike harness asks
 * for it.
 */
function serveSyntheticDelay(request: PortRequest): PortResponse | undefined {
    if (!process.env.TRILIUM_SPIKE_SYNTHETIC_DELAY) {
        return undefined;
    }
    const url = new URL(request.url);
    if (url.pathname !== "/api/spike/busy") {
        return undefined;
    }
    const until = Date.now() + Number(url.searchParams.get("ms") ?? 0);
    let sink = 0;
    while (Date.now() < until) {
        for (let i = 0; i < 2000; i++) {
            sink += Math.sqrt(sink + i + 1);
        }
    }
    return {
        id: request.id,
        status: 200,
        statusText: "OK",
        headers: [ [ "content-type", "application/json" ] ],
        body: new TextEncoder().encode(JSON.stringify({ sink }))
    };
}

/**
 * Keeps main's replica current. A `BOption` save emits `ENTITY_CHANGED` like any
 * other entity, so re-reading the mirrored options there and pushing what moved
 * costs nothing on the far more common note and attribute changes.
 */
function watchMirroredOptions() {
    let previous = snapshotOptions();

    events.subscribe(events.ENTITY_CHANGED, ({ entityName }) => {
        if (entityName !== "options") {
            return;
        }
        const current = snapshotOptions();
        for (const [ name, value ] of Object.entries(current)) {
            if (previous[name] !== value) {
                send({ type: "option-changed", name, value });
            }
        }
        previous = current;
    });
}

function snapshotOptions(): Record<string, string> {
    const snapshot: Record<string, string> = {};
    for (const name of MAIN_PROCESS_OPTIONS) {
        const value = options.getOptionOrNull(name);
        if (value !== null) {
            snapshot[name] = value;
        }
    }
    return snapshot;
}

/** Relays core's WebSocket-shaped messages to main, which owns the BrowserWindows. */
class BridgedMessagingProvider implements MessagingProvider {
    sendMessageToAllClients(message: WebSocketMessage): void {
        send({ type: "ws", target: "all", message });
    }

    sendMessageToClient(clientId: string, message: WebSocketMessage): boolean {
        send({ type: "ws", target: clientId, message });
        return true;
    }

    setClientMessageHandler(handler: ClientMessageHandler): void {
        clientMessageHandler = handler;
    }

    getClientCount(): number {
        return 1;
    }
}

class BackendPlatformProvider implements PlatformProvider {
    readonly isElectron = true;
    readonly isMac = process.platform === "darwin";
    readonly isWindows = process.platform === "win32";
    readonly isLinux = process.platform === "linux";

    crash(message: string): void {
        send({ type: "crash", message });
    }

    getEnv(key: string): string | undefined {
        return process.env[key];
    }

    getDatabasePath(): string {
        return path.resolve(dataDirs.DOCUMENT_PATH);
    }

    shouldIgnoreStartupError(): boolean {
        return false;
    }
}
