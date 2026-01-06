// public/local-server-worker.js
// This will eventually import your core server and DB provider.
// import { createCoreServer } from "@trilium/core"; (bundled)

import BrowserExecutionContext from './lightweight/cls_provider';
import BrowserSqlProvider from './lightweight/sql_provider';
import BrowserCryptoProvider from './lightweight/crypto_provider';

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
let sqlInitPromise: Promise<void> | null = null;
let sqlInitError: string | null = null;

// Initialize SQLite WASM via the provider
async function initSQLite(): Promise<void> {
    if (sqlProvider.isInitialized && sqlProvider.isOpen()) {
        return; // Already initialized and database open
    }
    if (sqlInitError) {
        throw new Error(sqlInitError); // Failed before, don't retry
    }
    if (sqlInitPromise) {
        return sqlInitPromise; // Already initializing
    }

    sqlInitPromise = (async () => {
        try {
            // Initialize the WASM module
            await sqlProvider.initWasm();

            // Open an in-memory database
            sqlProvider.loadFromMemory();
            console.log("[Worker] Database opened via provider");

            // Create a simple test table
            sqlProvider.exec(`
                CREATE TABLE IF NOT EXISTS options (
                    name TEXT PRIMARY KEY,
                    value TEXT
                );
                INSERT INTO options (name, value) VALUES
                    ('theme', 'dark'),
                    ('layoutOrientation', 'vertical'),
                    ('headingStyle', 'default');
            `);
            console.log("[Worker] Test table created and populated");
        } catch (error) {
            sqlInitError = String(error);
            console.error("[Worker] SQLite initialization failed:", error);
            throw error;
        }
    })();

    return sqlInitPromise;
}

// Deferred import for @triliumnext/core to catch initialization errors
let coreModule: typeof import("@triliumnext/core") | null = null;
let coreInitError: Error | null = null;

async function loadCoreModule() {
    if (coreModule) return coreModule;
    if (coreInitError) throw coreInitError;

    try {
        // Ensure SQLite is initialized before loading core
        await initSQLite();

        console.log("[Worker] Loading @triliumnext/core...");
        coreModule = await import("@triliumnext/core");
        coreModule.initializeCore({
            executionContext: new BrowserExecutionContext(),
            crypto: new BrowserCryptoProvider(),
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
        })
        console.log("[Worker] @triliumnext/core loaded successfully");
        return coreModule;
    } catch (e) {
        coreInitError = e instanceof Error ? e : new Error(String(e));
        console.error("[Worker] Failed to load @triliumnext/core:", coreInitError);
        throw coreInitError;
    }
}

const encoder = new TextEncoder();

function jsonResponse(obj: unknown, status = 200, extraHeaders = {}) {
    const body = encoder.encode(JSON.stringify(obj)).buffer;
    return {
        status,
        headers: { "content-type": "application/json; charset=utf-8", ...extraHeaders },
        body
    };
}

function textResponse(text: string, status = 200, extraHeaders = {}) {
    const body = encoder.encode(text).buffer;
    return {
        status,
        headers: { "content-type": "text/plain; charset=utf-8", ...extraHeaders },
        body
    };
}

// Example: your /bootstrap handler placeholder
async function handleBootstrap() {
    console.log("[Worker] Bootstrap request received");

    // Try to initialize SQLite with timeout
    let dbInfo: Record<string, unknown> = { dbStatus: 'not initialized' };

    if (sqlInitError) {
        dbInfo = { dbStatus: 'failed', error: sqlInitError };
    } else {
        try {
            // Don't wait too long for SQLite initialization
            await Promise.race([
                initSQLite(),
                new Promise((_, reject) => setTimeout(() => reject(new Error("SQLite init timeout")), 5000))
            ]);

            // Query the database if initialized
            if (sqlProvider.isOpen()) {
                const stmt = sqlProvider.prepare('SELECT * FROM options');
                const rows = stmt.all() as Array<{ name: string; value: string }>;
                const options: Record<string, string> = {};
                for (const row of rows) {
                    options[row.name] = row.value;
                }

                dbInfo = {
                    sqliteVersion: sqlProvider.version?.libVersion,
                    optionsFromDB: options,
                    dbStatus: 'connected'
                };
            }
        } catch (e) {
            console.error("[Worker] Error during bootstrap:", e);
            dbInfo = { dbStatus: 'error', error: String(e) };
        }
    }

    console.log("[Worker] Sending bootstrap response");

    // Later: return real globals from your core state/config.
    return jsonResponse({
        assetPath: "./",
        baseApiUrl: "../api/",
        themeCssUrl: null,
        themeUseNextAsBase: "next",
        iconPackCss: "",
        device: "desktop",
        headingStyle: "default",
        layoutOrientation: "vertical",
        platform: "web",
        isElectron: false,
        hasNativeTitleBar: false,
        hasBackgroundEffects: true,
        currentLocale: { id: "en", rtl: false },
        // Add SQLite info for testing
        sqlite: dbInfo
    });
}

interface LocalRequest {
    method: string;
    url: string;
}

// Main dispatch
async function dispatch(request: LocalRequest) {
    const url = new URL(request.url);

    console.log("[Worker] Dispatch:", url.pathname);
    // NOTE: your core router will do this later.
    if (request.method === "GET" && url.pathname === "/bootstrap") {
        return handleBootstrap();
    }

    if (request.method === "GET" && url.pathname === "/api/options") {
        try {
            // Use dynamic import to defer loading until after initialization
            const core = await loadCoreModule();
            console.log("[Worker] Options route - core module loaded");

            // Note: core.routes.optionsApiRoute.getOptions() requires
            // initializeCore() to be called first with proper db/crypto config
            console.log("[Worker] Available routes:", Object.keys(core.routes));

            // For now, return a placeholder until core is properly initialized
            return jsonResponse({
                message: "Core module loaded successfully",
                availableRoutes: Object.keys(core.routes)
            });
        } catch (e) {
            console.error("[Worker] Error loading core module:", e);
            return jsonResponse({
                error: "Failed to load core module",
                details: e instanceof Error ? e.message : String(e),
                stack: e instanceof Error ? e.stack : undefined
            }, 500);
        }
    }

    if (url.pathname.startsWith("/api/echo")) {
        return jsonResponse({ ok: true, method: request.method, url: request.url });
    }

    return textResponse("Not found", 404);
}

// Start SQLite initialization as soon as the worker loads (in background)
console.log("[Worker] Starting background SQLite initialization...");
initSQLite().catch(err => {
    console.error("[Worker] Background SQLite init failed:", err);
});

self.onmessage = async (event) => {
    const msg = event.data;
    if (!msg || msg.type !== "LOCAL_REQUEST") return;

    const { id, request } = msg;
    console.log("[Worker] Received LOCAL_REQUEST:", id, request.method, request.url);

    try {
        const response = await dispatch(request);
        console.log("[Worker] Dispatch completed, sending response:", id);

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
