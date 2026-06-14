import type { NativeHttpHandler } from "../local-bridge.js";

// Access CapacitorHttp via the global Capacitor bridge rather than importing
// from "@capacitor/core" — bare module specifiers don't resolve in the
// browser's native ES module loader.
interface CapacitorHttpResponse {
    status: number;
    headers: Record<string, string>;
    data: unknown;
}

function getCapacitorHttp() {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const cap = (window as any).Capacitor;
    if (!cap?.Plugins?.CapacitorHttp) {
        throw new Error("CapacitorHttp plugin is not available");
    }
    return cap.Plugins.CapacitorHttp as {
        request(opts: {
            method: string;
            url: string;
            headers: Record<string, string>;
            data?: string;
            responseType?: string;
        }): Promise<CapacitorHttpResponse>;
    };
}

/**
 * Native HTTP handler that uses Capacitor's native networking layer.
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
    const response = await getCapacitorHttp().request({
        method: request.method,
        url: request.url,
        headers: request.headers,
        data: request.body,
        responseType: request.responseType
    });

    // Normalize header keys to lowercase for consistent access in the worker
    const headers: Record<string, string> = {};
    for (const [key, value] of Object.entries(response.headers)) {
        headers[key.toLowerCase()] = value;
    }

    // Binary responses come back from Capacitor as a base64 string — pass it
    // through as `body` so the worker's atob+Uint8Array path still works.
    if (request.responseType === "arraybuffer") {
        const body = typeof response.data === "string" ? response.data : String(response.data);
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
