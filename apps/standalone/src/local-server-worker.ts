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
import type { StandaloneRestoreProgress, StandaloneRestoreResult } from "@triliumnext/commons";

// Nothing that opens a database or a backup is imported statically: both reach for the backup
// container and the whole of core, and evaluating those at worker startup is what kept the iOS
// worker from booting. Every use below loads its module when it is actually needed.

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
let removeBackupLeftovers: typeof import('./lightweight/backup_provider').removeBackupLeftovers;
let StandaloneInAppHelpProvider: typeof import('./lightweight/in_app_help_provider').default;
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
 * Load the test fixture database for integration tests.
 * Seeds from the fixture if not already present.
 */
async function loadTestDatabase(sahPoolAvailable: boolean, dbName: string): Promise<void> {
    if (!sahPoolAvailable) {
        throw new Error("SAHPool is required for integration tests.");
    }

    const poolFiles = sqlProvider!.sahPool!.getFileNames();
    if (!poolFiles.includes(dbName)) {
        console.log("[Worker] Integration test mode: seeding fixture database into SAHPool...");
        const buffer = await fetchTestFixture();
        await sqlProvider!.sahPool!.importDb(dbName, buffer);
    } else {
        console.log("[Worker] Integration test mode: reusing existing SAHPool DB from earlier in this test");
    }
    sqlProvider!.loadFromSahPool(dbName);
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
    removeBackupLeftovers = backupModule.removeBackupLeftovers;
    translationProvider = translationModule.default;
    createConfiguredRouter = routesModule.createConfiguredRouter;

    // Loaded separately to avoid breaking Promise.all tuple inference
    BridgedRequestProvider = (await import('./lightweight/bridged_request_provider.js')).default;
    StandaloneInAppHelpProvider = (await import('./lightweight/in_app_help_provider.js')).default;

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
                logService.info(`[Worker] SAHPool VFS not available, will fall back to in-memory: ${e}`);
            }

            // Integration test mode is baked in at build time via the
            // __TRILIUM_INTEGRATION_TEST__ Vite define (derived from the
            // TRILIUM_INTEGRATION_TEST env var when the bundle was built).
            const integrationTestMode = __TRILIUM_INTEGRATION_TEST__;
            // Which pool entry holds the database is a stored answer rather than a constant: a
            // restore cannot rename an entry, so it writes the new database in beside the old one
            // and changes this. Unrestored instances read the name they have always used.
            const { readCurrentDatabaseName } = await import('./lightweight/database_restore.js');
            const dbName = await readCurrentDatabaseName();

            if (integrationTestMode === "memory") {
                // Use OPFS for the DB in integration test mode so option changes
                // (and any other writes) survive page reloads within a single test.
                // Playwright gives each test a fresh BrowserContext, which means a
                // fresh OPFS — so on the first worker init of a test we seed from
                // the fixture, and subsequent inits in the same test reuse it.
                await loadTestDatabase(sahPoolAvailable, dbName);
            } else if (sahPoolAvailable) {
                logService.info("[Worker] SAHPool available, loading persistent database (WAL mode)...");
                sqlProvider!.loadFromSahPool(dbName);
            } else {
                // SAHPool only needs a Worker + OPFS API, so reaching this
                // branch means the environment lacks OPFS entirely.
                logService.info("[Worker] OPFS not available, using in-memory database (data will not persist)");
                sqlProvider!.loadFromMemory();
            }

            logService.info("[Worker] Database loaded");

            // A backup interrupted by the page going away leaves its snapshot in the pool, up to
            // the database's own size. Reclaimed here so the space is back whether or not another
            // backup is ever taken.
            const backupPool = sqlProvider?.sahPool;
            if (backupPool) {
                removeBackupLeftovers(backupPool);
            }

            logService.info("[Worker] Loading @triliumnext/core...");
            const schemaModule = await import("@triliumnext/core/src/assets/schema.sql?raw");
            coreModule = await import("@triliumnext/core");
            const {
                consumeSetupMarker,
                removeSetupMarker,
                writeSetupMarker
            } = await import('./lightweight/setup_marker.js');

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
                inAppHelp: new StandaloneInAppHelpProvider(),
                image: (await import("./services/image_provider.js")).standaloneImageProvider,
                // Read before core opens anything, because what it says is whether to open the
                // database at all: a page reloaded by the app itself comes back to the wizard.
                setupMarker: await consumeSetupMarker(),
                setupPlatform: {
                    writeMarker: writeSetupMarker,
                    removeMarker: removeSetupMarker,
                    removeDatabase: removeStandaloneDatabase
                },
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

                // An interrupted initial sync (schema present but not yet
                // initialized) is resumed by startSyncTimer()'s kickoff below:
                // sync() calls setDbAsInitialized() once it converges, and the
                // client stays on the sync-in-progress screen via the
                // `syncInProgress` bootstrap flag. No explicit trigger needed here.
            }

            coreModule.sync.startSyncTimer();
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

/**
 * Erases the database the wizard was booted away from, and leaves an empty one in its place.
 *
 * The pool has no notion of "no database", and everything after this point in the wizard writes to
 * one: creating a document, converging a sync. So the entry is unlinked and a fresh one opened under
 * the name a first run uses, which is exactly the state a browser that had never run Trilium is in.
 */
async function removeStandaloneDatabase(): Promise<void> {
    const pool = sqlProvider?.sahPool;
    if (!sqlProvider || !pool) {
        throw new Error("The database is not open, so there is nothing to erase.");
    }

    const {
        DEFAULT_DATABASE_NAME,
        readCurrentDatabaseName,
        writeCurrentDatabaseName
    } = await import('./lightweight/database_restore.js');

    const live = await readCurrentDatabaseName();
    sqlProvider.close();

    try {
        pool.unlink(live);
    } catch {
        // Already gone, which is the state the caller asked for.
    }

    await writeCurrentDatabaseName(DEFAULT_DATABASE_NAME);
    sqlProvider.loadFromSahPool(DEFAULT_DATABASE_NAME);
}

/**
 * Restores the database from a backup handed straight to this worker.
 *
 * Answers rather than throws: the caller is a page waiting on a message, and every way this can end
 * is something the setup screen has to say to the user. A missing passphrase is not a failure but a
 * question, so it is reported as one and the same file can be offered again with an answer.
 */
async function handleRestoreBackup(id: string, backup: File, passphrase?: string): Promise<void> {
    const answer = (result: StandaloneRestoreResult) =>
        (self as unknown as Worker).postMessage({ type: "RESTORE_RESULT", id, result });
    const report = (progress: StandaloneRestoreProgress) =>
        (self as unknown as Worker).postMessage({ type: "RESTORE_PROGRESS", id, progress });

    const core = coreModule;
    const pool = sqlProvider?.sahPool;
    if (!core || !sqlProvider || !pool) {
        answer({ status: "error", reason: "swap-failed", message: "The database is not ready yet." });
        return;
    }

    // What `checkAppNotInitialized` is to the server's routes. A restore replaces the database
    // wholesale, so it is only ever offered by the setup screen; a tab left open on that screen
    // after another one finished setting up must not act on it.
    if (core.sql_init.isDbInitialized()) {
        answer({ status: "error", reason: "already-initialized", message: "The database is already set up." });
        return;
    }

    // Two restores would prepare over each other, since they write the same candidate.
    if (restoreInProgress) {
        answer({ status: "error", reason: "restore-refused", message: "A restore is already running." });
        return;
    }

    restoreInProgress = true;

    const { restoreDatabase, RestoreFailure } = await import('./lightweight/database_restore.js');

    try {
        await restoreDatabase(
            {
                pool,
                close: () => sqlProvider?.close(),
                open: (dbName) => sqlProvider?.loadFromSahPool(dbName)
            },
            backup,
            { passphrase, report: ({ stage, fraction }) => report({ stage, fraction }) }
        );

        // Whatever asked this instance into setup has had its answer, and until this is said the
        // instance keeps reporting that it has nothing to open, which is what the next line checks.
        core.leaveSetupMode();

        // What the "create new document" path announces for the same reason: everything that waits
        // on a database being there starts from here.
        await core.sql_init.initDbConnection();
        core.events.emit(core.events.DB_INITIALIZED);

        answer({ status: "restored" });
    } catch (e) {
        const reason = e instanceof RestoreFailure ? e.reason : "swap-failed";
        const message = e instanceof Error ? e.message : String(e);

        answer(reason === "passphrase-required"
            ? { status: "needs-passphrase" }
            : { status: "error", reason, message });
    } finally {
        restoreInProgress = false;
    }
}

/** Whether a restore is running, since a second one would prepare over the first one's work. */
let restoreInProgress = false;

/**
 * Streams the database into a download the service worker is holding open on the other end of
 * `port`. Every way this ends is reported twice over: through the port for the download's sake,
 * and to the page, which keeps the service worker alive while the stream runs and whose screen
 * gates its Continue on the outcome.
 */
async function handleBackupStream(port: MessagePort, passphrase?: string): Promise<void> {
    const announce = (active: boolean, result?: { status: string; message?: string }) =>
        (self as unknown as Worker).postMessage({ type: "BACKUP_STREAM_ACTIVE", active, result });

    const core = coreModule;
    if (!core || !sqlProvider?.isOpen()) {
        port.postMessage({ type: "error", message: "The database is not ready yet." });
        port.close();
        announce(false, { status: "failed", message: "The database is not ready yet." });
        return;
    }

    console.log("[Worker] Streaming a backup download...");
    announce(true);

    const { streamDatabaseDownload } = await import("./lightweight/backup-download.js");
    const result = await streamDatabaseDownload(
        { getValue: (sql, params) => core.getSql().getValue(sql, params) },
        // A MessagePort satisfies the seam at runtime; only the `onmessage` property's event
        // parameter is typed wider here than the seam's, which a cast is the whole cost of.
        port as unknown as import("./lightweight/backup-download.js").DownloadPort,
        { passphrase }
    );

    announce(false, result);
    console.log(`[Worker] Backup download stream ended: ${result.status}.`);
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

    if (msg.type === "RESTORE_BACKUP") {
        await handleRestoreBackup(msg.id, msg.backup, msg.passphrase);
        return;
    }

    if (msg.type === "BACKUP_STREAM") {
        await handleBackupStream(msg.port, msg.passphrase);
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
