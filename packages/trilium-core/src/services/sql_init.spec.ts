import i18next from "i18next";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { getBackup } from "./backup.js";
import { getConfig } from "./config.js";
import { getContext } from "./context.js";
import eventService from "./events.js";
import { enterSetupMode, leaveSetupMode } from "./setup_mode.js";
import { getSql } from "./sql/index.js";
import sqlInit, { applySetupLanguage, initDemoArchive } from "./sql_init.js";

describe("sql_init (real DB)", () => {
    beforeAll(() => {
        // The shared in-memory fixture DB is already initialised by the suite
        // setup, so getSql() must be available.
        expect(getSql()).toBeDefined();
    });

    describe("schemaExists", () => {
        it("reports the options table present in the initialised fixture DB", () => {
            expect(sqlInit.schemaExists()).toBe(true);
        });
    });

    describe("isDbInitialized", () => {
        it("is true because the fixture DB has the 'initialized' option set", () => {
            // Sanity: the underlying option really is "true" in the fixture.
            expect(getSql().getValue("SELECT value FROM options WHERE name = 'initialized'")).toBe("true");
            expect(sqlInit.isDbInitialized()).toBe(true);
        });
    });

    describe("getDbSize", () => {
        it("returns a positive page-based size for the populated fixture DB", () => {
            const size = sqlInit.getDbSize();
            expect(typeof size).toBe("number");
            expect(size).toBeGreaterThan(0);
        });
    });

    describe("createInitialDatabase", () => {
        it("throws on an already-initialised DB without mutating the schema", async () => {
            const branchCountBefore = getSql().getValue<number>("SELECT COUNT(*) FROM branches");

            await expect(sqlInit.createInitialDatabase()).rejects.toThrow("DB is already initialized");

            // The early guard runs before any schema/transaction work, so nothing changed.
            expect(getSql().getValue<number>("SELECT COUNT(*) FROM branches")).toBe(branchCountBefore);
            expect(sqlInit.isDbInitialized()).toBe(true);
        });
    });

    describe("createDatabaseForSync", () => {
        it("throws on an already-initialised DB without applying the schema or options", async () => {
            const optionCountBefore = getSql().getValue<number>("SELECT COUNT(*) FROM options");

            await expect(sqlInit.createDatabaseForSync([])).rejects.toThrow("DB is already initialized");

            // Guard short-circuits before initNotSyncedOptions / option inserts.
            expect(getSql().getValue<number>("SELECT COUNT(*) FROM options")).toBe(optionCountBefore);
        });
    });

    describe("setDbAsInitialized", () => {
        it("is a no-op when the DB is already initialized and does not re-emit DB_INITIALIZED", () => {
            let dbInitializedEmitted = false;
            eventService.subscribe(eventService.DB_INITIALIZED, () => {
                dbInitializedEmitted = true;
            });

            sqlInit.setDbAsInitialized();

            // The `!isDbInitialized()` guard skips both the option write and the event emit.
            expect(dbInitializedEmitted).toBe(false);
            expect(sqlInit.isDbInitialized()).toBe(true);
        });
    });

    describe("applySetupLanguage", () => {
        afterEach(() => {
            vi.restoreAllMocks();
        });

        it("switches i18next to the locale chosen during setup", async () => {
            const changeLanguage = vi.spyOn(i18next, "changeLanguage").mockResolvedValue((() => "") as never);

            await applySetupLanguage("de");

            // Persisting the `locale` option is not enough — the running i18next instance must be switched
            // before the hidden subtree is built, otherwise the built-in titles are generated in English.
            expect(changeLanguage).toHaveBeenCalledWith("de");
        });

        it("leaves the language untouched for an undefined or non-displayable locale", async () => {
            const changeLanguage = vi.spyOn(i18next, "changeLanguage").mockResolvedValue((() => "") as never);

            await applySetupLanguage(undefined);
            await applySetupLanguage("zz-not-a-locale");

            expect(changeLanguage).not.toHaveBeenCalled();
        });
    });

    describe("initDbConnection", () => {
        it("creates the param_list and user_data tables and resolves dbReady", async () => {
            await getContext().init(() => sqlInit.initDbConnection());

            // The connection setup creates these auxiliary tables idempotently.
            expect(
                getSql().getValue(
                    "SELECT name FROM sqlite_master WHERE type IN ('table') AND name = 'user_data'"
                )
            ).toBe("user_data");
            expect(
                getSql().getValue(
                    "SELECT name FROM sqlite_temp_master WHERE type = 'table' AND name = 'param_list'"
                )
            ).toBe("param_list");

            // dbReady is the exported deferred promise, resolved once the
            // connection is ready; awaiting it must not hang.
            await expect(Promise.resolve(sqlInit.dbReady)).resolves.toBeUndefined();
        });
    });
});

describe("sql_init startup", () => {
    afterEach(() => {
        vi.useRealTimers();
        vi.restoreAllMocks();
    });

    it("leaves the connection closed while setup is requested", async () => {
        const execute = vi.spyOn(getSql(), "execute");
        enterSetupMode({ lang: "en" });
        try {
            await getContext().init(() => sqlInit.initDbConnection());
        } finally {
            leaveSetupMode();
        }
        expect(execute).not.toHaveBeenCalled();
    });

    it("schedules backups and optimizes the database periodically unless it is read-only", async () => {
        vi.useFakeTimers();
        const scheduleBackups = vi.spyOn(getBackup(), "scheduleBackups").mockImplementation(() => {});
        const execute = vi.spyOn(getSql(), "execute");

        sqlInit.initializeDb();
        await sqlInit.dbReady;
        expect(scheduleBackups).toHaveBeenCalledOnce();

        execute.mockClear();
        await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
        expect(execute).toHaveBeenCalledWith("PRAGMA optimize");

        execute.mockClear();
        const general = getConfig().General;
        general.readOnly = true;
        try {
            await vi.advanceTimersByTimeAsync(10 * 60 * 60 * 1000);
        } finally {
            general.readOnly = false;
        }
        expect(execute).not.toHaveBeenCalledWith("PRAGMA optimize");
    });
});

/** Rebuilds the database from scratch, so it runs last and leaves an empty document behind. */
describe("createInitialDatabase with demo content", () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    async function createAgain(locale: string) {
        getSql().execute("UPDATE options SET value = 'false' WHERE name = 'initialized'");
        await getContext().init(() => sqlInit.createInitialDatabase(false, locale));
    }

    it("imports the demo archive onto the root note when the platform provides one", async () => {
        const { default: zipImportService } = await import("./import/zip.js");
        const importZip = vi.spyOn(zipImportService, "importZip").mockResolvedValue(undefined as never);
        const archive = new Uint8Array([ 1, 2, 3 ]);
        const getDemoArchive = vi.fn<() => Promise<Uint8Array | null>>().mockResolvedValueOnce(null).mockResolvedValueOnce(archive);
        initDemoArchive(getDemoArchive);

        await createAgain("zz-not-a-locale");
        expect(getDemoArchive).toHaveBeenCalledOnce();
        expect(importZip).not.toHaveBeenCalled();
        // A locale that cannot be displayed keeps the default.
        expect(getSql().getValue("SELECT value FROM options WHERE name = 'locale'")).toBe("en");

        await createAgain("en");
        expect(importZip).toHaveBeenCalledOnce();
        const [ , file, parent, options ] = importZip.mock.calls[0];
        expect(file).toBe(archive);
        expect(parent.noteId).toBe("root");
        expect(options).toEqual({ restoreAsRoot: true });
    });
});
