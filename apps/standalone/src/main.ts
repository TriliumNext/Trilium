import {
    initSplashProgress, reportSplashPhase, type SplashPhase
} from "../../client/src/services/splash.js";
import { showErrorOverlay } from "./error-overlay.js";
import { installIosInterceptors } from "./ios-interceptors.js";
import { claimLeadership } from "./leader_election.js";
import { announceLeadership, attachServiceWorkerBridge, downloadDatabase, registerNativeHttpHandler, restoreBackup, startLocalServerWorker } from "./local-bridge.js";

/**
 * What a cold standalone start passes through, drawn as the splash's progress bar. Weights are
 * the relative cost of each step on a first visit, where the two large downloads — the SQLite
 * WASM binary and the core bundle — dominate; a warm start runs the same sequence from cache.
 *
 * The worker reports the middle of this sequence over `STARTUP_PROGRESS` (see local-bridge.ts),
 * and the client reports the last two once its entry point is loading its layout and note tree.
 * A follower tab has no worker of its own, so it sits on the first phase until the leader answers
 * its `/bootstrap` and the client's own phases carry the bar the rest of the way.
 *
 * The client's own `bootstrap` phase is deliberately absent: here `/bootstrap` is answered by the
 * worker, so it does not follow the worker's steps but spans them. Listing it would let index.ts
 * report it while the worker was still on `sqlite`, and the monotonic guard in reportSplashPhase()
 * would then swallow every later worker phase.
 */
const STANDALONE_STARTUP_PHASES: SplashPhase[] = [
    { id: "service-worker", weight: 1, status: "Setting up offline support…" },
    { id: "worker-modules", weight: 1, status: "Starting up…" },
    { id: "sqlite", weight: 3, status: "Loading the database engine…" },
    { id: "database", weight: 2, status: "Opening the database…" },
    { id: "core", weight: 4, status: "Loading Trilium…" },
    { id: "becca", weight: 2, status: "Reading your notes…" },
    { id: "application", weight: 4, status: "Loading the application…" },
    { id: "interface", weight: 2, status: "Building the interface…" },
    { id: "notes", weight: 1, status: "Loading the note tree…" }
];

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
    reportSplashPhase("service-worker");

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

    // Claimed before the client loads, so standalone's longer sequence is the one the bar shows
    // rather than the two client-side phases index.ts would otherwise install.
    initSplashProgress(STANDALONE_STARTUP_PHASES);

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
