import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it } from "vitest";

import { getSql } from "../services/sql/index.js";
import { MIGRATIONS } from "./migrations.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Flashcards were added as plain SQL migrations in migrations.ts because the schema is additive.
 * These specs execute the exact shipped SQL against the preloaded document fixture so table shape,
 * indexes, undo snapshot columns, and scheduler config snapshots cannot drift from service expectations.
 */
describe("Migration 0241/0242/0243: flashcards", () => {
    let sql: ReturnType<typeof getSql>;

    beforeEach(() => {
        sql = getSql();
        sql.rebuildFromBuffer(readFileSync(join(__dirname, "../test/fixtures/document.db")));
        sql.execute("DROP TABLE IF EXISTS flashcard_reviews");
        sql.execute("DROP TABLE IF EXISTS flashcards");
    });

    it("creates flashcard tables and does not create cards for existing notes", () => {
        runSqlMigration(241);

        expect(sql.getValue<number>(/*sql*/`SELECT COUNT(1) FROM flashcards`)).toBe(0);
        expect(sql.getValue<number>(/*sql*/`SELECT COUNT(1) FROM flashcard_reviews`)).toBe(0);
        expect(columnNames("flashcards")).toEqual(expect.arrayContaining([
            "cardId",
            "noteId",
            "deckNoteId",
            "state",
            "due",
            "schedulingRevision",
            "algorithm",
            "algorithmVersion",
            "isDeleted"
        ]));
        expect(columnNames("flashcard_reviews")).toEqual(expect.arrayContaining([
            "reviewId",
            "cardId",
            "rating",
            "dueBefore",
            "dueAfter",
            "clientRequestId"
        ]));
        expect(indexSql("IDX_flashcards_noteId_ordinal")).toContain("WHERE isDeleted = 0");
        expect(indexSql("IDX_flashcard_reviews_clientRequestId")).toContain(
            "WHERE clientRequestId IS NOT NULL"
        );
    });

    it("adds review undo snapshot columns", () => {
        runSqlMigration(241);
        runSqlMigration(242);

        expect(columnNames("flashcard_reviews")).toEqual(expect.arrayContaining([
            "elapsedDaysBefore",
            "scheduledDaysBefore",
            "learningStepsBefore",
            "repsBefore",
            "lapsesBefore",
            "lastReviewBefore",
            "schedulingRevisionBefore",
            "schedulingRevisionAfter"
        ]));
    });

    it("adds scheduler config snapshots to cards and reviews", () => {
        runSqlMigration(241);
        runSqlMigration(242);
        runSqlMigration(243);

        expect(columnNames("flashcards")).toContain("schedulerConfig");
        expect(columnNames("flashcard_reviews")).toContain("schedulerConfig");
    });

    function runSqlMigration(version: number) {
        const migration = MIGRATIONS.find((candidate) => candidate.version === version);
        if (!migration || !("sql" in migration)) {
            throw new Error(`SQL migration ${version} was not found.`);
        }

        sql.executeScript(migration.sql);
    }

    function columnNames(tableName: string) {
        return sql.getRows<{ name: string }>(`PRAGMA table_info(${tableName})`)
            .map((row) => row.name);
    }

    function indexSql(indexName: string) {
        return sql.getValue<string>(/*sql*/`
            SELECT sql FROM sqlite_master
            WHERE type = 'index' AND name = ?`, [indexName]);
    }
});
