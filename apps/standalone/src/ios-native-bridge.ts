import { isLocalApiRequest, localFetch } from "./local-bridge.js";

/**
 * iOS-only bridge for the native WKURLSchemeHandler.
 *
 * iOS Capacitor loads the app on the `capacitor://` scheme, where WebKit refuses to
 * register a service worker, so the request routing the SW performs on Android/web
 * has to happen elsewhere. This used to be a set of in-page interceptors (fetch,
 * XHR, `<img>`, stylesheets), each reimplementing interception for one
 * request-initiation channel and silently missing the rest (audio/video sources,
 * iframes, CSS `@import`, …).
 *
 * Instead, the native side now intercepts *every* request for a local API path at
 * the WKURLSchemeHandler level (`TriliumAssetHandler` in
 * `apps/mobile/ios/App/App/ViewController.swift`) — below the content layer, so the
 * initiation channel no longer matters. Since the SQLite worker lives in this page,
 * the native handler forwards each request back here:
 *
 *   WebKit engine ──► native TriliumAssetHandler
 *     ──► evaluateJavaScript(`window.__triliumNativeRequest(payload)`)
 *       ──► localFetch ──► SQLite worker
 *         ──► postMessage via the `triliumScheme` script message handler
 *           ──► native completes the WKURLSchemeTask
 *
 * Bodies cross the bridge as base64 in both directions. The `ready` message tells
 * the native side to flush requests it queued before this module was loaded.
 */

/** Request forwarded from the native scheme handler. */
interface NativeRequestPayload {
    id: string;
    method: string;
    url: string;
    headers: Record<string, string>;
    bodyBase64?: string;
}

interface TriliumSchemeMessageHandler {
    postMessage(message: unknown): void;
}

interface WebKitMessageHandlerWindow {
    webkit?: {
        messageHandlers?: {
            triliumScheme?: TriliumSchemeMessageHandler;
        };
    };
    __triliumNativeRequest?: (payload: NativeRequestPayload) => void;
}

export function installIosNativeBridge() {
    (window as WebKitMessageHandlerWindow).__triliumNativeRequest = (payload) => {
        void handleNativeRequest(payload);
    };
    // The native side queues intercepted requests until it sees this; anything the
    // engine requested before this module loaded is flushed to us now.
    postToNative({ type: "ready" });
}

async function handleNativeRequest(payload: NativeRequestPayload) {
    try {
        const url = new URL(payload.url, location.href);
        if (!isLocalApiRequest(url)) {
            // The native prefix list (ViewController.swift) must mirror
            // LOCAL_API_PREFIXES in local-bridge.ts; a mismatch shows up here.
            throw new Error(`Path is not routed to the local worker: ${url.pathname}`);
        }

        const init: RequestInit = { method: payload.method, headers: payload.headers };
        if (payload.bodyBase64 && payload.method !== "GET" && payload.method !== "HEAD") {
            init.body = decodeBase64(payload.bodyBase64);
        }

        const response = await localFetch(new Request(url.href, init));
        const body = await response.arrayBuffer();
        postToNative({
            type: "response",
            id: payload.id,
            status: response.status,
            headers: Object.fromEntries(response.headers.entries()),
            bodyBase64: encodeBase64(body)
        });
    } catch (err) {
        console.warn("[NativeBridge] Local request failed", payload.url, err);
        postToNative({
            type: "error",
            id: payload.id,
            message: err instanceof Error ? err.message : String(err)
        });
    }
}

function postToNative(message: Record<string, unknown>) {
    const handler = (window as WebKitMessageHandlerWindow).webkit?.messageHandlers?.triliumScheme;
    if (!handler) {
        // Not running inside the Capacitor iOS shell (or the native side is outdated).
        console.error("[NativeBridge] triliumScheme message handler is unavailable");
        return;
    }
    handler.postMessage(message);
}

// Local base64 helpers: the shared binary utils in @triliumnext/core resolve a crypto
// provider that is only initialized inside the worker, not in this page context, and
// this module runs before any core bootstrap.

function encodeBase64(buffer: ArrayBuffer): string {
    const bytes = new Uint8Array(buffer);
    let binary = "";
    const CHUNK = 0x8000; // String.fromCharCode has an argument-count limit
    for (let i = 0; i < bytes.length; i += CHUNK) {
        binary += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
    }
    return btoa(binary);
}

function decodeBase64(base64: string): Uint8Array {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes;
}
