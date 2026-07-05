import { deferred, isDisplayableLocale, OptionRow } from "@triliumnext/commons";
import { getSql } from "./sql";
import { getLog } from "./log";
import { getBackup } from "./backup";
import optionService from "./options";
import eventService from "./events";
import { getContext } from "./context";
import config from "./config";
import BNote from "../becca/entities/bnote";
import BBranch from "../becca/entities/bbranch";
import hidden_subtree from "./hidden_subtree";
import TaskContext from "./task_context";
import BOption from "../becca/entities/boption";
import migrationService from "./migration";
import passwordService from "./encryption/password";

export const dbReady = deferred<void>();

let schema: string;
let getDemoArchive: (() => Promise<Uint8Array | null>) | null = null;

export function initSchema(schemaStr: string) {
    schema = schemaStr;
}

export function initDemoArchive(fn: () => Promise<Uint8Array | null>) {
    getDemoArchive = fn;
}

function schemaExists() {
    return !!getSql().getValue(/*sql*/`SELECT name FROM sqlite_master
        WHERE type = 'table' AND name = 'options'`);
}

function isDbInitialized() {
    try {
        if (!schemaExists()) {
            return false;
        }

        const initialized = getSql().getValue("SELECT value FROM options WHERE name = 'initialized'");
        return initialized === "true";
    } catch (e) {
        return false;
    }
}

async function initDbConnection() {
    if (!isDbInitialized()) {
        return;
    }

    await migrationService.migrateIfNecessary();

    const sql = getSql();
    sql.execute('CREATE TEMP TABLE IF NOT EXISTS "param_list" (`paramId` TEXT NOT NULL PRIMARY KEY)');

    sql.execute(`
    CREATE TABLE IF NOT EXISTS "user_data"
    (
        tmpID INT,
        username TEXT,
        email TEXT,
        userIDEncryptedDataKey TEXT,
        userIDVerificationHash TEXT,
        salt TEXT,
        derivedKey TEXT,
        isSetup TEXT DEFAULT "false",
        UNIQUE (tmpID),
        PRIMARY KEY (tmpID)
    );`);

    dbReady.resolve();
}

function setDbAsInitialized() {
    if (!isDbInitialized()) {
        optionService.setOption("initialized", "true");

        initDbConnection();

        // Emit an event to notify that the database is now initialized
        eventService.emit(eventService.DB_INITIALIZED);

        getLog().info("Database initialization completed, emitted DB_INITIALIZED event");
    }
}

function getDbSize() {
    return getSql().getValue<number>("SELECT page_count * page_size / 1000 as size FROM pragma_page_count(), pragma_page_size()");
}

function optimize() {
    if (config.General.readOnly) {
        return;
    }
    const log = getLog();
    log.info("Optimizing database");
    const start = Date.now();

    getSql().execute("PRAGMA optimize");

    log.info(`Optimization finished in ${Date.now() - start}ms.`);
}

function initializeDb() {
    getContext().init(initDbConnection);

    dbReady.then(() => {
        getBackup().scheduleBackups();

        // Optimize is usually inexpensive no-op, so running it semi-frequently is not a big deal
        setTimeout(() => optimize(), 60 * 60 * 1000);

        setInterval(() => optimize(), 10 * 60 * 60 * 1000);
    });
}

/**
 * Applies the database schema, creating the necessary tables and importing the demo content.
 *
 * @param skipDemoDb if set to `true`, then the demo database will not be imported, resulting in an empty root note.
 * @param locale the display language chosen during setup; persisted as the `locale` option when it is a valid, displayable locale (otherwise the default is kept).
 * @throws {Error} if the database is already initialized.
 */
async function createInitialDatabase(skipDemoDb?: boolean, locale?: string) {
    if (isDbInitialized()) {
        throw new Error("DB is already initialized");
    }

    let rootNote!: BNote;

    // We have to import async since options init requires keyboard actions which require translations.
    const { initDocumentOptions, initNotSyncedOptions, initStartupOptions } = await import("./options_init.js");
    const { load: loadBecca } = await import("../becca/becca_loader.js");

    const sql = getSql();
    const log = getLog();
    sql.transactional(() => {
        log.info("Creating database schema ...");
        sql.executeScript(schema);

        loadBecca();

        log.info("Creating root note ...");

        rootNote = new BNote({
            noteId: "root",
            title: "root",
            type: "text",
            mime: "text/html"
        }).save();

        rootNote.setContent("");

        new BBranch({
            noteId: "root",
            parentNoteId: "none",
            isExpanded: true,
            notePosition: 10
        }).save();

        // Bring in option init.
        initDocumentOptions();
        initNotSyncedOptions(true, {});
        initStartupOptions();
        // Persist the language chosen during setup, overriding the default ("en").
        if (isDisplayableLocale(locale)) {
            optionService.setOption("locale", locale);
        }
        passwordService.resetPassword();
    });

    // Check hidden subtree.
    // This ensures the existence of system templates, for the demo content.
    console.log("Checking hidden subtree at first start.");
    getContext().init(() => {
        getSql().transactional(() => hidden_subtree.checkHiddenSubtree());
    });

    // Import demo content.
    if (!skipDemoDb && getDemoArchive) {
        log.info("Importing demo content...");
        const demoFile = await getDemoArchive();
        if (demoFile) {
            const { default: zipImportService } = await import("./import/zip.js");
            const dummyTaskContext = new TaskContext("no-progress-reporting", "importNotes", null);
            // The demo archive is a whole-database export whose top note IS "root"; restore it onto the
            // existing root rather than nesting it in a redundant "root" wrapper note.
            await zipImportService.importZip(dummyTaskContext, demoFile, rootNote, { restoreAsRoot: true });
        }
    }

    // Post-demo: pick the first visible (non-system) child of root as the start note.
    // System notes have IDs starting with "_" and should not be navigated to on startup.
    // Falls back to "root" if no visible child exists (e.g. empty database).
    sql.transactional(() => {
        const startNoteId = sql.getValue<string | null>(
            "SELECT noteId FROM branches WHERE parentNoteId = 'root' AND isDeleted = 0 AND substr(noteId, 1, 1) != '_' ORDER BY notePosition"
        ) ?? "root";

        optionService.setOption(
            "openNoteContexts",
            JSON.stringify([
                {
                    notePath: startNoteId,
                    active: true
                }
            ])
        );
    });

    log.info("Schema and initial content generated.");

    initDbConnection();

    // `initNotSyncedOptions(true, ...)` above already set the "initialized"
    // option, so `setDbAsInitialized` would short-circuit on its
    // `!isDbInitialized()` guard. Emit the event here directly so downstream
    // listeners (e.g. the desktop's setup→main window swap) still fire on the
    // "create new document" path, matching the behaviour of the sync flow
    // which goes through `setDbAsInitialized` via `syncFinished`.
    eventService.emit(eventService.DB_INITIALIZED);
    log.info("Database initialization completed, emitted DB_INITIALIZED event");
}

/**
 * Wipes all data from the current document and rebuilds an empty database from scratch.
 *
 * Every user table is dropped and the initial database is recreated (schema, root note, default
 * options and the hidden subtree) via {@link createInitialDatabase}, leaving the application in the
 * same state as a fresh install — but without the demo content. Becca is reloaded in-process, so the
 * running server/desktop-main/standalone-worker immediately reflects the empty database; callers on
 * the client are still expected to reload the page afterwards to reset their own caches.
 *
 * This is destructive and irreversible: there is no undo. It works identically on every platform
 * (server, desktop and standalone/mobile) because it operates purely through the SQL layer.
 *
 * On standalone/mobile the whole route runs inside a single transaction (the browser router wraps it
 * in `transactionalAsync`), so the drop-and-rebuild is atomic. On the multi-request server build the
 * drop commits before {@link createInitialDatabase} rebuilds the schema, leaving a brief window where
 * a concurrent request could observe missing tables — an acceptable trade-off for a deliberate,
 * one-off reset that immediately reloads the whole application.
 */
async function wipeDatabase() {
    const sql = getSql();
    const log = getLog();

    log.info("Wiping database ...");

    sql.transactional(() => {
        // Dropping a table also drops its indexes; the schema has no views or standalone triggers,
        // so dropping every non-internal table clears the whole document. `IF EXISTS` guards against
        // an already-empty database. Names are quoted to survive any exotic identifiers.
        const tableNames = sql.getColumn<string>(/*sql*/`SELECT name FROM sqlite_master
            WHERE type = 'table' AND name NOT LIKE 'sqlite_%'`);
        for (const tableName of tableNames) {
            sql.execute(`DROP TABLE IF EXISTS "${tableName}"`);
        }
    });

    // Skip the demo content: a wipe is meant to leave an empty document, not reintroduce sample notes.
    await createInitialDatabase(true);

    log.info("Database has been wiped and reinitialized.");
}

async function createDatabaseForSync(options: OptionRow[], syncServerHost = "", syncProxy = "", syncMaxBlobContentSize = 0) {
    const log = getLog();
    const sql = getSql();
    log.info("Creating database for sync");

    if (isDbInitialized()) {
        throw new Error("DB is already initialized");
    }

    // We have to import async since options init requires keyboard actions which require translations.
    const { initNotSyncedOptions } = await import("./options_init.js");

    sql.transactional(() => {
        sql.executeScript(schema);

        initNotSyncedOptions(false, { syncServerHost, syncProxy, syncMaxBlobContentSize });

        // document options required for sync to kick off
        for (const opt of options) {
            new BOption(opt).save();
        }
    });

    log.info("Schema and not synced options generated.");
}

export default { isDbInitialized, createDatabaseForSync, setDbAsInitialized, schemaExists, getDbSize, initDbConnection, dbReady, initializeDb, createInitialDatabase, wipeDatabase };
