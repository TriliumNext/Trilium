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

    let body: string;
    if (request.responseType === "arraybuffer") {
        // Capacitor returns binary data as a base64 string — pass it through directly
        body = String(response.data);
    } else {
        body = typeof response.data === "string"
            ? response.data
            : JSON.stringify(response.data);
    }

    return { status: response.status, headers, body };
};
