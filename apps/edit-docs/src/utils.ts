import IpcMessagingProvider from "@triliumnext/desktop/src/ipc_messaging_provider.js";
import { registerTriliumAppScheme, setupTriliumAppProtocol } from "@triliumnext/desktop/src/protocol.js";
import windowService, { setupWindowing } from "@triliumnext/desktop/src/services/window.js";
import electron from "electron";

import { deferred, type DeferredPromise } from "../../../packages/commons/src/index.js";
import { initializeDocsCore } from "./docs_pipeline.js";

// Register the `trilium-app://` scheme synchronously at module load (before any
// `await` in edit-docs.ts / edit-demo.ts) so it lands before `app.ready` fires
// — otherwise Chromium blocks the navigation with `(blocked:origin)`.
registerTriliumAppScheme();

export async function initializeEditDocsCore() {
    // edit-docs is Electron-based and reuses the desktop preload, so the
    // renderer talks to the server over the IPC bridge — never opens a
    // WebSocket. Use IpcMessagingProvider so the server side actually
    // delivers messages to the renderer; otherwise toasts / entity-change
    // notifications would silently drop on the floor.
    const messaging = new IpcMessagingProvider();
    messaging.init();

    await initializeDocsCore(messaging);
}

/**
 * Electron has a behaviour in which the "ready" event must have a listener attached before it gets to initialize.
 * If async tasks are awaited before the "ready" event is bound, then the window will never shown.
 * This method works around by creating a deferred promise. It will immediately bind to the "ready" event and wait for that promise to be resolved externally.
 *
 * @param callback a method to be called after the server and Electron is initialized.
 * @returns the deferred promise that must be resolved externally before the Electron app is started.
 */
export function startElectron(callback: () => void): DeferredPromise<void> {
    const initializedPromise = deferred<void>();

    const readyHandler = async () => {
        await initializedPromise;

        // Start the server.
        const startTriliumServer = (await import("@triliumnext/server/src/www.js")).default;
        const expressApp = await startTriliumServer();

        // Install the `trilium-app://` request handler that bridges the
        // renderer's page / asset / API requests into Express. Without this the
        // main window navigates to `trilium-app://app/` but nothing answers it,
        // leaving a blank screen with no requests. Desktop does the same in
        // apps/desktop/src/main.ts.
        setupTriliumAppProtocol(expressApp);

        // Register the main-process IPC handlers the renderer relies on (window
        // management, clipboard, and crucially the `navigation-history` channel).
        // Without this, the renderer's synchronous `navigationCanGoBack/Forward`
        // IPC calls hit no listener — which storms the TabHistoryNavigationButtons
        // render loop with tens of thousands of blocking sendSync calls and pegs
        // the renderer. Desktop registers these in apps/desktop/src/main.ts.
        // (This also installs the WebContents security policy — webview-attach
        // vetting, window-open/navigation guards, permission handlers.)
        setupWindowing();

        // Create the main window.
        await windowService.createMainWindow();

        callback();
    };

    // Handle race condition: Electron ready event may have already fired
    if (electron.app.isReady()) {
        readyHandler();
    } else {
        electron.app.on("ready", readyHandler);
    }

    return initializedPromise;
}
