import type {
    StandaloneDownloadResult,
    StandaloneRestoreProgress,
    StandaloneRestoreResult
} from "@triliumnext/commons";

import { reportSplashPhase } from "../../client/src/services/splash.js";
import { showErrorOverlay } from "./error-overlay.js";
import { isLeader } from "./leader_election.js";
import LocalServerWorker from "./local-server-worker?worker";
let localWorker: Worker | null = null;
const pending = new Map();
/** Restores in flight, by id, each with the progress callback that stays on this side. */
const restores = new Map<string, {
    resolve: (result: StandaloneRestoreResult) => void;
    reject: (reason: unknown) => void;
    onProgress?: (progress: StandaloneRestoreProgress) => void;
}>();

/**
 * Carries the worker's WebSocket-style messages from the leader tab to the
 * others. Only the leader has a worker, so without this relay a follower would
 * never learn that an entity changed and its froca cache would go stale.
 *
 * A BroadcastChannel never echoes to the sender, so the leader posting here does
 * not re-deliver to itself — it dispatches its own copy directly.
 */
const WS_RELAY_CHANNEL = "trilium-ws-relay";
let wsRelay: BroadcastChannel | null = null;

function getWsRelay(): BroadcastChannel | null {
    if (typeof BroadcastChannel === "undefined") {
        return null;
    }
    if (!wsRelay) {
        wsRelay = new BroadcastChannel(WS_RELAY_CHANNEL);
        wsRelay.onmessage = (event) => dispatchWsMessage(event.data);
    }
    return wsRelay;
}

function dispatchWsMessage(message: unknown): void {
    window.dispatchEvent(new CustomEvent("trilium:ws-message", { detail: message }));
}

/**
 * Tell the service worker that this tab owns the database, so it routes every
 * tab's API traffic here. The service worker is evicted when idle and loses
 * this, so it also probes for the leader on demand — see sw.ts.
 */
export function announceLeadership(): void {
    // Start listening for relayed messages even as leader: if this tab is ever
    // demoted the channel is already live.
    getWsRelay();
    navigator.serviceWorker?.controller?.postMessage({ type: "LEADER_ANNOUNCE" });
}

/** Must stay in step with LOCAL_FIRST_PREFIXES in sw.ts, which covers the same paths on the web. */
const LOCAL_API_PREFIXES = ["/bootstrap", "/api/", "/sync/", "/search/", "/custom/"];

/**
 * Restores the database from a backup, on the worker that owns it.
 *
 * The file goes across as a `File`, which structured cloning passes by reference, so nothing is
 * copied and nothing is read into memory here. It deliberately avoids the request path: that
 * serialises bodies whole and gives up after thirty seconds, neither of which a database survives.
 *
 * Progress is relayed from the worker to `onProgress`, which stays on this side of the boundary.
 *
 * Only the leader tab can do this: it is the one holding the database, and the
 * restore bypasses the request path that would otherwise proxy a follower's
 * call through to it. Starting a worker here in a follower would open a second
 * database against the same OPFS pool — the failure leadership exists to
 * prevent — so a follower is refused outright instead.
 */
export function restoreBackup(opts: {
    backup: File;
    passphrase?: string;
    onProgress?: (progress: StandaloneRestoreProgress) => void;
}): Promise<StandaloneRestoreResult> {
    if (!isLeader()) {
        return Promise.reject(new Error(
            "A backup can only be restored from the tab that owns the database. "
            + "Close the other Trilium tabs and try again."
        ));
    }

    const worker = startLocalServerWorker();
    const id = Math.random().toString(36).slice(2);

    return new Promise((resolve, reject) => {
        restores.set(id, { resolve, reject, onProgress: opts.onProgress });
        worker.postMessage({
            type: "RESTORE_BACKUP",
            id,
            backup: opts.backup,
            passphrase: opts.passphrase
        });
    });
}

/** Security changes waiting on the worker that owns the file, by id. */
const securityChanges = new Map<string, (written: boolean) => void>();

/** Long enough for a worker that is still starting up, short enough that the toggle answers. */
const SECURITY_CHANGE_TIMEOUT_MS = 30_000;

/**
 * The private channel a security setting is written over, entangled with the worker at startup.
 * Module scope is what makes it trustworthy: backend scripts run through `eval()` in the worker's
 * realm, which reaches its globals, `self.onmessage` among them, but no module's bindings.
 */
let securityPort: MessagePort | null = null;

/**
 * Writes a security setting, on the worker that holds the lock on the file it lives in.
 *
 * The page cannot write that file itself: the lock is the whole point, see
 * `lightweight/security_settings.ts`. This deliberately avoids the request path too, since a route
 * would put the change behind the same API a frontend script already calls freely.
 *
 * Only the leader tab has that worker. A follower is refused rather than served, as for a backup.
 */
export function requestSecurityChange(setting: string, enabled: boolean): Promise<boolean> {
    if (!isLeader()) {
        return Promise.resolve(false);
    }

    startLocalServerWorker();
    const port = securityPort;
    if (!port) {
        return Promise.resolve(false);
    }

    const id = Math.random().toString(36).slice(2);

    return new Promise((resolve) => {
        const settle = (written: boolean) => {
            clearTimeout(timer);
            securityChanges.delete(id);
            resolve(written);
        };
        const timer = setTimeout(() => settle(false), SECURITY_CHANGE_TIMEOUT_MS);

        securityChanges.set(id, settle);
        port.postMessage({ type: "SECURITY_SET", id, setting, enabled });
    });
}

/**
 * How long the download's frame is kept in the page: comfortably past the service worker's own
 * 30-second wait for the stream to open, after which the response has either been handed to the
 * browser's download manager, which no longer needs the frame, or failed inside it invisibly.
 */
const DOWNLOAD_FRAME_LINGER_MS = 60_000;

/** Well inside the ~30 seconds of eventlessness after which browsers reclaim a service worker. */
const BACKUP_PING_INTERVAL_MS = 10_000;

let backupPing: ReturnType<typeof setInterval> | null = null;

/**
 * Keeps the service worker alive while it streams a backup download, by fetching a no-op URL it
 * answers: a fetch event is what resets the browser's idle clock on it. Runs for exactly as long
 * as the local worker says a stream is running, and never twice at once.
 */
function setBackupPinging(active: boolean): void {
    if (active && !backupPing) {
        backupPing = setInterval(
            () => void fetch("/local-backup-ping").catch(() => undefined),
            BACKUP_PING_INTERVAL_MS
        );
    } else if (!active && backupPing) {
        clearInterval(backupPing);
        backupPing = null;
    }
}

/** How long the chain gets to reach the worker and open the stream before it is called dead. */
const DOWNLOAD_START_TIMEOUT_MS = 45_000;

/** The one download in flight, waiting for the worker to say how the stream ended. */
let pendingDownload: {
    resolve: (result: StandaloneDownloadResult) => void;
    startTimer: ReturnType<typeof setTimeout>;
    onProgress?: (sentBytes: number, totalBytes: number) => void;
} | null = null;

/** Carried from {@link downloadDatabase} to the stream relay, so it never rides the URL. */
let pendingDownloadPassphrase: string | undefined;

/**
 * Hands the browser a download of the live database, streamed by the service worker.
 *
 * A navigation rather than a request: the URL is answered by the service worker with a response
 * body it pulls from the local worker chunk by chunk, so the browser's own download manager
 * receives, shows and stores the file, and nothing is staged in the origin's storage first.
 * The worker is started here because the service worker's first act is to ask the page for it.
 * The passphrase, when there is one, travels to the worker on the relayed message, never in the
 * URL a browser would put in its history.
 *
 * The navigation is a hidden iframe rather than an anchor click: anchors with the `download`
 * attribute are not routed through service workers everywhere (Firefox never sends them there),
 * while a frame's navigation always is, and the response's `Content-Disposition` is what makes it
 * a download either way. A failure renders invisibly inside the frame instead of navigating the
 * application away.
 *
 * Resolves when the worker has finished producing the stream, one way or the other — which is as
 * close to "the download finished" as anything on this side of the browser's download manager can
 * see. A chain that dies silently inside the hidden frame (a stale service worker, say) resolves
 * as failed after a timeout rather than never.
 *
 * Only the leader tab can do this, as for a restore: the worker that streams the database is the
 * leader's, and the passphrase asked for here never leaves this tab, so a follower would produce
 * either no backup or an unencrypted one under the belief it was encrypted.
 */
export function downloadDatabase(
    fileName: string,
    passphrase?: string,
    onProgress?: (sentBytes: number, totalBytes: number) => void
): Promise<StandaloneDownloadResult> {
    if (!isLeader()) {
        return Promise.resolve({
            status: "failed",
            message: "A backup can only be downloaded from the tab that owns the database. "
                + "Close the other Trilium tabs and try again."
        });
    }

    startLocalServerWorker();
    // A newer download supersedes one still unaccounted for, rather than stacking behind it.
    settlePendingDownload({ status: "cancelled" });
    pendingDownloadPassphrase = passphrase;

    const frame = document.createElement("iframe");
    frame.hidden = true;
    frame.src = `/local-backup-download?fileName=${encodeURIComponent(fileName)}`;
    document.body.appendChild(frame);
    setTimeout(() => frame.remove(), DOWNLOAD_FRAME_LINGER_MS);

    return new Promise((resolve) => {
        pendingDownload = {
            resolve,
            onProgress,
            startTimer: setTimeout(
                () => settlePendingDownload({ status: "failed", message: "The download did not start." }),
                DOWNLOAD_START_TIMEOUT_MS
            )
        };
    });
}

function settlePendingDownload(result: StandaloneDownloadResult): void {
    if (pendingDownload) {
        clearTimeout(pendingDownload.startTimer);
        pendingDownload.resolve(result);
        pendingDownload = null;
    }
}

/** Where a save in flight wants its progress, which arrives on the worker's own channel. */
let saveProgress: ((sentBytes: number, totalBytes: number) => void) | null = null;

/**
 * Writes the same backup onto the device, for the mobile shell.
 *
 * The service worker drops out of the path entirely: it exists in {@link downloadDatabase} only to
 * turn the stream into a `Response` the browser's download manager will take, and the WebView has
 * no download manager to take it. Here the page consumes the stream itself — the same pull-driven
 * protocol, the same container, the same passphrase — and writes it to the app's documents
 * directory, so it also works on iOS, where a service worker cannot be registered at all.
 *
 * A dismissed share sheet is still a backup: the file is complete before the sheet opens, so that
 * outcome is `done` with the path it went to, not `cancelled`.
 */
export async function saveDatabase(
    fileName: string,
    passphrase?: string,
    onProgress?: (sentBytes: number, totalBytes: number) => void
): Promise<StandaloneDownloadResult> {
    if (!isLeader()) {
        return {
            status: "failed",
            message: "A backup can only be taken from the tab that owns the database. "
                + "Close the other Trilium tabs and try again."
        };
    }

    const { saveChunksToDevice, BACKUP_TARGET } = await import("./services/capacitor_download.js");

    saveProgress = onProgress ?? null;
    try {
        const result = await saveChunksToDevice(fileName, backupChunks(passphrase), BACKUP_TARGET);
        if (result.status === "failed") {
            return { status: "failed", message: result.message };
        }
        return { status: "done", location: result.location };
    } finally {
        saveProgress = null;
    }
}

/**
 * The backup as a stream of bytes, pulled straight off the local worker.
 *
 * The worker answers one `chunk` per `pull` and ends with `end`, which is what carries backpressure
 * back to the database reads: chunks are asked for as fast as they can be written and no faster. A
 * few pulls are kept outstanding so the worker reads the next pages while the current chunk is
 * still crossing the plugin bridge, which is by far the slower of the two.
 */
async function* backupChunks(passphrase: string | undefined): AsyncGenerator<Uint8Array> {
    const worker = startLocalServerWorker();
    const channel = new MessageChannel();
    const port = channel.port1;

    const arrived: unknown[] = [];
    let waiting: ((message: unknown) => void) | null = null;
    port.onmessage = (event) => {
        if (waiting) {
            const resolve = waiting;
            waiting = null;
            resolve(event.data);
        } else {
            arrived.push(event.data);
        }
    };
    const next = (): Promise<unknown> => arrived.length
        ? Promise.resolve(arrived.shift())
        : new Promise((resolve) => { waiting = resolve; });

    worker.postMessage({ type: "BACKUP_STREAM", port: channel.port2, passphrase }, [ channel.port2 ]);

    try {
        const begin = await next() as { type?: string; message?: string } | null;
        if (begin?.type !== "begin") {
            throw new Error(begin?.message ?? "The backup stream did not start.");
        }

        let outstanding = 0;
        for (;;) {
            while (outstanding < MAX_BACKUP_CHUNKS_IN_FLIGHT) {
                outstanding++;
                port.postMessage({ type: "pull" });
            }

            const message = await next() as { type?: string; data?: ArrayBuffer; message?: string } | null;
            outstanding--;

            if (message?.type === "end") {
                return;
            }
            if (message?.type !== "chunk" || !message.data) {
                throw new Error(message?.message ?? "The backup stream failed.");
            }
            yield new Uint8Array(message.data);
        }
    } finally {
        // Ends the stream for a consumer that stopped early — a failed write, say — rather than
        // leaving the worker reading pages nothing will collect.
        port.postMessage({ type: "cancel" });
        port.close();
    }
}

/**
 * How many chunks may be in flight at once. The worker reads ahead this far while the plugin
 * bridge is busy with the previous one; every chunk beyond that is memory held for nothing.
 */
const MAX_BACKUP_CHUNKS_IN_FLIGHT = 4;

export function isLocalApiRequest(url: URL): boolean {
    return LOCAL_API_PREFIXES.some(p => url.pathname.startsWith(p));
}

export async function localFetch(request: Request): Promise<Response> {
    startLocalServerWorker();

    const id = Math.random().toString(36).slice(2);
    const headersObj: Record<string, string> = {};
    for (const [k, v] of request.headers.entries()) headersObj[k] = v;

    const body = (request.method === "GET" || request.method === "HEAD")
        ? null
        : await request.arrayBuffer();

    const response = await new Promise<{ status: number; headers: Record<string, string>; body?: ArrayBuffer }>((resolve, reject) => {
        pending.set(id, { resolve, reject });
        localWorker!.postMessage({
            type: "LOCAL_REQUEST",
            id,
            request: { url: request.url, method: request.method, headers: headersObj, body }
        }, body ? [body] : []);
    });

    const respHeaders = new Headers();
    if (response.headers) {
        for (const [k, v] of Object.entries(response.headers)) respHeaders.set(k, v);
    }
    return new Response(response.body ?? null, { status: response.status || 200, headers: respHeaders });
}

/**
 * Handler for outbound HTTP requests from the worker.
 * When registered, the worker's BridgedRequestProvider sends HTTP_REQUEST
 * messages here instead of using fetch() directly. The handler performs the
 * actual HTTP call (e.g. via a native networking layer) and returns the result.
 */
export type NativeHttpHandler = (request: {
    method: string;
    url: string;
    headers: Record<string, string>;
    body?: string;
    responseType?: string;
}) => Promise<{
    status: number;
    headers: Record<string, string>;
    // Exactly one of these will be set:
    // - `data` carries an already-parsed JSON response straight through the
    //   structured-clone postMessage. The worker uses it as-is and skips
    //   JSON.parse, avoiding the ~2× memory blowup that killed large blobs
    //   (parsed object + an intermediate ~60MB string was OOM-ing the iOS
    //   worker). The handler must NOT JSON.stringify the response itself.
    // - `body` is the raw string body — used for non-JSON responses (e.g.
    //   base64 binary returned for `responseType: "arraybuffer"`) and for
    //   error bodies the worker needs to inspect.
    data?: unknown;
    body?: string;
}>;

let nativeHttpHandler: NativeHttpHandler | null = null;

/**
 * Register a handler for outbound HTTP requests from the worker.
 * Must be called before startLocalServerWorker().
 */
export function registerNativeHttpHandler(handler: NativeHttpHandler) {
    nativeHttpHandler = handler;
}

export function startLocalServerWorker() {
    if (localWorker) return localWorker;
    localWorker = new LocalServerWorker();

    // Handed over with the worker's first message, before it has loaded a module of its own and
    // long before it can run a note's script. See `securityPort`.
    const security = new MessageChannel();
    securityPort = security.port1;
    securityPort.onmessage = (event) => {
        const msg = event.data;
        if (msg?.type === "SECURITY_SET_RESULT") {
            securityChanges.get(msg.id)?.(msg.written === true);
        }
    };

    localWorker.postMessage({
        type: "INIT",
        queryString: location.search,
        useNativeHttp: nativeHttpHandler != null,
        securityPort: security.port2
    }, [ security.port2 ]);

    // Handle worker errors during initialization
    localWorker.onerror = (event) => {
        console.error("[LocalBridge] Worker error:", event);
        showErrorOverlay(
            "Trilium couldn't start",
            event.message || "The database worker failed to start. See the console for details."
        );
        // Reject all pending requests
        for (const [, resolver] of pending) {
            resolver.reject(new Error(`Worker error: ${event.message}`));
        }
        pending.clear();
    };

    localWorker.onmessage = (event) => {
        const msg = event.data;

        // How far the worker has got through its own startup, which the splash draws as progress.
        // Only the leader tab has a worker, so only it sees these.
        if (msg?.type === "STARTUP_PROGRESS") {
            reportSplashPhase(msg.phase);
            return;
        }

        // Restore progress and outcome, which travel on their own channel rather than as a response
        // to a request: the backup that started them never went through one.
        if (msg?.type === "RESTORE_PROGRESS") {
            restores.get(msg.id)?.onProgress?.(msg.progress);
            return;
        }
        if (msg?.type === "RESTORE_RESULT") {
            restores.get(msg.id)?.resolve(msg.result);
            restores.delete(msg.id);
            return;
        }

        // Handle fatal platform crashes (shown as an overlay to the user)
        if (msg?.type === "FATAL_ERROR") {
            console.error("[LocalBridge] Fatal error:", msg.message);
            showErrorOverlay("Trilium crashed", msg.message);
            return;
        }

        // An error that escaped the worker before it finished starting up, which is
        // to say the application never came up: nothing will ever answer a request,
        // and it hangs rather than failing, so this message is the only signal the
        // user would otherwise get. Errors escaping a *running* worker do not come
        // this way — they arrive as `unhandled-error` and become a notification, so
        // one background task's failure cannot blank the screen (see
        // `reportEscapedError` in local-server-worker.ts).
        if (msg?.type === "WORKER_ERROR") {
            console.error("[LocalBridge] Worker reported error:", msg.error);
            showErrorOverlay(
                "Trilium couldn't start",
                msg.error?.message || "The database worker reported an error.",
                msg.error?.stack
            );
            // Reject all pending requests with the error
            for (const [, resolver] of pending) {
                resolver.reject(new Error(msg.error?.message || "Unknown worker error"));
            }
            pending.clear();
            return;
        }

        // A backup download is streaming through the service worker, which receives no events of
        // its own while a response body streams: browsers reclaim such "idle" workers within a
        // minute or so, killing the download mid-file. A real fetch is a functional event that
        // resets that clock, so one is sent for as long as the worker says the stream is running.
        // The end of the stream also carries its outcome, which is what the caller of
        // downloadDatabase() has been waiting on.
        // How far the download has got, which the screen shows because a phone hides its own
        // download UI behind the notification shade.
        if (msg?.type === "BACKUP_STREAM_PROGRESS") {
            pendingDownload?.onProgress?.(Number(msg.sentBytes), Number(msg.totalBytes));
            saveProgress?.(Number(msg.sentBytes), Number(msg.totalBytes));
            return;
        }

        if (msg?.type === "BACKUP_STREAM_ACTIVE") {
            // Only a stream the service worker is holding open needs it kept alive; `saveDatabase`
            // consumes its own, and on iOS the ping would be a request to a worker that is not there.
            setBackupPinging(msg.active === true && pendingDownload !== null);
            if (msg.active === true) {
                if (pendingDownload) {
                    clearTimeout(pendingDownload.startTimer);
                }
            } else {
                settlePendingDownload(msg.result ?? { status: "done" });
            }
            return;
        }

        // Handle WebSocket-like messages from the worker (for frontend updates)
        if (msg?.type === "WS_MESSAGE" && msg.message) {
            // Dispatch a custom event that ws.ts listens to in standalone mode
            dispatchWsMessage(msg.message);
            // Only this tab has a worker, so pass the update on to the others —
            // that is what makes one tab's edit show up in the rest.
            getWsRelay()?.postMessage(msg.message);
            return;
        }

        // Relay outbound HTTP requests to the registered native handler
        if (msg?.type === "HTTP_REQUEST" && nativeHttpHandler) {
            const { id, request } = msg;
            nativeHttpHandler(request)
                .then((response) => {
                    localWorker!.postMessage({
                        type: "HTTP_RESPONSE",
                        id,
                        ...response
                    });
                })
                .catch((err) => {
                    localWorker!.postMessage({
                        type: "HTTP_RESPONSE",
                        id,
                        error: err instanceof Error ? err.message : String(err)
                    });
                });
            return;
        }

        if (!msg || msg.type !== "LOCAL_RESPONSE") return;

        const { id, response, error } = msg;
        const resolver = pending.get(id);
        if (!resolver) return;
        pending.delete(id);

        if (error) resolver.reject(new Error(error));
        else resolver.resolve(response);
    };

    return localWorker;
}

export function attachServiceWorkerBridge() {
    if (!("serviceWorker" in navigator) || !navigator.serviceWorker) {
        console.warn("[LocalBridge] Service workers not available — skipping bridge setup");
        return;
    }

    // Followers need the relay too, so they receive the leader's entity changes.
    getWsRelay();

    navigator.serviceWorker.addEventListener("message", async (event) => {
        const msg = event.data;

        // The service worker lost track of the leader and is probing for it.
        if (msg?.type === "WHO_IS_LEADER") {
            const replyPort = event.ports && event.ports[0];
            replyPort?.postMessage({ type: "LEADER_REPLY", isLeader: isLeader() });
            return;
        }

        // A backup download's channel: handed straight through to the worker, which streams the
        // database into it. The page is only the relay, because the service worker cannot reach
        // the local worker itself.
        if (msg?.type === "LOCAL_BACKUP_STREAM") {
            const streamPort = event.ports && event.ports[0];
            if (!streamPort) {
                return;
            }

            // As for any other request: only the leader has a worker, and starting one here
            // would open a second database. The download is refused rather than served wrongly.
            if (!isLeader()) {
                streamPort.postMessage({
                    type: "error",
                    message: "This tab does not own the database."
                });
                return;
            }

            startLocalServerWorker().postMessage({
                type: "BACKUP_STREAM",
                port: streamPort,
                passphrase: pendingDownloadPassphrase
            }, [ streamPort ]);
            pendingDownloadPassphrase = undefined;
            return;
        }

        if (!msg || msg.type !== "LOCAL_FETCH") return;

        const port = event.ports && event.ports[0];
        if (!port) return;

        // Never start a worker just because a request arrived: only the leader
        // may own one. If the service worker guessed wrong, say so and let it
        // find the real leader rather than opening a second, broken database.
        if (!isLeader()) {
            port.postMessage({ type: "NOT_LEADER", id: msg.id });
            return;
        }

        try {
            startLocalServerWorker();

            const id = msg.id;
            const req = msg.request;

            const response = await new Promise<{ body?: ArrayBuffer }>((resolve, reject) => {
                pending.set(id, { resolve, reject });
                // Transfer body to worker for efficiency (if present)
                localWorker!.postMessage({
                    type: "LOCAL_REQUEST",
                    id,
                    request: req
                }, req.body ? [req.body] : []);
            });

            port.postMessage({
                type: "LOCAL_FETCH_RESPONSE",
                id,
                response
            }, response.body ? [response.body] : []);
        } catch (e: unknown) {
            const errorMessage = e instanceof Error ? e.message : String(e);
            port.postMessage({
                type: "LOCAL_FETCH_RESPONSE",
                id: msg.id,
                response: {
                    status: 500,
                    headers: { "content-type": "text/plain; charset=utf-8" },
                    body: new TextEncoder().encode(errorMessage).buffer
                }
            });
        }
    });
}
