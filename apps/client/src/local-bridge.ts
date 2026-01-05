// public/local-bridge.js
let localWorker = null;
const pending = new Map();

export function startLocalServerWorker() {
    if (localWorker) return localWorker;

    localWorker = new Worker(new URL("./local-server-worker.js", import.meta.url), { type: "module" });

    localWorker.onmessage = (event) => {
        const msg = event.data;
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
