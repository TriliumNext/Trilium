import { beforeAll, describe, expect, it } from "vitest";

import { getContext } from "./context.js";
import eventService from "./events.js";
import { getSql } from "./sql/index.js";
import sqlInit from "./sql_init.js";

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
