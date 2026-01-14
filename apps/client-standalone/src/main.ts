import { attachServiceWorkerBridge, startLocalServerWorker } from "./local-bridge.js";

async function waitForServiceWorkerControl(): Promise<void> {
    if (!("serviceWorker" in navigator)) {
        throw new Error("Service Worker not supported in this browser");
    }

    // If already controlling, we're good
    if (navigator.serviceWorker.controller) {
        console.log("[Bootstrap] Service worker already controlling");
        return;
    }

    console.log("[Bootstrap] Waiting for service worker to take control...");

    // Register service worker
    await navigator.serviceWorker.register("./sw.js", { scope: "/" });

    // Wait for it to be ready (installed + activated)
    await navigator.serviceWorker.ready;

    // Check if we're now controlling
    if (navigator.serviceWorker.controller) {
        console.log("[Bootstrap] Service worker now controlling");
        return;
    }

    // If not controlling yet, we need to reload the page for SW to take control
    // This is standard PWA behavior on first install
    console.log("[Bootstrap] Service worker installed but not controlling yet - reloading page");

    // Wait a tiny bit for SW to fully activate
    await new Promise(resolve => setTimeout(resolve, 100));

    // Reload to let SW take control
    window.location.reload();

    // Throw to stop execution (page will reload)
    throw new Error("Reloading for service worker activation");
}

async function bootstrap() {
    /* fixes https://github.com/webpack/webpack/issues/10035 */
    window.global = globalThis;

    try {
        // 1) Start local worker ASAP (so /bootstrap is fast)
        startLocalServerWorker();

        // 2) Bridge SW -> local worker
        attachServiceWorkerBridge();

        // 3) Wait for service worker to control the page (may reload on first install)
        await waitForServiceWorkerControl();

        await loadScripts();
    } catch (err) {
        // If error is from reload, it will stop here (page reloads)
        // Otherwise, show error to user
        if (err instanceof Error && err.message.includes("Reloading")) {
            // Page is reloading, do nothing
            return;
        }

        console.error("[Bootstrap] Fatal error:", err);
        document.body.innerHTML = `
            <div style="padding: 40px; max-width: 600px; margin: 0 auto; font-family: system-ui, sans-serif;">
                <h1 style="color: #d32f2f;">Failed to Initialize</h1>
                <p>The application failed to start. Please check the browser console for details.</p>
                <pre style="background: #f5f5f5; padding: 16px; border-radius: 4px; overflow: auto;">${err instanceof Error ? err.message : String(err)}</pre>
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
