import { afterEach, beforeAll, describe, expect, it } from "vitest";

import { getContext } from "./context.js";
import eventService from "./events.js";
import { getSql } from "./sql/index.js";
import sqlInit from "./sql_init.js";
import { SqlService } from "./sql/sql.js";

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
        it("is a no-op when the DB is already initialized and does not re-emit DB_INITIALIZED", async () => {
            let dbInitializedEmitted = false;
            eventService.subscribe(eventService.DB_INITIALIZED, () => {
                dbInitializedEmitted = true;
            });

            await sqlInit.setDbAsInitialized();

            // The `!isDbInitialized()` guard skips both the option write and the event emit.
            expect(dbInitializedEmitted).toBe(false);
            expect(sqlInit.isDbInitialized()).toBe(true);
        });
    });

    describe("initDbConnection", () => {
        it("creates the param_list and users tables and resolves dbReady", async () => {
            await getContext().init(() => sqlInit.initDbConnection());

            // The connection setup creates these auxiliary tables idempotently.
            // user_data was replaced by the users table in migration 239.
            expect(
                getSql().getValue(
                    "SELECT name FROM sqlite_master WHERE type IN ('table') AND name = 'users'"
                )
            ).toBe("users");
            expect(
                getSql().getValue(
                    "SELECT name FROM sqlite_temp_master WHERE type = 'table' AND name = 'param_list'"
                )
            ).toBe("param_list");

            // dbReady is the exported deferred promise, resolved once the
            // connection is ready; awaiting it must not hang.
            await expect(Promise.resolve(sqlInit.dbReady)).resolves.toBeUndefined();
        });

        it("seeds an admin user and writes adminUserId to options", async () => {
            await getContext().init(() => sqlInit.initDbConnection());

            const adminCount = getSql().getValue<number>(
                "SELECT COUNT(*) FROM users WHERE isAdmin = 1 AND isDeleted = 0"
            );
            expect(adminCount).toBeGreaterThan(0);

            const adminUserId = getSql().getValue<string | null>(
                "SELECT value FROM options WHERE name = 'adminUserId'"
            );
            expect(typeof adminUserId).toBe("string");
            expect(adminUserId).toBeTruthy();

            // The stored adminUserId must match an actual admin user row.
            const userExists = getSql().getValue<number>(
                "SELECT COUNT(*) FROM users WHERE userId = ? AND isAdmin = 1 AND isDeleted = 0",
                [adminUserId]
            );
            expect(userExists).toBe(1);
        });
    });

    describe("seedAdminUser promotion path", () => {
        // Save and restore state so other tests aren't affected.
        let savedAdminRows: unknown[];
        let savedAdminUserId: string | null;

        beforeAll(() => {
            const sql = getSql();
            savedAdminRows = sql.getRows("SELECT * FROM users WHERE isAdmin = 1");
            savedAdminUserId = sql.getValue<string | null>(
                "SELECT value FROM options WHERE name = 'adminUserId'"
            );
        });

        afterEach(() => {
            const sql = getSql();
            sql.execute("DELETE FROM users WHERE username = 'admin'");
            for (const row of savedAdminRows) {
                const r = row as Record<string, unknown>;
                sql.execute(
                    `INSERT OR REPLACE INTO users (userId, username, email, isAdmin, isDeleted, dateCreated, utcDateModified)
                     VALUES (?, ?, ?, ?, ?, ?, ?)`,
                    [r.userId, r.username, r.email, r.isAdmin, r.isDeleted, r.dateCreated, r.utcDateModified]
                );
            }
            if (savedAdminUserId) {
                sql.execute(
                    `INSERT OR REPLACE INTO options (name, value, isSynced, utcDateModified) VALUES ('adminUserId', ?, 0, datetime('now'))`,
                    [savedAdminUserId]
                );
            }
        });

        it("promotes an existing non-admin 'admin' user when no admin row exists", () => {
            const sql = getSql();

            // Remove the seeded admin row and the option so seedAdminUser enters the fresh-insert path.
            sql.execute("UPDATE users SET isDeleted = 1 WHERE isAdmin = 1");
            sql.execute("DELETE FROM options WHERE name = 'adminUserId'");

            // Insert a non-admin user occupying the 'admin' username — OR IGNORE will skip the insert.
            const nonAdminId = "test-non-admin-01";
            sql.execute(
                `INSERT OR IGNORE INTO users (userId, username, email, isAdmin, isDeleted, dateCreated, utcDateModified)
                 VALUES (?, 'admin', NULL, 0, 0, datetime('now'), datetime('now'))`,
                [nonAdminId]
            );

            sqlInit.seedAdminUser(sql as SqlService);

            // The non-admin user should have been promoted to admin.
            const isNowAdmin = sql.getValue<number>(
                "SELECT isAdmin FROM users WHERE userId = ?", [nonAdminId]
            );
            expect(isNowAdmin).toBe(1);

            // adminUserId option must point to the promoted user.
            const adminUserId = sql.getValue<string | null>(
                "SELECT value FROM options WHERE name = 'adminUserId'"
            );
            expect(adminUserId).toBe(nonAdminId);
        });
    });
});
