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
import dateUtils from "./utils/date";
import { newEntityId } from "./utils/index";
import { SqlService } from "./sql/sql";

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

function tryExecute(sql: SqlService, query: string, params: unknown[], label: string) {
    try {
        sql.execute(query, params);
    } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        if (msg.includes("no such table") || msg.includes("no such column")) {
            return; // expected in minimal test fixtures
        }
        getLog().error(`seedAdminUser: unexpected error during ${label}: ${msg}`);
    }
}

function seedAdminUser(sql: SqlService) {
    const now = dateUtils.utcNowDateTime();

    let adminUserId = sql.getValue<string | null>(
        "SELECT userId FROM users WHERE isAdmin = 1 AND isDeleted = 0 LIMIT 1"
    );

    if (!adminUserId) {
        adminUserId = newEntityId();
        // OR IGNORE: a non-admin user named "admin" would conflict with the partial unique index.
        sql.execute(
            `INSERT OR IGNORE INTO users (userId, username, email, isAdmin, isDeleted, dateCreated, utcDateModified)
             VALUES (?, 'admin', NULL, 1, 0, ?, ?)`,
            [adminUserId, now, now]
        );

        const inserted = sql.getValue<string | null>(
            "SELECT userId FROM users WHERE userId = ?", [adminUserId]
        );
        if (!inserted) {
            // Insert was skipped; promote the existing "admin" username to admin role.
            const existingId = sql.getValue<string | null>(
                "SELECT userId FROM users WHERE username = 'admin' AND isDeleted = 0"
            );
            if (existingId) {
                getLog().info("seedAdminUser: promoting existing 'admin' user to admin role.");
                sql.execute(`UPDATE users SET isAdmin = 1, utcDateModified = ? WHERE userId = ?`, [now, existingId]);
                adminUserId = existingId;
            } else {
                getLog().error("seedAdminUser: could not insert or find an admin user.");
                return;
            }
        }
    }

    tryExecute(sql, `UPDATE notes        SET ownerId = ? WHERE ownerId IS NULL`, [adminUserId], "notes backfill");
    tryExecute(sql, `UPDATE etapi_tokens SET userId  = ? WHERE userId  IS NULL`, [adminUserId], "etapi_tokens backfill");

    sql.execute(
        `INSERT OR REPLACE INTO options (name, value, isSynced, utcDateModified) VALUES ('adminUserId', ?, 0, ?)`,
        [adminUserId, now]
    );
}

async function initDbConnection() {
    if (!isDbInitialized()) {
        return;
    }

    await migrationService.migrateIfNecessary();

    const sql = getSql();
    sql.execute('CREATE TEMP TABLE IF NOT EXISTS "param_list" (`paramId` TEXT NOT NULL PRIMARY KEY)');

    seedAdminUser(sql);

    dbReady.resolve();
}

async function setDbAsInitialized() {
    if (!isDbInitialized()) {
        optionService.setOption("initialized", "true");

        await initDbConnection();

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

    await initDbConnection();

    // `initNotSyncedOptions(true, ...)` above already set the "initialized"
    // option, so `setDbAsInitialized` would short-circuit on its
    // `!isDbInitialized()` guard. Emit the event here directly so downstream
    // listeners (e.g. the desktop's setup→main window swap) still fire on the
    // "create new document" path, matching the behaviour of the sync flow
    // which goes through `setDbAsInitialized` via `syncFinished`.
    eventService.emit(eventService.DB_INITIALIZED);
    log.info("Database initialization completed, emitted DB_INITIALIZED event");
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

export default { isDbInitialized, createDatabaseForSync, setDbAsInitialized, schemaExists, getDbSize, initDbConnection, dbReady, initializeDb, createInitialDatabase, seedAdminUser };
