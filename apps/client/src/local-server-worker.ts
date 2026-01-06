// public/local-server-worker.js
// This will eventually import your core server and DB provider.
// import { createCoreServer } from "@trilium/core"; (bundled)

import sqlite3InitModule from '@sqlite.org/sqlite-wasm';

const encoder = new TextEncoder();

// SQLite WASM instance
let sqlite3: any = null;
let db: any = null;
let sqliteInitPromise: Promise<void> | null = null;
let sqliteInitError: string | null = null;

function jsonResponse(obj, status = 200, extraHeaders = {}) {
    const body = encoder.encode(JSON.stringify(obj)).buffer;
    return {
        status,
        headers: { "content-type": "application/json; charset=utf-8", ...extraHeaders },
        body
    };
}

function textResponse(text, status = 200, extraHeaders = {}) {
    const body = encoder.encode(text).buffer;
    return {
        status,
        headers: { "content-type": "text/plain; charset=utf-8", ...extraHeaders },
        body
    };
}

// Initialize SQLite WASM
async function initSQLite() {
    if (sqlite3) return; // Already initialized
    if (sqliteInitError) return; // Failed before, don't retry
    if (sqliteInitPromise) return sqliteInitPromise; // Already initializing

    sqliteInitPromise = (async () => {
        try {
            console.log("[Worker] Initializing SQLite WASM...");
            const startTime = performance.now();

            // Just call the init module without custom locateFile
            // The module will use import.meta.url to find sqlite3.wasm
            sqlite3 = await sqlite3InitModule({
                print: console.log,
                printErr: console.error,
            });

            const initTime = performance.now() - startTime;
            console.log(`[Worker] SQLite WASM initialized in ${initTime.toFixed(2)}ms:`, sqlite3.version);

            // Open a database in memory for now
            db = new sqlite3.oo1.DB(':memory:', 'c');
            console.log("[Worker] Database opened");

            // Create a simple test table
            db.exec(`
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
            sqliteInitError = String(error);
            console.error("[Worker] SQLite initialization failed:", error);
            throw error;
        }
    })();

    return sqliteInitPromise;
}

// Example: your /bootstrap handler placeholder
async function handleBootstrap() {
    console.log("[Worker] Bootstrap request received");

    // Try to initialize SQLite with timeout
    let dbInfo: any = { dbStatus: 'not initialized' };

    if (sqliteInitError) {
        dbInfo = { dbStatus: 'failed', error: sqliteInitError };
    } else {
        try {
            // Don't wait too long for SQLite initialization
            await Promise.race([
                initSQLite(),
                new Promise((_, reject) => setTimeout(() => reject(new Error("SQLite init timeout")), 5000))
            ]);

            // Query the database if initialized
            if (db) {
                const stmt = db.prepare('SELECT * FROM options');
                const options: Record<string, string> = {};
                while (stmt.step()) {
                    const row = stmt.get({});
                    options[row.name] = row.value;
                }
                stmt.finalize();

                dbInfo = {
                    sqliteVersion: sqlite3.version.libVersion,
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

// Main dispatch
async function dispatch(request) {
    const url = new URL(request.url);

    console.log("[Worker] Dispatch:", url.pathname);
    // NOTE: your core router will do this later.
    if (request.method === "GET" && url.pathname === "/bootstrap") {
        return handleBootstrap();
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

        // Transfer body back (if any)
        self.postMessage({
            type: "LOCAL_RESPONSE",
            id,
            response
        }, response.body ? [response.body] : []);
    } catch (e) {
        console.error("[Worker] Dispatch error:", e);
        self.postMessage({
            type: "LOCAL_RESPONSE",
            id,
            error: String(e?.message || e)
        });
    }
};
