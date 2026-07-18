import type { NativeHttpHandler } from "../local-bridge.js";

// Access plugins via the global Capacitor bridge rather than importing
// from "@capacitor/core" — bare module specifiers don't resolve in the
// browser's native ES module loader.
interface CapacitorHttpResponse {
    status: number;
    headers: Record<string, string>;
    data: unknown;
}

interface HttpPlugin {
    request(opts: {
        method: string;
        url: string;
        headers: Record<string, string>;
        data?: string;
        responseType?: string;
    }): Promise<CapacitorHttpResponse>;
}

function getHttpPlugin(): HttpPlugin {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cap = (window as any).Capacitor;

    // The plugin transport only carries the requests the streaming proxy can't (login/push
    // POSTs, binary responses, and everything on iOS) — small traffic where CapacitorHttp's
    // response marshalling overhead is irrelevant, so stock CapacitorHttp is enough.
    const plugin = cap?.Plugins?.CapacitorHttp;

    if (!plugin) {
        throw new Error("No native HTTP plugin is available");
    }

    return plugin as HttpPlugin;
}

// Streaming same-origin proxy (Android only): the native side answers fetch()es under
// this path prefix from WebViewClient.shouldInterceptRequest and streams the upstream
// body straight into the WebView — no plugin-bridge envelope, no full-body Java string,
// no base64 (see TriliumWebViewClient.java). Because the page-visible request is
// same-origin, no CORS check applies; the cross-origin hop happens natively, exactly as
// it does on the plugin transports.
const NATIVE_PROXY_PREFIX = "/_trilium_native_http/";
const HEADER_TUNNEL_PREFIX = "x-trilium-h-";

let nativeProxyProbe: Promise<boolean> | null = null;

// A failed probe is retried after a while: right after an app update the previous
// service worker can still own the page's fetches (and swallow the probe) until the
// updated one calls clients.claim(), so "unavailable" may be a temporary condition.
const PROBE_RETRY_MS = 15_000;

function isNativeProxyAvailable(): Promise<boolean> {
    nativeProxyProbe ??= probeNativeProxy().then((available) => {
        if (!available) {
            setTimeout(() => {
                nativeProxyProbe = null;
            }, PROBE_RETRY_MS);
        }
        return available;
    });
    return nativeProxyProbe;
}

function probeNativeProxy(): Promise<boolean> {
    return (async () => {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const cap = (window as any).Capacitor;
        if (cap?.getPlatform?.() !== "android") {
            // iOS has no equivalent hook for https URLs — it stays on the plugin transport.
            return false;
        }
        try {
            const response = await fetch(`${NATIVE_PROXY_PREFIX}ping`, { cache: "no-store" });
            // The marker header proves the interceptor answered — on an APK older than this
            // bundle the request falls through to the asset server instead.
            return response.ok && response.headers.get("x-trilium-native-http") === "1";
        } catch {
            return false;
        }
    })();
}

/** Test-only: clears the cached availability probe. */
export function resetNativeProxyProbeForTests() {
    nativeProxyProbe = null;
}

type NativeHttpRequest = Parameters<NativeHttpHandler>[0];

function canUseNativeProxy(request: NativeHttpRequest): boolean {
    const method = request.method.toUpperCase();
    // shouldInterceptRequest cannot read request bodies, and binary responses would have
    // to be re-encoded as base64 for the bridge protocol — those stay on the plugin path.
    return (method === "GET" || method === "HEAD")
        && !request.body
        && (request.responseType ?? "text") === "text";
}

async function nativeProxyFetch(request: NativeHttpRequest): ReturnType<NativeHttpHandler> {
    // fetch() refuses forbidden header names such as Cookie, so every header rides under
    // a tunnel prefix that the interceptor strips before forwarding upstream. This also
    // means WebView-generated headers are never forwarded — only what the worker asked for.
    const tunneledHeaders: Record<string, string> = {};
    for (const [key, value] of Object.entries(request.headers)) {
        tunneledHeaders[HEADER_TUNNEL_PREFIX + key] = value;
    }

    const response = await fetch(`${NATIVE_PROXY_PREFIX}fetch?url=${encodeURIComponent(request.url)}`, {
        method: request.method,
        headers: tunneledHeaders,
        cache: "no-store"
    });

    const proxyError = response.headers.get("x-trilium-proxy-error");
    if (proxyError) {
        throw new Error(`Native HTTP proxy failed: ${proxyError}`);
    }

    // Header keys from fetch() are already lowercase.
    const headers: Record<string, string> = {};
    response.headers.forEach((value, key) => {
        headers[key] = value;
    });
    // fetch() cannot read Set-Cookie, so the interceptor re-exposes it under a safe name;
    // map it back for the worker's cookie jar.
    const setCookie = headers["x-trilium-set-cookie"];
    if (setCookie) {
        headers["set-cookie"] = setCookie;
        delete headers["x-trilium-set-cookie"];
    }

    return { status: response.status, headers, body: await response.text() };
}

/**
 * Native HTTP handler that uses the app's native networking layer.
 *
 * This bypasses the WebView's fetch — no CORS preflight, no SameSite cookie
 * restrictions, and plain HTTP targets work from an HTTPS WebView origin.
 *
 * Memory-critical: for JSON responses we pass `response.data` (already parsed
 * by Capacitor) directly through postMessage instead of re-stringifying. The
 * worker receives a structured-clone copy and skips its own JSON.parse. This
 * avoids holding two ~60 MB strings (one on each side of the bridge) plus the
 * parsed object simultaneously, which was OOM-killing the iOS Web Worker on
 * large blob sync batches.
 */
export const capacitorHttpHandler: NativeHttpHandler = async (request) => {
    if (canUseNativeProxy(request) && await isNativeProxyAvailable()) {
        try {
            return await nativeProxyFetch(request);
        } catch (e) {
            // Idempotent GET — retrying once over the plugin transport is safe and keeps
            // sync alive if the proxy misbehaves in ways the availability probe missed.
            console.warn("Native HTTP proxy failed, falling back to the plugin transport", e);
        }
    }

    const responseType = request.responseType ?? "text";
    const response = await getHttpPlugin().request({
        method: request.method,
        url: request.url,
        headers: request.headers,
        data: request.body,
        responseType
    });

    // Normalize header keys to lowercase for consistent access in the worker
    const headers: Record<string, string> = {};
    for (const [key, value] of Object.entries(response.headers)) {
        headers[key.toLowerCase()] = value;
    }

    // Binary responses come back from Capacitor as a base64 string — pass it
    // through as `body` so the worker's atob+Uint8Array path still works.
    if (request.responseType === "arraybuffer") {
        const body = String(response.data);
        return { status: response.status, headers, body };
    }

    // Server-sent plain strings (rare for JSON APIs, but valid) — pass through.
    if (typeof response.data === "string") {
        return { status: response.status, headers, body: response.data };
    }

    // Common case: JSON. Hand the parsed object to the worker via structured
    // clone. No intermediate string allocation on either side.
    return { status: response.status, headers, data: response.data };
};
