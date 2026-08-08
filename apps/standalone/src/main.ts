import { showErrorOverlay } from "./error-overlay.js";
import { installIosInterceptors } from "./ios-interceptors.js";
import { claimLeadership } from "./leader_election.js";
import { announceLeadership, attachServiceWorkerBridge, downloadDatabase, registerNativeHttpHandler, restoreBackup, startLocalServerWorker } from "./local-bridge.js";

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

    // The client's way to the worker for the few things that carry a file, which the request path
    // would serialise whole and time out on. The desktop's `window.electronApi` is the same idea.
    window.standaloneApi = {
        restore: { importBackup: restoreBackup },
        backup: { downloadDatabase }
    };

    try {
        // When running inside a Capacitor WebView, register the native HTTP
        // handler so outbound sync requests bypass CORS and cookie restrictions.
        if ("Capacitor" in window) {
            const { capacitorHttpHandler } = await import("./services/capacitor_http_handler.js");
            registerNativeHttpHandler(capacitorHttpHandler);
        }

        // 1) Start the local worker ASAP (so /bootstrap is fast) — but only in
        // the tab that wins the database lock. A second worker cannot open the
        // OPFS database at all; before this gate it silently fell back to an
        // empty in-memory one. Other tabs reach this worker through the service
        // worker instead. See leader_election.ts.
        claimLeadership(() => {
            startLocalServerWorker();
            announceLeadership();
        });

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
        showErrorOverlay(
            "Failed to Initialize",
            err instanceof Error ? err.message : String(err)
        );
    }
}

async function loadScripts() {
    await import("../../client/src/index.js");
}

bootstrap();
