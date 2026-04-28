import { attachServiceWorkerBridge, startLocalServerWorker, localFetch, isLocalApiRequest } from "./local-bridge.js";

async function waitForServiceWorkerControl(): Promise<void> {
    if (!("serviceWorker" in navigator) || !navigator.serviceWorker) {
        const isSecure = location.protocol === "https:" || location.hostname === "localhost" || location.hostname === "127.0.0.1";
        const hints: string[] = [];
        if (!isSecure) {
            hints.push(`The page is served over ${location.protocol}//${location.hostname} which is not a secure context. Service workers require HTTPS (or localhost).`);
        }
        if (window.isSecureContext === false) {
            hints.push("The browser reports this is not a secure context.");
        }
        throw new Error(
            "Service workers are not available in this browser.\n\n" +
            "Trilium standalone mode requires service workers to function.\n" +
            (hints.length ? "\nPossible cause:\n- " + hints.join("\n- ") + "\n" : "") +
            "\nTo fix this, access the application over HTTPS or via localhost."
        );
    }

    if (navigator.serviceWorker.controller) {
        console.log("[Bootstrap] Service worker already controlling");
        return;
    }

    console.log("[Bootstrap] Waiting for service worker to take control...");

    await navigator.serviceWorker.register("./sw.js", { scope: "/" });
    await navigator.serviceWorker.ready;

    if (navigator.serviceWorker.controller) {
        console.log("[Bootstrap] Service worker now controlling");
        return;
    }

    console.log("[Bootstrap] Service worker installed but not controlling yet - reloading page");
    await new Promise(resolve => setTimeout(resolve, 100));
    window.location.reload();
    throw new Error("Reloading for service worker activation");
}

function setupFetchInterceptor() {
    const originalFetch = window.fetch.bind(window);
    window.fetch = (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
        const urlStr = typeof input === "string" ? input
            : input instanceof URL ? input.href
            : (input as Request).url;
        const url = new URL(urlStr, location.href);
        if (url.origin === location.origin && isLocalApiRequest(url)) {
            return localFetch(new Request(input, init));
        }
        return originalFetch(input, init);
    };

}

// jQuery $.ajax uses XMLHttpRequest, which window.fetch interception does not
// catch. On the capacitor:// scheme there is no Service Worker to route
// requests, so XHR-bound API calls would hit the native bridge and return
// something other than the expected JSON. Route them through the local worker.
function setupXhrInterceptor() {
    const OriginalXHR = window.XMLHttpRequest;

    class PatchedXHR extends OriginalXHR {
        private _ti_method = "GET";
        private _ti_url = "";
        private _ti_intercept = false;
        private _ti_headers: Record<string, string> = {};
        private _ti_responseType: XMLHttpRequestResponseType = "";

        open(method: string, url: string | URL, async?: boolean, user?: string | null, password?: string | null) {
            const urlStr = typeof url === "string" ? url : url.href;
            const abs = new URL(urlStr, location.href);
            this._ti_method = method;
            this._ti_url = abs.href;
            this._ti_intercept = abs.origin === location.origin && isLocalApiRequest(abs);
            this._ti_headers = {};
            if (!this._ti_intercept) {
                return super.open(method, url as string, async ?? true, user ?? null, password ?? null);
            }
        }

        setRequestHeader(name: string, value: string) {
            if (!this._ti_intercept) return super.setRequestHeader(name, value);
            this._ti_headers[name] = value;
        }

        get responseType(): XMLHttpRequestResponseType {
            if (this._ti_intercept) return this._ti_responseType;
            return super.responseType;
        }

        set responseType(value: XMLHttpRequestResponseType) {
            if (this._ti_intercept) {
                this._ti_responseType = value;
                return;
            }
            super.responseType = value;
        }

        send(body?: Document | XMLHttpRequestBodyInit | null) {
            if (!this._ti_intercept) return super.send(body as any);

            const init: RequestInit = { method: this._ti_method, headers: this._ti_headers };
            if (body != null && this._ti_method !== "GET" && this._ti_method !== "HEAD") {
                init.body = body as BodyInit;
            }

            (async () => {
                try {
                    const resp = await localFetch(new Request(this._ti_url, init));
                    const buffer = await resp.arrayBuffer();
                    const text = new TextDecoder().decode(buffer);

                    let parsedResponse: unknown = text;
                    if (this._ti_responseType === "json") {
                        try { parsedResponse = JSON.parse(text); } catch { parsedResponse = null; }
                    } else if (this._ti_responseType === "arraybuffer") {
                        parsedResponse = buffer;
                    } else if (this._ti_responseType === "blob") {
                        parsedResponse = new Blob([buffer], { type: resp.headers.get("content-type") ?? "" });
                    }

                    const headerLines = [...resp.headers.entries()]
                        .map(([k, v]) => `${k}: ${v}`).join("\r\n");

                    Object.defineProperty(this, "readyState", { value: 4, configurable: true });
                    Object.defineProperty(this, "status", { value: resp.status, configurable: true });
                    Object.defineProperty(this, "statusText", { value: resp.statusText, configurable: true });
                    Object.defineProperty(this, "responseURL", { value: this._ti_url, configurable: true });
                    Object.defineProperty(this, "responseText", {
                        get: () => {
                            if (this._ti_responseType && this._ti_responseType !== "text") {
                                throw new DOMException(
                                    "responseText is only available when responseType is '' or 'text'",
                                    "InvalidStateError"
                                );
                            }
                            return text;
                        },
                        configurable: true,
                    });
                    Object.defineProperty(this, "response", { value: parsedResponse, configurable: true });
                    Object.defineProperty(this, "getAllResponseHeaders", {
                        value: () => headerLines,
                        configurable: true,
                    });
                    Object.defineProperty(this, "getResponseHeader", {
                        value: (name: string) => resp.headers.get(name),
                        configurable: true,
                    });

                    this.dispatchEvent(new Event("readystatechange"));
                    this.dispatchEvent(new ProgressEvent("load"));
                    this.dispatchEvent(new ProgressEvent("loadend"));
                } catch (err) {
                    Object.defineProperty(this, "readyState", { value: 4, configurable: true });
                    Object.defineProperty(this, "status", { value: 0, configurable: true });
                    this.dispatchEvent(new Event("readystatechange"));
                    this.dispatchEvent(new ProgressEvent("error"));
                    this.dispatchEvent(new ProgressEvent("loadend"));
                }
            })();
        }
    }

    window.XMLHttpRequest = PatchedXHR as unknown as typeof XMLHttpRequest;
}

async function bootstrap() {
    /* fixes https://github.com/webpack/webpack/issues/10035 */
    window.global = globalThis;

    try {
        startLocalServerWorker();

        // iOS Capacitor loads on capacitor:// scheme — WebKit rejects service worker
        // registration for non-HTTP/HTTPS origins. Use a fetch interceptor instead
        // to route API calls directly to the local SQLite worker. XHR must also be
        // patched because jQuery $.ajax (used by the client's server helpers) does
        // not go through window.fetch.
        if (location.protocol === "capacitor:") {
            setupFetchInterceptor();
            setupXhrInterceptor();
        } else {
            attachServiceWorkerBridge();
            await waitForServiceWorkerControl();
        }

        await loadScripts();
    } catch (err) {
        if (err instanceof Error && err.message.includes("Reloading")) {
            return;
        }

        console.error("[Bootstrap] Fatal error:", err);
        document.body.innerHTML = `
            <div style="padding: 40px; max-width: 600px; margin: 0 auto; font-family: system-ui, sans-serif;">
                <h1 style="color: #d32f2f;">Failed to Initialize</h1>
                <p>The application failed to start. Please check the browser console for details.</p>
                <pre style="background: #f5f5f5; padding: 16px; border-radius: 4px; overflow: auto; white-space: pre-wrap; word-wrap: break-word;">${err instanceof Error ? err.message : String(err)}</pre>
                <button onclick="location.reload()" style="padding: 12px 24px; background: #1976d2; color: white; border: none; border-radius: 4px; cursor: pointer; font-size: 16px;">
                    Reload Page
                </button>
            </div>
        `;
        document.body.style.display = "block";
    }
}

async function loadScripts() {
    await import("../../client/src/index.js");
}

bootstrap();
