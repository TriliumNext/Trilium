import { installIosInterceptors } from "./ios-interceptors.js";
import { attachServiceWorkerBridge, registerNativeHttpHandler, startLocalServerWorker } from "./local-bridge.js";

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

async function bootstrap() {
    /* fixes https://github.com/webpack/webpack/issues/10035 */
    window.global = globalThis;

    try {
        // A native desktop shell (apps/desktop-deno) serves this bundle with
        // a real HTTP backend on the same origin and marks the page with
        // TRILIUM_NATIVE_SERVER: skip the in-page server (worker + service
        // worker) entirely and let all API calls go to the network.
        if ((window as { TRILIUM_NATIVE_SERVER?: boolean }).TRILIUM_NATIVE_SERVER) {
            await loadScripts();
            return;
        }

        // When running inside a Capacitor WebView, register the native HTTP
        // handler so outbound sync requests bypass CORS and cookie restrictions.
        if ("Capacitor" in window) {
            const { capacitorHttpHandler } = await import("./services/capacitor_http_handler.js");
            registerNativeHttpHandler(capacitorHttpHandler);
        }

        // 1) Start local worker ASAP (so /bootstrap is fast)
        startLocalServerWorker();

        // iOS Capacitor loads on the capacitor:// scheme, where WebKit rejects
        // service worker registration. Fall back to in-page request interceptors
        // that route API calls straight to the local SQLite worker; everywhere
        // else (Android https, web) the service worker handles this.
        if (location.protocol === "capacitor:") {
            installIosInterceptors();
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
