import { isLocalApiRequest, localFetch } from "./local-bridge.js";
import { toBase64 } from "./services/capacitor_download.js";

/**
 * Page side of the mobile shells' native request bridges, which answer local API requests in
 * place of a service worker: `TriliumRequestBridge.java` on Android and
 * `TriliumRequestBridge.swift` on iOS.
 *
 * The native side sees every request the WebView issues, whichever part of the engine issued it
 * (`fetch`, XHR, `<img>`, `@font-face`, iframes, media): `WebViewClient.shouldInterceptRequest`
 * on Android, the `WKURLSchemeHandler` of `capacitor://` on iOS. For a local API path it calls
 * `window.__triliumNativeRequest()`, this module answers it from `localFetch()`, and the reply
 * travels back over the native channel as JSON strings:
 *
 * - `{"type":"head","id","status","headers"}`, then the body as ArrayBuffer frames, each a 4-byte
 *   big-endian request id followed by the bytes, or as `{"type":"chunk","id","data"}` with the
 *   bytes in base64 when the channel cannot carry ArrayBuffers (iOS, older Android WebViews).
 * - `{"type":"end","id"}` once the body is complete, or `{"type":"error","id","message"}`.
 *
 * Android's `shouldInterceptRequest` exposes no request body, so both platforms forward only GET
 * and HEAD. A local request with any other method goes through `standaloneApi.localFetch`: the
 * client's `server.ts` calls it directly, and `window.fetch` is wrapped so a script's
 * `fetch("/custom/…", { method: "POST" })` reaches it too.
 *
 * Returns whether a native channel was found; without one the page registers its service worker.
 */
export function installNativeRequestBridge(): boolean {
    const bridgeWindow = window as RequestBridgeWindow;
    const channel = bridgeWindow.triliumRequestBridge
        ?? bridgeWindow.webkit?.messageHandlers?.triliumRequestBridge;
    if (!channel) {
        return false;
    }

    bridgeWindow.__triliumNativeRequest = (request) => {
        void answer(channel, request);
    };
    routeLocalRequestBodiesToWorker();
    // The native side holds every request it intercepted until this arrives.
    channel.postMessage(JSON.stringify({ type: "ready" }));
    return true;
}

/** Request forwarded by the native bridge. */
interface NativeRequest {
    id: number;
    method: string;
    url: string;
    headers: Record<string, string>;
    /** Whether the channel carries ArrayBuffer messages; base64 chunks are sent otherwise. */
    binary: boolean;
}

interface RequestChannel {
    postMessage(message: string | ArrayBuffer): void;
}

interface RequestBridgeWindow {
    /** Android: the `WebMessageListener` that `TriliumRequestBridge.java` injects. */
    triliumRequestBridge?: RequestChannel;
    /** iOS: the script message handler that `TriliumRequestBridge.swift` registers. */
    webkit?: { messageHandlers?: { triliumRequestBridge?: RequestChannel } };
    __triliumNativeRequest?: (request: NativeRequest) => void;
}

/** Bounds each message, so no single bridge crossing holds a whole attachment. */
const CHUNK_SIZE = 256 * 1024;

const FRAME_HEADER_SIZE = 4;

async function answer(channel: RequestChannel, request: NativeRequest) {
    const send = (message: Record<string, unknown>) =>
        channel.postMessage(JSON.stringify({ ...message, id: request.id }));

    try {
        const url = new URL(request.url, location.href);
        if (!isLocalApiRequest(url)) {
            // The native prefix lists must match `isLocalApiRequest()`.
            throw new Error(`Path is not routed to the local worker: ${url.pathname}`);
        }

        const response = toNativeResponse(await localFetch(new Request(url.href, {
            method: request.method,
            headers: request.headers
        })));
        const body = new Uint8Array(await response.arrayBuffer());

        const headers = Object.fromEntries(response.headers);
        if (request.method !== "HEAD") {
            // The worker's value can count characters rather than bytes; WebKit's media loader
            // needs the exact length.
            headers["content-length"] = String(body.length);
        }
        send({ type: "head", status: response.status, headers });
        for (let offset = 0; offset < body.length; offset += CHUNK_SIZE) {
            const chunk = body.subarray(offset, offset + CHUNK_SIZE);
            if (request.binary) {
                channel.postMessage(frame(request.id, chunk));
            } else {
                send({ type: "chunk", data: toBase64(chunk) });
            }
        }
        send({ type: "end" });
    } catch (err) {
        console.warn("[RequestBridge] Local request failed", request.url, err);
        send({ type: "error", message: err instanceof Error ? err.message : String(err) });
    }
}

/**
 * Wraps `window.fetch` so a same-origin local request with a method the native side does not
 * forward goes to `localFetch()` with its body, as it did through the service worker.
 */
function routeLocalRequestBodiesToWorker() {
    const networkFetch = window.fetch.bind(window);
    window.fetch = (input, init) => {
        const request = new Request(input, init);
        const url = new URL(request.url);
        if (request.method === "GET" || request.method === "HEAD"
                || url.origin !== location.origin || !isLocalApiRequest(url)) {
            return networkFetch(input, init);
        }
        return localFetch(request);
    };
}

/**
 * Neither native response type carries a 3xx (`WebResourceResponse` rejects one, a
 * `WKURLSchemeTask` cannot redirect), so a redirect (the share pages issue them) becomes a page
 * that navigates to its target. A relative target resolves against the request URL, as it would
 * for a real redirect.
 */
function toNativeResponse(response: Response): Response {
    const location = response.headers.get("location");
    if (response.status < 300 || response.status >= 400 || !location) {
        return response;
    }

    const target = location.replaceAll("&", "&amp;").replaceAll("\"", "&quot;");
    return new Response(`<!DOCTYPE html><meta http-equiv="refresh" content="0;url=${target}">`, {
        status: 200,
        headers: { "content-type": "text/html; charset=utf-8" }
    });
}

function frame(id: number, chunk: Uint8Array): ArrayBuffer {
    const buffer = new ArrayBuffer(FRAME_HEADER_SIZE + chunk.length);
    new DataView(buffer).setUint32(0, id);
    new Uint8Array(buffer, FRAME_HEADER_SIZE).set(chunk);
    return buffer;
}
