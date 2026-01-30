import { BrowserRouter } from './lightweight/browser_router';
import { createConfiguredRouter } from './lightweight/browser_routes';
import BrowserExecutionContext from './lightweight/cls_provider';
import BrowserCryptoProvider from './lightweight/crypto_provider';
import WorkerMessagingProvider from './lightweight/messaging_provider';
import BrowserSqlProvider from './lightweight/sql_provider';
import translationProvider from './lightweight/translation_provider';

// Global error handlers - MUST be set up before any async imports
self.onerror = (message, source, lineno, colno, error) => {
    console.error("[Worker] Uncaught error:", message, source, lineno, colno, error);
    // Try to notify the main thread about the error
    try {
        self.postMessage({
            type: "WORKER_ERROR",
            error: {
                message: String(message),
                source,
                lineno,
                colno,
                stack: error?.stack
            }
        });
    } catch (e) {
        // Can't even post message, just log
        console.error("[Worker] Failed to report error:", e);
    }
    return false; // Don't suppress the error
};

self.onunhandledrejection = (event) => {
    console.error("[Worker] Unhandled rejection:", event.reason);
    try {
        self.postMessage({
            type: "WORKER_ERROR",
            error: {
                message: String(event.reason?.message || event.reason),
                stack: event.reason?.stack
            }
        });
    } catch (e) {
        console.error("[Worker] Failed to report rejection:", e);
    }
};

console.log("[Worker] Error handlers installed");

// Shared SQL provider instance
const sqlProvider = new BrowserSqlProvider();

// Messaging provider for worker-to-main-thread communication
const messagingProvider = new WorkerMessagingProvider();

// Core module, router, and initialization state
let coreModule: typeof import("@triliumnext/core") | null = null;
let router: BrowserRouter | null = null;
let initPromise: Promise<void> | null = null;
let initError: Error | null = null;

/**
 * Initialize SQLite WASM and load the core module.
 * This happens once at worker startup.
 */
async function initialize(): Promise<void> {
    if (initPromise) {
        return initPromise; // Already initializing
    }
    if (initError) {
        throw initError; // Failed before, don't retry
    }

    initPromise = (async () => {
        try {
            console.log("[Worker] Initializing SQLite WASM...");
            await sqlProvider.initWasm();

            // Try to use OPFS for persistent storage
            if (sqlProvider.isOpfsAvailable()) {
                console.log("[Worker] OPFS available, loading persistent database...");
                sqlProvider.loadFromOpfs("/trilium.db");

                // Check if database is initialized (schema exists)
                if (!sqlProvider.isDbInitialized()) {
                    console.log("[Worker] Database not initialized, loading demo data...");
                    sqlProvider.initializeDemoDatabase();
                    console.log("[Worker] Demo data loaded");
                } else {
                    console.log("[Worker] Existing initialized database loaded");
                }
            } else {
                // Fall back to in-memory database (non-persistent)
                console.warn("[Worker] OPFS not available, using in-memory database (data will not persist)");
                console.warn("[Worker] To enable persistence, ensure COOP/COEP headers are set by the server");
                sqlProvider.loadFromMemory();
            }

            console.log("[Worker] Database loaded");

            console.log("[Worker] Loading @triliumnext/core...");
            coreModule = await import("@triliumnext/core");
            await coreModule.initializeCore({
                executionContext: new BrowserExecutionContext(),
                crypto: new BrowserCryptoProvider(),
                messaging: messagingProvider,
                translations: translationProvider,
                dbConfig: {
                    provider: sqlProvider,
                    isReadOnly: false,
                    onTransactionCommit: () => {
                        // No-op for now
                    },
                    onTransactionRollback: () => {
                        // No-op for now
                    }
                }
            });

            console.log("[Worker] Supported routes", Object.keys(coreModule.routes));

            // Create and configure the router
            router = createConfiguredRouter();
            console.log("[Worker] Router configured");

            console.log("[Worker] Initializing becca...");
            await coreModule.becca_loader.beccaLoaded;

            console.log("[Worker] Initialization complete");
        } catch (error) {
            initError = error instanceof Error ? error : new Error(String(error));
            console.error("[Worker] Initialization failed:", initError);
            throw initError;
        }
    })();

    return initPromise;
}

/**
 * Ensure the worker is initialized before processing requests.
 * Returns the router if initialization was successful.
 */
async function ensureInitialized() {
    await initialize();
    if (!router) {
        throw new Error("Router not initialized");
    }
    return router;
}

interface LocalRequest {
    method: string;
    url: string;
    body?: unknown;
    headers?: Record<string, string>;
}

// Main dispatch
async function dispatch(request: LocalRequest) {
    const url = new URL(request.url);

    console.log("[Worker] Dispatch:", url.pathname);

    // Ensure initialization is complete and get the router
    const appRouter = await ensureInitialized();

    // Dispatch to the router
    return appRouter.dispatch(request.method, request.url, request.body, request.headers);
}

// Start initialization immediately when the worker loads
console.log("[Worker] Starting initialization...");
initialize().catch(err => {
    console.error("[Worker] Initialization failed:", err);
    // Post error to main thread
    self.postMessage({
        type: "WORKER_ERROR",
        error: {
            message: String(err?.message || err),
            stack: err?.stack
        }
    });
});

self.onmessage = async (event) => {
    const msg = event.data;
    if (!msg || msg.type !== "LOCAL_REQUEST") return;

    const { id, request } = msg;

    try {
        const response = await dispatch(request);

        // Transfer body back (if any) - use options object for proper typing
        (self as unknown as Worker).postMessage({
            type: "LOCAL_RESPONSE",
            id,
            response
        }, { transfer: response.body ? [response.body] : [] });
    } catch (e) {
        console.error("[Worker] Dispatch error:", e);
        (self as unknown as Worker).postMessage({
            type: "LOCAL_RESPONSE",
            id,
            error: String((e as Error)?.message || e)
        });
    }
};
