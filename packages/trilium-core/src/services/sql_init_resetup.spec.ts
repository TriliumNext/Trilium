import { describe, expect, it } from "vitest";

import * as cls from "./context.js";
import { getSql } from "./sql/index.js";
import sqlInit from "./sql_init.js";

/**
 * Re-running setup after a FAILED sync-from-server attempt (#10548).
 *
 * A failed initial sync leaves the database in a half-way state: the schema and the
 * seed options exist, but `initialized` is still false. The user must be able to go
 * back in the setup wizard and take ANY path again — resubmit the sync form
 * (createDatabaseForSync), or give up on syncing and create a new document instead
 * (createInitialDatabase). Both must rebuild the database from scratch (the partial
 * pull may contain rows from a *different* server) instead of failing on the
 * already-existing schema.
 *
 * Own spec file: these tests intentionally destroy and rebuild the fixture DB, and the
 * per-file fork isolation keeps that away from every other suite.
 */
describe("createDatabaseForSync on a partially set-up database", () => {
    it("rebuilds the schema and replaces the seed options", async () => {
        const sql = getSql();

        // Turn the (initialized) fixture into the failed-setup state: schema + data
        // present, but the initial sync never converged.
        sql.execute("UPDATE options SET value = 'false' WHERE name = 'initialized'");
        expect(sqlInit.schemaExists()).toBe(true);
        expect(sqlInit.isDbInitialized()).toBe(false);
        const staleNoteCount = sql.getValue<number>("SELECT COUNT(*) FROM notes") ?? 0;
        expect(staleNoteCount).toBeGreaterThan(0);
        // Views must be wiped through DROP VIEW, not DROP TABLE.
        sql.execute("CREATE VIEW stale_view AS SELECT 1 AS x");

        // cls.init mirrors the route context this runs under in production.
        await cls.init(() => sqlInit.createDatabaseForSync(
            [
                { name: "documentId", value: "resetup-doc-id", isSynced: true, utcDateModified: "2026-07-18 00:00:00.000Z" },
                { name: "documentSecret", value: "resetup-doc-secret", isSynced: true, utcDateModified: "2026-07-18 00:00:00.000Z" }
            ],
            "http://corrected-server:8080"
        ));

        // The schema is back and pristine: no leftovers from the previous partial pull.
        expect(sqlInit.schemaExists()).toBe(true);
        expect(sql.getValue<number>("SELECT COUNT(*) FROM notes")).toBe(0);
        expect(sql.getValue<number>("SELECT COUNT(*) FROM sqlite_master WHERE name = 'stale_view'")).toBe(0);

        // The new seed and sync options won.
        expect(sql.getValue<string>("SELECT value FROM options WHERE name = 'documentId'")).toBe("resetup-doc-id");
        expect(sql.getValue<string>("SELECT value FROM options WHERE name = 'documentSecret'")).toBe("resetup-doc-secret");
        expect(sql.getValue<string>("SELECT value FROM options WHERE name = 'syncServerHost'")).toBe("http://corrected-server:8080");
    });

    it("also rebuilds when the user gives up on syncing and creates a new document instead", async () => {
        const sql = getSql();

        // Failed-setup state again, with a marker row standing in for partially pulled data.
        sql.execute("UPDATE options SET value = 'false' WHERE name = 'initialized'");
        sql.execute(/*sql*/`INSERT INTO notes (noteId, title, type, mime, isProtected, isDeleted, dateCreated, dateModified, utcDateCreated, utcDateModified)
            VALUES ('stalePulled1', 'stale', 'text', 'text/html', 0, 0, '2026-07-18', '2026-07-18', '2026-07-18', '2026-07-18')`);
        expect(sqlInit.schemaExists()).toBe(true);
        expect(sqlInit.isDbInitialized()).toBe(false);

        await cls.init(() => sqlInit.createInitialDatabase(true, "en"));

        // A pristine new document: initialized, root note present, no leftovers.
        expect(sqlInit.isDbInitialized()).toBe(true);
        expect(sql.getValue<number>("SELECT COUNT(*) FROM notes WHERE noteId = 'root'")).toBe(1);
        expect(sql.getValue<number>("SELECT COUNT(*) FROM notes WHERE noteId = 'stalePulled1'")).toBe(0);
    });

    it("is a no-op wipe on a virgin database (no schema at all)", async () => {
        const sql = getSql();

        // Reduce the DB to a truly empty file, as on a first-ever run.
        sql.execute("UPDATE options SET value = 'false' WHERE name = 'initialized'");
        const objects = sql.getRows<{ name: string; type: string }>(
            /*sql*/`SELECT name, type FROM sqlite_master WHERE type IN ('table', 'view') AND name NOT LIKE 'sqlite_%'`
        );
        for (const { name, type } of objects) {
            sql.execute(`DROP ${type === "view" ? "VIEW" : "TABLE"} IF EXISTS "${name}"`);
        }
        expect(sqlInit.schemaExists()).toBe(false);

        await cls.init(() => sqlInit.createDatabaseForSync(
            [{ name: "documentSecret", value: "virgin-secret", isSynced: true, utcDateModified: "2026-07-18 00:00:00.000Z" }],
            "http://sync-server:8080"
        ));

        expect(sqlInit.schemaExists()).toBe(true);
        expect(sql.getValue<string>("SELECT value FROM options WHERE name = 'documentSecret'")).toBe("virgin-secret");
    });
});
