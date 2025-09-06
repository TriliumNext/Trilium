import log from "./log.js";
import fs from "fs";
import resourceDir from "./resource_dir.js";
import sql from "./sql.js";
import { isElectron, deferred } from "./utils.js";
import optionService from "./options.js";
import port from "./port.js";
import BOption from "../becca/entities/boption.js";
import TaskContext from "./task_context.js";
import migrationService from "./migration.js";
import cls from "./cls.js";
import config from "./config.js";
import type { OptionRow } from "@triliumnext/commons";
import BNote from "../becca/entities/bnote.js";
import BBranch from "../becca/entities/bbranch.js";
import zipImportService from "./import/zip.js";
import password from "./encryption/password.js";
import backup from "./backup.js";
import eventService from "./events.js";

export const dbReady = deferred<void>();

function schemaExists() {
    return !!sql.getValue(/*sql*/`SELECT name FROM sqlite_master
                                WHERE type = 'table' AND name = 'options'`);
}

function isDbInitialized() {
    if (!schemaExists()) {
        return false;
    }

    const initialized = sql.getValue("SELECT value FROM options WHERE name = 'initialized'");

    return initialized === "true";
}

async function initDbConnection() {
    if (!isDbInitialized()) {
        log.info(`DB not initialized, please visit setup page` + (isElectron ? "" : ` - http://[your-server-host]:${port} to see instructions on how to initialize Trilium.`));

        return;
    }

    await migrationService.migrateIfNecessary();

    sql.execute('CREATE TEMP TABLE "param_list" (`paramId` TEXT NOT NULL PRIMARY KEY)');

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
    );`)

    // Register SQLite search functions after database is ready
    try {
        const { getSqliteFunctionsService } = await import("./search/sqlite_functions.js");
        const functionsService = getSqliteFunctionsService();
        const db = sql.getDbConnection();
        
        if (functionsService.registerFunctions(db)) {
            log.info("SQLite search functions registered successfully");
        } else {
            log.info("SQLite search functions registration skipped (already registered)");
        }
    } catch (error) {
        log.error(`Failed to register SQLite search functions: ${error}`);
    }

    dbReady.resolve();
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

    const schema = fs.readFileSync(`${resourceDir.DB_INIT_DIR}/schema.sql`, "utf-8");
    const demoFile = (!skipDemoDb ? fs.readFileSync(`${resourceDir.DB_INIT_DIR}/demo.zip`) : null);

    let rootNote!: BNote;

    // We have to import async since options init requires keyboard actions which require translations.
    const optionsInitService = (await import("./options_init.js")).default;
    const becca_loader = (await import("../becca/becca_loader.js")).default;

    sql.transactional(() => {
        log.info("Creating database schema ...");

        sql.executeScript(schema);

        becca_loader.load();

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

        optionsInitService.initDocumentOptions();
        optionsInitService.initNotSyncedOptions(true, {});
        optionsInitService.initStartupOptions();
        password.resetPassword();
    });

    log.info("Importing demo content ...");

    const dummyTaskContext = new TaskContext("no-progress-reporting", "import", false);

    if (demoFile) {
        await zipImportService.importZip(dummyTaskContext, demoFile, rootNote);
    }

    sql.transactional(() => {
        // this needs to happen after ZIP import,
        // the previous solution was to move option initialization here, but then the important parts of initialization
        // are not all in one transaction (because ZIP import is async and thus not transactional)

        const startNoteId = sql.getValue("SELECT noteId FROM branches WHERE parentNoteId = 'root' AND isDeleted = 0 ORDER BY notePosition");

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
    log.info("Creating database for sync");

    if (isDbInitialized()) {
        throw new Error("DB is already initialized");
    }

    const schema = fs.readFileSync(`${resourceDir.DB_INIT_DIR}/schema.sql`, "utf8");

    // We have to import async since options init requires keyboard actions which require translations.
    const optionsInitService = (await import("./options_init.js")).default;

    sql.transactional(() => {
        sql.executeScript(schema);

        optionsInitService.initNotSyncedOptions(false, { syncServerHost, syncProxy });

        // document options required for sync to kick off
        for (const opt of options) {
            new BOption(opt).save();
        }
    });

    log.info("Schema and not synced options generated.");
}

function setDbAsInitialized() {
    if (!isDbInitialized()) {
        optionService.setOption("initialized", "true");

        initDbConnection();

        // Emit an event to notify that the database is now initialized
        eventService.emit(eventService.DB_INITIALIZED);

        log.info("Database initialization completed, emitted DB_INITIALIZED event");
    }
}

function optimize() {
    if (config.General.readOnly) {
        return;
    }
    log.info("Optimizing database");
    const start = Date.now();

    sql.execute("PRAGMA optimize");

    log.info(`Optimization finished in ${Date.now() - start}ms.`);
}

function getDbSize() {
    return sql.getValue<number>("SELECT page_count * page_size / 1000 as size FROM pragma_page_count(), pragma_page_size()");
}

function initializeDb() {
    cls.init(initDbConnection);

    log.info(`DB size: ${getDbSize()} KB`);

    dbReady.then(() => {
        if (config.General && config.General.noBackup === true) {
            log.info("Disabling scheduled backups.");

            return;
        }

        setInterval(() => backup.regularBackup(), 4 * 60 * 60 * 1000);

        // kickoff first backup soon after start up
        setTimeout(() => backup.regularBackup(), 5 * 60 * 1000);

        // optimize is usually inexpensive no-op, so running it semi-frequently is not a big deal
        setTimeout(() => optimize(), 60 * 60 * 1000);

        setInterval(() => optimize(), 10 * 60 * 60 * 1000);
    });
}

export default {
    dbReady,
    schemaExists,
    isDbInitialized,
    createInitialDatabase,
    createDatabaseForSync,
    setDbAsInitialized,
    getDbSize,
    initializeDb
};
