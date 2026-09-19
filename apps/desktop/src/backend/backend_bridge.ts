import type { WebSocketMessage } from "@triliumnext/commons";
import electron, { MessageChannelMain, utilityProcess, type UtilityProcess, type WebContents } from "electron";
import path from "path";

import type { BackendToMain, MainToBackend, PortRequest, PortResponse } from "./protocol_types.js";

/**
 * Main-process half of the out-of-process backend.
 *
 * Owns the `utilityProcess` that runs `@triliumnext/core`, SQLite and the Express
 * app, and hands each renderer a `MessagePort` straight to it — so an API call
 * from the page never touches the main process, and a long synchronous backend
 * operation cannot stall the thread that routes input to the renderer.
 *
 * Main keeps a port of its own for what the renderer cannot ask for over the
 * page's transport: the initial document, scripts, styles and images, which
 * Chromium requests on the `trilium-app://` scheme and therefore delivers to
 * `protocol.handle` here.
 */
const IPC_TO_RENDERER = "trilium-ws-message";
const IPC_BACKEND_PORT = "trilium-backend-port";

export interface BackendHandle {
    /** Resolves with the options main reads synchronously, once the database is open. */
    ready: Promise<Record<string, string>>;
    /** Serves a `trilium-app://` request by dispatching it in the backend process. */
    dispatch(request: Request): Promise<Response>;
    /** Gives one renderer its own direct port to the backend. */
    attachRenderer(webContents: WebContents): void;
    /** Forwards a renderer's WebSocket-style message to core. */
    sendClientMessage(clientId: string, message: unknown): void;
    /** Latest value of an option main mirrors, as pushed by the backend. */
    onOptionChanged(listener: (name: string, value: string) => void): void;
}

export function startBackendProcess(): BackendHandle {
    const entry = path.join(__dirname, ENTRY_FILE);
    const child = utilityProcess.fork(entry, [], {
        stdio: "inherit",
        // Dev runs from TypeScript sources; the production bundle emits plain JS.
        execArgv: process.env.TRILIUM_ENV === "dev" ? [ "--import", "tsx" ] : []
    });

    const optionListeners: ((name: string, value: string) => void)[] = [];
    const ready = new Promise<Record<string, string>>((resolve, reject) => {
        child.on("message", (message: BackendToMain) => {
            switch (message.type) {
                case "ready":
                    resolve(message.optionSnapshot);
                    break;
                case "crash":
                    console.error(`[backend] ${message.message}`);
                    reject(new Error(message.message));
                    break;
                case "ws":
                    relayToRenderers(message.target, message.message);
                    break;
                case "option-changed":
                    for (const listener of optionListeners) {
                        listener(message.name, message.value);
                    }
                    break;
            }
        });
        child.on("exit", (code) => reject(new Error(`backend process exited with code ${code}`)));
    });
    // The rejection is reported by whoever awaits `ready`; without this a crash
    // before anything awaits it would be an unhandled rejection that takes the
    // app down before the error can be shown.
    ready.catch(() => {});

    const dispatchPort = openPort(child);

    return {
        ready,
        dispatch: (request) => dispatchOverPort(dispatchPort, request),
        attachRenderer(webContents) {
            const { port1, port2 } = new MessageChannelMain();
            child.postMessage({ type: "port" }, [ port1 ]);
            webContents.postMessage(IPC_BACKEND_PORT, null, [ port2 ]);
        },
        sendClientMessage(clientId, message) {
            const outgoing: MainToBackend = { type: "client-message", clientId, message };
            child.postMessage(outgoing);
        },
        onOptionChanged(listener) {
            optionListeners.push(listener);
        }
    };
}

/** Where `utilityProcess.fork` finds the backend entry, in sources and in the bundle. */
const ENTRY_FILE = process.env.TRILIUM_ENV === "dev" ? "backend_process.ts" : "backend_process.mjs";

const pending = new Map<number, (response: PortResponse) => void>();
let nextRequestId = 1;

function openPort(child: UtilityProcess): Electron.MessagePortMain {
    const { port1, port2 } = new MessageChannelMain();
    child.postMessage({ type: "port" }, [ port1 ]);
    port2.on("message", (event) => {
        const response = event.data as PortResponse;
        pending.get(response.id)?.(response);
        pending.delete(response.id);
    });
    port2.start();
    return port2;
}

async function dispatchOverPort(port: Electron.MessagePortMain, request: Request): Promise<Response> {
    warnIfApiRequest(request);
    const id = nextRequestId++;
    const headers: [string, string][] = [];
    request.headers.forEach((value, key) => headers.push([ key, value ]));

    const body = request.method === "GET" || request.method === "HEAD"
        ? undefined
        : new Uint8Array(await request.arrayBuffer());

    const message: PortRequest = { id, method: request.method, url: request.url, headers, body };
    const response = await new Promise<PortResponse>((resolve) => {
        pending.set(id, resolve);
        port.postMessage(message);
    });

    // A Uint8Array is a valid BodyInit at runtime; the DOM typings disagree.
    const responseBody = NULL_BODY_STATUSES.has(response.status) ? null : response.body as unknown as BodyInit;
    return new Response(responseBody, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers
    });
}

/** Chromium rejects a `Response` carrying a body on any of these. */
const NULL_BODY_STATUSES = new Set([ 101, 204, 205, 304 ]);

const apiPathsThroughMain = new Set<string>();

/**
 * Reports which `/api/` paths main is still dispatching.
 *
 * Some belong here: a font, an image or a stylesheet under `/api/` is requested by
 * Chromium on the page's behalf and can only arrive on the protocol handler. What
 * does not belong is a call the client makes through `services/server.ts`, which
 * should be taking its own port — every one of those that shows up here is served
 * on the thread this change exists to keep free.
 */
function warnIfApiRequest(request: Request) {
    if (!process.env.TRILIUM_BACKEND_TRACE_MAIN_API) {
        return;
    }
    const { pathname } = new URL(request.url);
    if (!pathname.startsWith("/api/") || apiPathsThroughMain.has(pathname)) {
        return;
    }
    apiPathsThroughMain.add(pathname);
    console.warn(`[backend] dispatched in the main process: ${request.method} ${pathname}`);
}

function relayToRenderers(target: "all" | string, message: WebSocketMessage) {
    for (const win of electron.BrowserWindow.getAllWindows()) {
        if (win.isDestroyed()) {
            continue;
        }
        if (target === "all" || String(win.webContents.id) === target) {
            win.webContents.send(IPC_TO_RENDERER, message);
        }
    }
}
