// =============================================================================
// ERROR HANDLERS FIRST - No static imports above this!
// ES modules hoist static imports, so they execute BEFORE any code runs.
// We use dynamic imports below to ensure error handlers are registered first.
// =============================================================================

self.onerror = (message, source, lineno, colno, error) => {
    const errorMsg = `[Worker] Uncaught error: ${message}\n  at ${source}:${lineno}:${colno}`;
    console.error(errorMsg, error);
    try {
        self.postMessage({
            type: "WORKER_ERROR",
            error: {
                message: String(message),
                source,
                lineno,
                colno,
                stack: error?.stack || new Error().stack
            }
        });
    } catch (e) {
        console.error("[Worker] Failed to report error:", e);
    }
    return false;
};

self.onunhandledrejection = (event) => {
    const reason = event.reason;
    const errorMsg = `[Worker] Unhandled rejection: ${reason?.message || reason}`;
    console.error(errorMsg, reason);
    try {
        self.postMessage({
            type: "WORKER_ERROR",
            error: {
                message: String(reason?.message || reason),
                stack: reason?.stack || new Error().stack
            }
        });
    } catch (e) {
        console.error("[Worker] Failed to report rejection:", e);
    }
};

console.log("[Worker] Error handlers installed, loading modules...");

// =============================================================================
// TYPE-ONLY IMPORTS (erased at runtime, safe as static imports)
// =============================================================================
import type { BrowserRouter } from './lightweight/browser_router';

// Build-time constant injected by Vite (see `define` in vite.config.mts).
declare const __TRILIUM_INTEGRATION_TEST__: string;

// =============================================================================
// MODULE STATE (populated by dynamic imports)
// =============================================================================
let BrowserSqlProvider: typeof import('./lightweight/sql_provider').default;
let WorkerMessagingProvider: typeof import('./lightweight/messaging_provider').default;
let BrowserExecutionContext: typeof import('./lightweight/cls_provider').default;
let BrowserCryptoProvider: typeof import('./lightweight/crypto_provider').default;
let BrowserZipProvider: typeof import('./lightweight/zip_provider').default;
let FetchRequestProvider: typeof import('./lightweight/request_provider').default;
let BridgedRequestProvider: typeof import('./lightweight/bridged_request_provider').default;
let StandalonePlatformProvider: typeof import('./lightweight/platform_provider').default;
let StandaloneLogService: typeof import('./lightweight/log_provider').default;
let StandaloneBackupService: typeof import('./lightweight/backup_provider').default;
let translationProvider: typeof import('./lightweight/translation_provider').default;
let createConfiguredRouter: typeof import('./lightweight/browser_routes').createConfiguredRouter;

// Instance state
let sqlProvider: InstanceType<typeof BrowserSqlProvider> | null = null;
let messagingProvider: InstanceType<typeof WorkerMessagingProvider> | null = null;

// Core module, router, and initialization state
let coreModule: typeof import("@triliumnext/core") | null = null;
let router: BrowserRouter | null = null;
let initPromise: Promise<void> | null = null;
let initError: Error | null = null;
let queryString = "";
let useNativeHttp = false;

/**
 * Check whether a file exists at the OPFS root. Used to decide whether the
 * test fixture needs to be seeded or whether we should reuse the existing
 * DB (preserving changes made earlier in the same test — e.g. options set
 * before a page reload).
 */
async function opfsFileExists(fileName: string): Promise<boolean> {
    if (typeof navigator === "undefined" || !navigator.storage?.getDirectory) {
        return false;
    }
    const root = await navigator.storage.getDirectory();
    try {
        await root.getFileHandle(fileName);
        return true;
    } catch {
        return false;
    }
}

/**
 * Write a raw byte buffer to an OPFS file. Used to drop the test fixture DB
 * into OPFS as a regular file so SQLite's OPFS VFS can then open it. Requires
 * a Worker context (`createSyncAccessHandle` isn't available on the main thread
 * in some browsers).
 */
async function writeOpfsFile(fileName: string, buffer: Uint8Array): Promise<void> {
    const root = await navigator.storage.getDirectory();
    const fileHandle = await root.getFileHandle(fileName, { create: true });
    const accessHandle = await (fileHandle as unknown as {
        createSyncAccessHandle(): Promise<{
            truncate(size: number): void;
            write(buffer: Uint8Array, opts: { at: number }): number;
            flush(): void;
            close(): void;
        }>;
    }).createSyncAccessHandle();
    try {
        accessHandle.truncate(0);
        accessHandle.write(buffer, { at: 0 });
        accessHandle.flush();
    } finally {
        accessHandle.close();
    }
}

/**
 * Read a file from the OPFS root into a Uint8Array.
 * Used during migration from legacy OPFS VFS to SAHPool.
 */
async function readOpfsFile(fileName: string): Promise<Uint8Array> {
    const root = await navigator.storage.getDirectory();
    const fileHandle = await root.getFileHandle(fileName);
    const file = await fileHandle.getFile();
    return new Uint8Array(await file.arrayBuffer());
}

/**
 * Delete a file from the OPFS root.
 * Used to clean up the legacy OPFS database after migration to SAHPool.
 */
async function deleteOpfsFile(fileName: string): Promise<void> {
    const root = await navigator.storage.getDirectory();
    await root.removeEntry(fileName);
}

/**
 * Verify that a buffer contains a valid SQLite database by checking the
 * 16-byte magic string "SQLite format 3\0".
 */
function assertSqliteMagic(buffer: Uint8Array, source: string): void {
    const magic = new TextDecoder().decode(buffer.subarray(0, 15));
    if (magic !== "SQLite format 3") {
        throw new Error(
            `${source} is not a SQLite database ` +
            `(got ${buffer.byteLength} bytes starting with "${magic}"). ` +
            `The file is likely missing and the SPA fallback is returning index.html.`
        );
    }
}

/**
 * Migrate database from legacy OPFS VFS to SAHPool VFS.
 * Checks if a legacy `/trilium.db` file exists in the OPFS root, and if the
 * SAHPool doesn't already have it. If migration is needed, the legacy file is
 * read, imported into the pool, and then deleted.
 */
async function migrateFromLegacyOpfs(dbName: string): Promise<void> {
    const legacyFileName = dbName.replace(/^\//, ""); // strip leading slash
    const legacyExists = await opfsFileExists(legacyFileName);

    if (!legacyExists) {
        return; // Nothing to migrate
    }

    // Check if SAHPool already has this DB (e.g. migration already happened)
    const poolFiles = sqlProvider!.sahPool!.getFileNames();
    if (poolFiles.includes(dbName)) {
        console.log("[Worker] SAHPool already contains the database, deleting legacy OPFS file...");
        await deleteOpfsFile(legacyFileName);
        return;
    }

    console.log("[Worker] Migrating database from legacy OPFS to SAHPool VFS...");
    const startTime = performance.now();

    const buffer = await readOpfsFile(legacyFileName);
    assertSqliteMagic(buffer, "Legacy OPFS database");

    await sqlProvider!.sahPool!.importDb(dbName, buffer);
    await deleteOpfsFile(legacyFileName);

    // Also clean up legacy journal/WAL files if they exist
    for (const suffix of ["-journal", "-wal", "-shm"]) {
        try {
            await deleteOpfsFile(legacyFileName + suffix);
        } catch {
            // Ignore — file may not exist
        }
    }

    const elapsed = performance.now() - startTime;
    console.log(`[Worker] Migration complete in ${elapsed.toFixed(2)}ms (${buffer.byteLength} bytes)`);
}

/**
 * Load the test fixture database for integration tests.
 * Seeds from the fixture if not already present, using SAHPool when available.
 */
async function loadTestDatabase(sahPoolAvailable: boolean, dbName: string): Promise<void> {
    if (sahPoolAvailable) {
        const poolFiles = sqlProvider!.sahPool!.getFileNames();
        if (!poolFiles.includes(dbName)) {
            console.log("[Worker] Integration test mode: seeding fixture database into SAHPool...");
            const buffer = await fetchTestFixture();
            await sqlProvider!.sahPool!.importDb(dbName, buffer);
        } else {
            console.log("[Worker] Integration test mode: reusing existing SAHPool DB from earlier in this test");
        }
        sqlProvider!.loadFromSahPool(dbName);
    } else {
        // Fallback to legacy OPFS for tests when SAHPool isn't available
        const legacyFileName = dbName.replace(/^\//, "");
        if (!(await opfsFileExists(legacyFileName))) {
            console.log("[Worker] Integration test mode: seeding fixture database into OPFS...");
            const buffer = await fetchTestFixture();
            await writeOpfsFile(legacyFileName, buffer);
        } else {
            console.log("[Worker] Integration test mode: reusing existing OPFS DB from earlier in this test");
        }
        sqlProvider!.loadFromOpfs(dbName);
    }
}

/**
 * Fetch the test fixture database and validate it.
 */
async function fetchTestFixture(): Promise<Uint8Array> {
    const response = await fetch("/test-fixtures/document.db");
    if (!response.ok) {
        throw new Error(`Failed to fetch test fixture: ${response.status} ${response.statusText}`);
    }
    const buffer = new Uint8Array(await response.arrayBuffer());
    assertSqliteMagic(buffer, "Test fixture at /test-fixtures/document.db");
    return buffer;
}

/**
 * Load all required modules using dynamic imports.
 * This allows errors to be caught by our error handlers.
 */
async function loadModules(): Promise<void> {
    console.log("[Worker] Loading lightweight modules...");
    const [
        sqlModule,
        messagingModule,
        clsModule,
        cryptoModule,
        zipModule,
        requestModule,
        platformModule,
        logModule,
        backupModule,
        translationModule,
        routesModule
    ] = await Promise.all([
        import('./lightweight/sql_provider.js'),
        import('./lightweight/messaging_provider.js'),
        import('./lightweight/cls_provider.js'),
        import('./lightweight/crypto_provider.js'),
        import('./lightweight/zip_provider.js'),
        import('./lightweight/request_provider.js'),
        import('./lightweight/platform_provider.js'),
        import('./lightweight/log_provider.js'),
        import('./lightweight/backup_provider.js'),
        import('./lightweight/translation_provider.js'),
        import('./lightweight/browser_routes.js')
    ]);

    BrowserSqlProvider = sqlModule.default;
    WorkerMessagingProvider = messagingModule.default;
    BrowserExecutionContext = clsModule.default;
    BrowserCryptoProvider = cryptoModule.default;
    BrowserZipProvider = zipModule.default;
    FetchRequestProvider = requestModule.default;
    StandalonePlatformProvider = platformModule.default;
    StandaloneLogService = logModule.default;
    StandaloneBackupService = backupModule.default;
    translationProvider = translationModule.default;
    createConfiguredRouter = routesModule.createConfiguredRouter;

    // Loaded separately to avoid breaking Promise.all tuple inference
    BridgedRequestProvider = (await import('./lightweight/bridged_request_provider.js')).default;

    // Create instances
    sqlProvider = new BrowserSqlProvider();
    messagingProvider = new WorkerMessagingProvider();

    console.log("[Worker] Lightweight modules loaded successfully");
}

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
            // First, load all modules dynamically
            await loadModules();

            // Initialize log service as early as possible so subsequent
            // initialization steps are persisted to the OPFS log file.
            const logService = new StandaloneLogService();
            await logService.initialize();
            logService.info("[Worker] Log service initialized with OPFS");

            logService.info("[Worker] Initializing SQLite WASM...");
            await sqlProvider!.initWasm();

            // Try to install the SAHPool VFS (preferred: supports WAL, much faster)
            let sahPoolAvailable = false;
            try {
                await sqlProvider!.installSahPool();
                sahPoolAvailable = true;
            } catch (e) {
                logService.info(`[Worker] SAHPool VFS not available, will fall back to legacy OPFS or in-memory: ${e}`);
            }

            // Integration test mode is baked in at build time via the
            // __TRILIUM_INTEGRATION_TEST__ Vite define (derived from the
            // TRILIUM_INTEGRATION_TEST env var when the bundle was built).
            const integrationTestMode = __TRILIUM_INTEGRATION_TEST__;
            const dbName = "/trilium.db";

            if (integrationTestMode === "memory") {
                // Use OPFS for the DB in integration test mode so option changes
                // (and any other writes) survive page reloads within a single test.
                // Playwright gives each test a fresh BrowserContext, which means a
                // fresh OPFS — so on the first worker init of a test we seed from
                // the fixture, and subsequent inits in the same test reuse it.
                await loadTestDatabase(sahPoolAvailable, dbName);
            } else if (sahPoolAvailable) {
                // SAHPool available — migrate from legacy OPFS if needed, then open
                await migrateFromLegacyOpfs(dbName);
                logService.info("[Worker] SAHPool available, loading persistent database (WAL mode)...");
                sqlProvider!.loadFromSahPool(dbName);
            } else if (sqlProvider!.isOpfsAvailable()) {
                // Fall back to legacy OPFS VFS (no WAL, slower writes).
                // This only kicks in if SAHPool installation failed for some
                // reason but SharedArrayBuffer + legacy OPFS are both available.
                logService.info("[Worker] SAHPool unavailable; using legacy OPFS VFS (no WAL mode).");
                sqlProvider!.loadFromOpfs(dbName);
            } else {
                // Fall back to in-memory database (non-persistent).
                // SAHPool only needs a Worker + OPFS API, so reaching this
                // branch means the environment lacks OPFS entirely.
                logService.info("[Worker] OPFS not available, using in-memory database (data will not persist)");
                sqlProvider!.loadFromMemory();
            }

            logService.info("[Worker] Database loaded");

            logService.info("[Worker] Loading @triliumnext/core...");
            const schemaModule = await import("@triliumnext/core/src/assets/schema.sql?raw");
            coreModule = await import("@triliumnext/core");

            await coreModule.initializeCore({
                executionContext: new BrowserExecutionContext(),
                crypto: new BrowserCryptoProvider(),
                zip: new BrowserZipProvider(),
                zipExportProviderFactory: (await import("./lightweight/zip_export_provider_factory.js")).standaloneZipExportProviderFactory,
                messaging: messagingProvider!,
                request: useNativeHttp ? new BridgedRequestProvider() : new FetchRequestProvider(),
                platform: new StandalonePlatformProvider(queryString),
                log: logService,
                backup: new StandaloneBackupService(coreModule!.options),
                translations: translationProvider,
                schema: schemaModule.default,
                getDemoArchive: async () => {
                    const response = await fetch("/server-assets/db/demo.zip");
                    if (!response.ok) return null;
                    return new Uint8Array(await response.arrayBuffer());
                },
                image: (await import("./services/image_provider.js")).standaloneImageProvider,
                dbConfig: {
                    provider: sqlProvider!,
                    isReadOnly: false,
                    onTransactionCommit: () => {
                        coreModule?.ws.sendTransactionEntityChangesToAllClients();
                    },
                    onTransactionRollback: () => {
                        // No-op for now
                    }
                }
            });
            coreModule.ws.init();

            logService.info(`[Worker] Supported routes: ${Object.keys(coreModule.routes).join(", ")}`);

            // Create and configure the router
            router = createConfiguredRouter();
            logService.info("[Worker] Router configured");

            // initializeDb runs initDbConnection inside an execution context,
            // which resolves dbReady — required before beccaLoaded can settle.
            coreModule.sql_init.initializeDb();

            if (coreModule.sql_init.isDbInitialized()) {
                logService.info("[Worker] Database already initialized, loading becca...");
                await coreModule.becca_loader.beccaLoaded;

                // `initTranslations` runs before `initSql` inside `initializeCore`
                // (options_init needs translations, creating a chicken-and-egg),
                // so it always defaults to "en" on a fresh worker boot. Now that
                // the DB is up we can read the real locale and, if it differs,
                // switch i18next and rebuild the hidden subtree with the correct
                // titles. This must happen BEFORE `startScheduler` registers its
                // own `dbReady.then(checkHiddenSubtree)` so the scheduled rebuild
                // sees the right language.
                const dbLocale = coreModule.options.getOptionOrNull("locale");
                if (dbLocale && dbLocale !== "en") {
                    logService.info(`[Worker] Reconciling i18next locale to "${dbLocale}" from DB`);
                    await coreModule.i18n.changeLanguage(dbLocale);
                }
            } else {
                logService.info("[Worker] Database not initialized, skipping becca load (will be loaded during DB initialization)");
            }

            coreModule.scheduler.startScheduler();

            logService.info("[Worker] Initialization complete");
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
    // Ensure initialization is complete and get the router
    const appRouter = await ensureInitialized();

    // Dispatch to the router
    return appRouter.dispatch(request.method, request.url, request.body, request.headers);
}

// Wait for the INIT message before initializing so that queryString
// (which may contain ?integrationTest=memory for e2e) is available.
let initReceived = false;

self.onmessage = async (event) => {
    const msg = event.data;
    if (!msg) return;

    if (msg.type === "INIT") {
        queryString = msg.queryString || "";
        useNativeHttp = msg.useNativeHttp || false;
        if (!initReceived) {
            initReceived = true;
            console.log("[Worker] Starting initialization...");
            initialize().catch(err => {
                console.error("[Worker] Initialization failed:", err);
                self.postMessage({
                    type: "WORKER_ERROR",
                    error: {
                        message: String(err?.message || err),
                        stack: err?.stack
                    }
                });
            });
        }
        return;
    }

    if (msg.type !== "LOCAL_REQUEST") return;

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
