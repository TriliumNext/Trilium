import LocalServerWorker from "./local-server-worker?worker";
let localWorker: Worker | null = null;
const pending = new Map();

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
    body: string;
}>;

let nativeHttpHandler: NativeHttpHandler | null = null;

/**
 * Register a handler for outbound HTTP requests from the worker.
 * Must be called before startLocalServerWorker().
 */
export function registerNativeHttpHandler(handler: NativeHttpHandler) {
    nativeHttpHandler = handler;
}

function showFatalErrorDialog(message: string) {
    alert(message);
}

export function startLocalServerWorker() {
    if (localWorker) return localWorker;
    localWorker = new LocalServerWorker();
    localWorker.postMessage({
        type: "INIT",
        queryString: location.search,
        useNativeHttp: nativeHttpHandler != null
    });

    // Handle worker errors during initialization
    localWorker.onerror = (event) => {
        console.error("[LocalBridge] Worker error:", event);
        // Reject all pending requests
        for (const [, resolver] of pending) {
            resolver.reject(new Error(`Worker error: ${event.message}`));
        }
        pending.clear();
    };

    localWorker.onmessage = (event) => {
        const msg = event.data;

        // Handle fatal platform crashes (shown as a dialog to the user)
        if (msg?.type === "FATAL_ERROR") {
            console.error("[LocalBridge] Fatal error:", msg.message);
            showFatalErrorDialog(msg.message);
            return;
        }

        // Handle worker error reports
        if (msg?.type === "WORKER_ERROR") {
            console.error("[LocalBridge] Worker reported error:", msg.error);
            // Reject all pending requests with the error
            for (const [, resolver] of pending) {
                resolver.reject(new Error(msg.error?.message || "Unknown worker error"));
            }
            pending.clear();
            return;
        }

        // Handle WebSocket-like messages from the worker (for frontend updates)
        if (msg?.type === "WS_MESSAGE" && msg.message) {
            // Dispatch a custom event that ws.ts listens to in standalone mode
            window.dispatchEvent(new CustomEvent("trilium:ws-message", {
                detail: msg.message
            }));
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

    navigator.serviceWorker.addEventListener("message", async (event) => {
        const msg = event.data;
        if (!msg || msg.type !== "LOCAL_FETCH") return;

        const port = event.ports && event.ports[0];
        if (!port) return;

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
