// public/local-bridge.js
let localWorker: Worker | null = null;
const pending = new Map();

export function startLocalServerWorker() {
    if (localWorker) return localWorker;

    localWorker = new Worker(new URL("./local-server-worker.js", import.meta.url), { type: "module" });

    // Handle worker errors during initialization
    localWorker.onerror = (event) => {
        console.error("[LocalBridge] Worker error:", event);
        // Reject all pending requests
        for (const [id, resolver] of pending) {
            resolver.reject(new Error(`Worker error: ${event.message}`));
        }
        pending.clear();
    };

    localWorker.onmessage = (event) => {
        const msg = event.data;
        
        // Handle worker error reports
        if (msg?.type === "WORKER_ERROR") {
            console.error("[LocalBridge] Worker reported error:", msg.error);
            // Reject all pending requests with the error
            for (const [id, resolver] of pending) {
                resolver.reject(new Error(msg.error?.message || "Unknown worker error"));
            }
            pending.clear();
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
    navigator.serviceWorker.addEventListener("message", async (event) => {
        const msg = event.data;
        if (!msg || msg.type !== "LOCAL_FETCH") return;

        const port = event.ports && event.ports[0];
        if (!port) return;

        try {
            startLocalServerWorker();

            const id = msg.id;
            const req = msg.request;

            const response = await new Promise((resolve, reject) => {
                pending.set(id, { resolve, reject });
                // Transfer body to worker for efficiency (if present)
                localWorker.postMessage({
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
        } catch (e) {
            port.postMessage({
                type: "LOCAL_FETCH_RESPONSE",
                id: msg.id,
                response: {
                    status: 500,
                    headers: { "content-type": "text/plain; charset=utf-8" },
                    body: new TextEncoder().encode(String(e?.message || e)).buffer
                }
            });
        }
    });
}
