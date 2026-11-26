import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import { getSql } from "../services/sql/index.js";
import { MIGRATIONS } from "./migrations.js";

const NOTIFICATION_TABLES = [
    "notifications", "notification_marks", "notification_private_texts",
    "notification_channel_records", "notification_deliveries"
];

describe("migrations", () => {
    it("should have unique version numbers", () => {
        const versions = MIGRATIONS.map((m) => m.version);
        const uniqueVersions = new Set(versions);
        expect(versions.length).toBe(uniqueVersions.size);
    });

    it("should be sorted in descending order by version", () => {
        for (let i = 1; i < MIGRATIONS.length; i++) {
            expect(MIGRATIONS[i - 1].version, `migration at index ${i - 1} (v${MIGRATIONS[i - 1].version}) should be greater than migration at index ${i} (v${MIGRATIONS[i].version})`).toBeGreaterThan(MIGRATIONS[i].version);
        }
    });

    it("creates the tables of notifications as schema.sql does for a new database", () => {
        const schema = readFileSync(
            join(dirname(fileURLToPath(import.meta.url)), "../assets/schema.sql"), "utf-8");
        const migration = MIGRATIONS.find(({ version }) => version === 245);
        const statementsOf = (sql: string) => sql.split(";")
            .map((statement) => statement.replace(/\s+/g, " ").trim())
            .filter((statement) => /\bnotification/.test(statement));

        expect(migration && "sql" in migration).toBe(true);
        const statements = statementsOf(migration && "sql" in migration ? migration.sql : "");
        expect(statements).toEqual(statementsOf(schema));
        expect(statements.filter((statement) => statement.startsWith("CREATE TABLE")))
            .toHaveLength(NOTIFICATION_TABLES.length);

        // The test database was migrated to this version when the suite started.
        for (const table of NOTIFICATION_TABLES) {
            expect(getSql().getValue(
                "SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?", [ table ]), table)
                .toBe(1);
        }
    });
});
