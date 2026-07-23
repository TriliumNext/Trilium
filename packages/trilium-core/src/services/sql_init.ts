import { deferred, isDisplayableLocale, OptionRow, setDayjsLocale } from "@triliumnext/commons";
import i18next from "i18next";
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
    const { initDocumentOptions, initNewDocumentOptions, initNotSyncedOptions, initStartupOptions } = await import("./options_init.js");
    const { load: loadBecca } = await import("../becca/becca_loader.js");

    const sql = getSql();
    const log = getLog();
    sql.transactional(() => {
        wipePartialSchema();

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
        // Only on this path, and never in `createDatabaseForSync`: these defaults are synced, so on a
        // database created for sync they would overwrite the server's values (see #10626).
        initNewDocumentOptions();
        initStartupOptions();
        // Persist the language chosen during setup, overriding the default ("en").
        if (isDisplayableLocale(locale)) {
            optionService.setOption("locale", locale);
        }
        passwordService.resetPassword();
    });

    // Persisting the `locale` option above only records the choice in the DB; it does not switch the
    // active i18next language. Switch it now, before `checkHiddenSubtree` builds the built-in titles,
    // otherwise every system note (Options, Launch Bar, templates, Help) is created in English regardless
    // of the language selected during setup.
    await applySetupLanguage(locale);

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
 * Applies the display language chosen during initial setup to the running i18next (and dayjs) instance.
 *
 * `createInitialDatabase` persists the choice as the `locale` option, but that is only a DB write: because
 * `initTranslations` runs before `initSql` inside `initializeCore` (options_init needs translations),
 * i18next is still on the boot default "en" at setup time. Switching here, before the hidden subtree is
 * built, ensures the built-in note titles are generated in the selected language. Undefined or
 * non-displayable locales are ignored so the default is kept.
 */
export async function applySetupLanguage(locale: string | undefined) {
    if (!isDisplayableLocale(locale)) {
        return;
    }

    await i18next.changeLanguage(locale);
    await setDayjsLocale(locale);
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
        wipePartialSchema();

        sql.executeScript(schema);

        initNotSyncedOptions(false, { syncServerHost, syncProxy, syncMaxBlobContentSize });

        // document options required for sync to kick off
        for (const opt of options) {
            new BOption(opt).save();
        }
    });

    log.info("Schema and not synced options generated.");
}

/**
 * Drops every table and view left behind by a FAILED sync-from-server attempt (schema
 * created, sync never converged, `initialized` still false — see #10548). From that state
 * the setup wizard lets the user take any path again: resubmit the sync form, sync from a
 * desktop, or create a new document — all of which rebuild the schema and must start from
 * a clean slate, since the partially pulled rows may even belong to a different server.
 * No-op on a virgin database.
 */
function wipePartialSchema() {
    if (!schemaExists()) {
        return;
    }

    getLog().info("Schema exists from a previous unfinished setup — wiping it before re-creating.");

    const sql = getSql();
    const objects = sql.getRows<{ name: string; type: string }>(
        /*sql*/`SELECT name, type FROM sqlite_master WHERE type IN ('table', 'view') AND name NOT LIKE 'sqlite_%'`
    );
    for (const { name, type } of objects) {
        sql.execute(`DROP ${type === "view" ? "VIEW" : "TABLE"} IF EXISTS "${name.replace(/"/g, '""')}"`);
    }
}

export default { isDbInitialized, createDatabaseForSync, setDbAsInitialized, schemaExists, getDbSize, initDbConnection, dbReady, initializeDb, createInitialDatabase };
