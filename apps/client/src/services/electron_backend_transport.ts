/**
 * Routes the desktop client's API calls straight to the backend `utilityProcess`
 * over a `MessagePort`, bypassing the main process.
 *
 * Installs itself as `window.standaloneApi.localFetch`, which `index.ts` and
 * `services/server.ts` already prefer over their default transport — the same
 * hook the standalone build uses to reach its SQLite worker. Nothing else in the
 * client changes.
 *
 * Does nothing unless the preload says a port is coming, so a desktop build that
 * still answers API calls in the main process, and every non-Electron build, keep
 * their existing transport.
 */
interface PortResponse {
    id: number;
    status: number;
    statusText: string;
    headers: [string, string][];
    body: Uint8Array;
}

const BACKEND_PORT_CHANNEL = "trilium-backend-port";

/** Chromium rejects a `Response` constructed with a body on any of these. */
const NULL_BODY_STATUSES = new Set([ 101, 204, 205, 304 ]);

const pending = new Map<number, (response: PortResponse) => void>();
let nextRequestId = 1;

export async function installElectronBackendTransport(): Promise<boolean> {
    const bridge = window.triliumBackendBridge;
    if (!bridge) {
        return false;
    }

    const port = await new Promise<MessagePort | undefined>((resolve) => {
        window.addEventListener("message", function onMessage(event: MessageEvent) {
            if (event.data?.type !== BACKEND_PORT_CHANNEL) {
                return;
            }
            window.removeEventListener("message", onMessage);
            resolve(event.ports[0]);
        });
        void bridge.connect().then((available) => {
            if (!available) {
                resolve(undefined);
            }
        });
    });

    if (!port) {
        return false;
    }

    port.onmessage = (event: MessageEvent<PortResponse>) => {
        const response = event.data;
        pending.get(response.id)?.(response);
        pending.delete(response.id);
    };
    port.start();

    window.standaloneApi = {
        ...window.standaloneApi,
        localFetch: (request: Request) => sendOverPort(port, request)
    } as typeof window.standaloneApi;

    return true;
}

async function sendOverPort(port: MessagePort, request: Request): Promise<Response> {
    const id = nextRequestId++;
    const headers: [string, string][] = [];
    request.headers.forEach((value, key) => headers.push([ key, value ]));

    const body = request.method === "GET" || request.method === "HEAD"
        ? undefined
        : new Uint8Array(await request.arrayBuffer());

    const response = await new Promise<PortResponse>((resolve) => {
        pending.set(id, resolve);
        port.postMessage({ id, method: request.method, url: request.url, headers, body });
    });

    // A Uint8Array is a valid BodyInit at runtime; the DOM typings disagree.
    const responseBody = NULL_BODY_STATUSES.has(response.status) ? null : response.body as unknown as BodyInit;
    return new Response(responseBody, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers
    });
}
