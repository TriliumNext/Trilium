import { deferred, OptionRow } from "@triliumnext/commons";
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
 * @throws {Error} if the database is already initialized.
 */
async function createInitialDatabase(skipDemoDb?: boolean) {
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
            await zipImportService.importZip(dummyTaskContext, demoFile, rootNote);
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
}

async function createDatabaseForSync(options: OptionRow[], syncServerHost = "", syncProxy = "") {
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

        initNotSyncedOptions(false, { syncServerHost, syncProxy });

        // document options required for sync to kick off
        for (const opt of options) {
            new BOption(opt).save();
        }
    });

    log.info("Schema and not synced options generated.");
}

export default { isDbInitialized, createDatabaseForSync, setDbAsInitialized, schemaExists, getDbSize, initDbConnection, dbReady, initializeDb, createInitialDatabase };
