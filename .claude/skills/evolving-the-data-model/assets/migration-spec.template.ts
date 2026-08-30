/**
 * TEMPLATE — per-migration unit test.
 *
 * Copy to: packages/trilium-core/src/migrations/0NNN__<description>.spec.ts
 * Model in-tree: 0233__migrate_geo_map_to_collection.spec.ts
 * End-to-end variant (whole migrate chain): services/migration.spec.ts
 *
 * Run a single spec:
 *   pnpm --filter server test packages/trilium-core/src/migrations/0NNN__<description>.spec.ts
 *
 * Three harness traps are pre-handled below:
 *   1. getSql() is resolved INSIDE beforeEach — not at describe-collection
 *      time. describe callbacks run before the suite's initializeCore beforeAll,
 *      so capturing sql eagerly throws "SQL not initialized".
 *   2. sql.rebuildFromBuffer(fixture) runs PER TEST so mutations don't leak.
 *   3. becca_loader.load() is called after raw INSERTs AND again after the
 *      migration, all inside cls.getContext().init(...), so becca mirrors the DB.
 */

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it } from "vitest";
import * as cls from "../services/context.js";
import { getSql } from "../services/sql/index.js";
import becca from "../becca/becca.js";
import becca_loader from "../becca/becca_loader.js";
import migration from "./0NNN__<description>.js";

// Spec files only ever run under vitest (ESM via Vite), so import.meta.url is
// available. The CLAUDE.md ban on import.meta.url targets production code that
// gets bundled to CJS, not test files.
const __dirname = dirname(fileURLToPath(import.meta.url));

describe("Migration 0NNN: <description>", () => {
    let sql: ReturnType<typeof getSql>;

    beforeEach(async () => {
        sql = getSql();

        // Fresh DB per test from the shared fixture.
        const dbBytes = readFileSync(join(__dirname, "../test/fixtures/document.db"));
        sql.rebuildFromBuffer(dbBytes);

        await new Promise<void>((resolve) => {
            cls.getContext().init(() => {
                becca_loader.load();
                resolve();
            });
        });
    });

    it("transforms the targeted rows and leaves others untouched", async () => {
        await new Promise<void>((resolve) => {
            cls.getContext().init(() => {
                // Arrange: insert the pre-migration state directly via SQL.
                const noteId = "test_note_1";
                const blobId = "test_blob_1";
                sql.execute(/*sql*/`
                    INSERT INTO notes (noteId, title, type, mime, blobId, dateCreated, dateModified, utcDateCreated, utcDateModified)
                    VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'), datetime('now'), datetime('now'))
                `, [noteId, "Test Note", "someOldType", "application/json", blobId]);
                sql.execute(/*sql*/`
                    INSERT INTO blobs (blobId, content, dateModified, utcDateModified)
                    VALUES (?, ?, datetime('now'), datetime('now'))
                `, [blobId, "{}"]);

                // Reload becca so it sees the inserted rows.
                becca_loader.load();
                expect(becca.getNote(noteId)?.type).toBe("someOldType");

                // Act.
                migration();

                // Reload becca so it reflects the migrated DB.
                becca_loader.load();

                // Assert.
                const migrated = becca.getNote(noteId);
                expect(migrated?.type).toBe("code");
                expect(migrated?.mime).toBe("application/json");

                resolve();
            });
        });
    });
});
