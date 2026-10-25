/**
 * The search replica: a read-only copy of becca in its own process that answers the route-level
 * searches, so that a slow query does not hold the main process's event loop.
 *
 * The main process owns every write. It sends this process, in commit order, the ids of the rows
 * each transaction changed, a signal after each full reload, and the protected-session key. The
 * messages share one channel with the queries and are handled strictly in arrival order, so a query
 * sent after a commit notice sees that commit.
 *
 * The replica opens the database read-only and never runs a migration: when the schema version is
 * not the one this build expects, it reports `failed` and exits, and the main process keeps
 * searching in-process.
 */

import {
    app_info,
    applyEntityChanges,
    BackupService,
    becca,
    becca_loader,
    cls,
    type EntityChangeRef,
    i18n,
    type ImageProvider,
    initializeCore,
    LogService,
    type PlatformProvider,
    runSearchQuery,
    serializeSearchQueryError
} from "@triliumnext/core";
import protectedSessionService from "@triliumnext/core/src/services/protected_session.js";
import Database from "better-sqlite3";

import AsyncLocalStorageExecutionContext from "../../cls_provider.js";
import { loadCoreSchema } from "../../core_assets.js";
import NodejsCryptoProvider from "../../crypto_provider.js";
import NodejsInAppHelpProvider from "../../in_app_help_provider.js";
import BetterSqlite3Provider from "../../sql_provider.js";
import NodejsZipProvider from "../../zip_provider.js";
import { serverZipExportProviderFactory } from "../export/zip/factory.js";
import { initializeTranslationsWithParams } from "../i18n.js";
import { onParentMessage, postToParent } from "../workers/worker_channel.js";
import {
    REPLICA_OPTIONS_ENV, type ReplicaBootOptions, type ReplicaReply, type ReplicaRequest
} from "./replica_protocol.js";

/* v8 ignore start -- runs only inside the replica process, where the harness does not follow. */
// Deferred until the module has finished evaluating, so that the classes below exist.
const booted = new Promise<boolean>((resolve) => {
    setImmediate(() => resolve(boot().catch((e: unknown) => {
        fail(`the replica could not boot: ${describe(e)}`);
        return false;
    })));
});
let queue = Promise.resolve();

// Listening from the start lets the channel notice a parent that goes away during the boot.
onParentMessage((message) => {
    queue = queue.then(async () => {
        if (await booted) {
            await handle(message as ReplicaRequest);
        }
    });
});

async function boot(): Promise<boolean> {
    const started = Date.now();
    const options = readBootOptions();
    const header = readDatabaseHeader(options.documentPath);

    if (header.dbVersion !== app_info.dbVersion) {
        fail(`the database is at version ${header.dbVersion}, this build expects ${app_info.dbVersion}`);
        return false;
    }

    const dbProvider = new BetterSqlite3Provider();
    // The provider closes the connection on SIGTERM but stays alive; a killed replica must exit.
    process.on("SIGTERM", () => process.exit(0));
    dbProvider.loadFromFile(options.documentPath, true);

    await initializeCore({
        dbConfig: {
            provider: dbProvider,
            isReadOnly: true,
            onTransactionCommit() {},
            onTransactionRollback() {}
        },
        crypto: new NodejsCryptoProvider(),
        zip: new NodejsZipProvider(),
        zipExportProviderFactory: serverZipExportProviderFactory,
        executionContext: new AsyncLocalStorageExecutionContext(),
        schema: loadCoreSchema(),
        platform: new ReplicaPlatformProvider(options.documentPath),
        log: new ReplicaLogService(),
        translations: initializeTranslationsWithParams,
        inAppHelp: new NodejsInAppHelpProvider(),
        backup: new NoopBackupService(),
        image: unavailableImageProvider,
        config: {
            ...options.config,
            General: { ...options.config.General, readOnly: true }
        }
    });

    await becca_loader.beccaLoaded;
    // The main process loads becca before switching i18next to the stored locale, and so builds
    // the in-app help titles in English until its next load; the same order keeps them identical.
    await i18n.reconcileLanguageAfterDbInit();

    post({
        type: "ready",
        noteCount: Object.keys(becca.notes).length,
        heapUsedMb: Math.round(process.memoryUsage().heapUsed / 1024 / 1024),
        bootMs: Date.now() - started
    });

    return true;
}

async function handle(message: ReplicaRequest) {
    try {
        switch (message.type) {
            case "commit":
                applyCommit(message.changes);
                break;
            case "reload":
                await i18n.reconcileLanguageAfterDbInit();
                reload();
                break;
            case "protectedSession":
                setProtectedSession(message.dataKey);
                break;
            case "query":
                answer(message);
                break;
        }
    } catch (e: unknown) {
        log("error", `could not handle a ${message.type} message: ${describe(e)}`);
    }
}

/** Applies one commit; when that fails, loads becca again rather than search a becca that is off. */
function applyCommit(changes: EntityChangeRef[]) {
    try {
        cls.init(() => applyEntityChanges(changes));
    } catch (e: unknown) {
        log("error", `could not apply ${changes.length} changes, loading again: ${describe(e)}`);
        reload();
    }
}

function reload() {
    cls.init(() => becca_loader.load());
}

function setProtectedSession(dataKey: Uint8Array | null) {
    if (dataKey) {
        protectedSessionService.setDataKey(dataKey);
        cls.init(() => becca.decryptProtectedNotes());
    } else {
        protectedSessionService.resetDataKey();
        reload();
    }
}

function answer({ id, kind, args }: Extract<ReplicaRequest, { type: "query" }>) {
    let reply: ReplicaReply;

    try {
        reply = { type: "result", id, result: runSearchQuery(kind, args, { deferScripts: true }) };
    } catch (e: unknown) {
        reply = { type: "error", id, error: serializeSearchQueryError(e) };
    }

    post(reply);
}

function readBootOptions(): ReplicaBootOptions {
    const raw = process.env[REPLICA_OPTIONS_ENV];

    if (!raw) {
        throw new Error(`${REPLICA_OPTIONS_ENV} is not set`);
    }

    return JSON.parse(raw) as ReplicaBootOptions;
}

/** Reads the schema version before core opens the database, which would migrate an old one. */
function readDatabaseHeader(documentPath: string) {
    const db = new Database(documentPath, {
        readonly: true,
        nativeBinding: process.env.BETTERSQLITE3_NATIVE_PATH || undefined
    });

    try {
        const row = db.prepare("SELECT value FROM options WHERE name = 'dbVersion'").get() as
            { value: string } | undefined;

        return { dbVersion: parseInt(row?.value ?? "", 10) };
    } finally {
        db.close();
    }
}

function post(message: ReplicaReply) {
    postToParent(message);
}

function log(level: "info" | "error", message: string) {
    post({ type: "log", level, message });
}

function fail(reason: string) {
    post({ type: "failed", reason });
    // Lets the channel flush the message before the process goes.
    setTimeout(() => process.exit(1), 100);
}

function describe(e: unknown) {
    return e instanceof Error ? (e.stack ?? e.message) : String(e);
}

class ReplicaLogService extends LogService {
    override log(message: string | Error) {
        log("info", String(message));
    }

    override info(message: string | Error) {
        log("info", String(message));
    }

    override error(message: unknown) {
        log("error", describe(message));
    }

    override banner(message: string | undefined) {
        if (message) {
            log("error", message);
        }
    }
}

class ReplicaPlatformProvider implements PlatformProvider {
    readonly isElectron = !!process.versions.electron;
    readonly isStandalone = false;
    readonly isMac = process.platform === "darwin";
    readonly isWindows = process.platform === "win32";
    readonly isLinux = process.platform === "linux";

    constructor(private readonly documentPath: string) {}

    crash(message: string) {
        fail(message);
    }

    getEnv(key: string) {
        return process.env[key];
    }

    getDatabasePath() {
        return this.documentPath;
    }
}

/** The replica writes nothing, backups least of all. */
class NoopBackupService extends BackupService {
    constructor() {
        super({
            getOption: () => "",
            getOptionOrNull: () => null,
            getOptionBool: () => false,
            setOption() {}
        });
    }

    backupNow(): Promise<string> {
        return Promise.reject(new Error("The search replica does not back up."));
    }

    scheduleBackups() {}

    getExistingBackups() {
        return Promise.resolve([]);
    }

    getBackupContent() {
        return Promise.resolve(null);
    }
}

const unavailable = () => {
    throw new Error("The search replica does not process images.");
};

const unavailableImageProvider: ImageProvider = {
    getImageType: unavailable,
    processImage: unavailable,
    compressImage: unavailable,
    compressionConcurrency: () => 1,
    planCompression: unavailable,
    resizeForPreview: unavailable
};
/* v8 ignore stop */
