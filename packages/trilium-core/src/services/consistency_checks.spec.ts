import { describe, expect, it } from "vitest";
import { getContext } from "./context.js";
import { getSql } from "./sql/index.js";
import consistency_checks from "./consistency_checks.js";
import syncOptions from "./sync_options.js";
import optionsService from "./options.js";
import becca_loader from "../becca/becca_loader.js";

let testCounter = 0;

/**
 * Simulates a partially-synced database by creating a note whose parent
 * note does not exist. This is exactly what happens when a sync client
 * pulls a branch/note record but the parent note hasn't arrived yet.
 *
 * Each call uses unique IDs to avoid conflicts between tests sharing the
 * same in-memory database.
 */
function simulatePartialSync() {
    testCounter++;
    const missingParentNoteId = `MISSING_PAR_${testCounter}`;
    const testNoteId = `PARTIAL_NOTE${testCounter}`;
    const branchId = `orphan_br_${testCounter}`;

    insertNote(testNoteId);
    insertBranch(branchId, testNoteId, missingParentNoteId, 0);

    // Reload Becca so it sees the raw-SQL-inserted entities,
    // just like what happens after sync_update applies pulled changes.
    becca_loader.reload("simulate partial sync");

    return { missingParentNoteId, testNoteId, branchId };
}

function insertNote(noteId: string) {
    getSql().execute(`
        INSERT INTO notes (noteId, title, type, mime, isProtected, isDeleted, deleteId, blobId,
            dateCreated, dateModified, utcDateCreated, utcDateModified)
        VALUES (?, 'Test Note', 'text', 'text/html', 0, 0, NULL,
            (SELECT blobId FROM notes WHERE noteId = 'root'),
            '2026-01-01 00:00:00', '2026-01-01 00:00:00',
            '2026-01-01 00:00:00Z', '2026-01-01 00:00:00Z')
    `, [noteId]);

    return noteId;
}

function insertBranch(branchId: string, noteId: string, parentNoteId: string, isDeleted: number) {
    getSql().execute(`
        INSERT INTO branches (branchId, noteId, parentNoteId, notePosition, prefix, isExpanded,
            isDeleted, utcDateModified)
        VALUES (?, ?, ?, 999, NULL, 0, ?, '2026-01-01 00:00:00Z')
    `, [branchId, noteId, parentNoteId, isDeleted]);
}

function setOption(name: string, value: string) {
    (optionsService.setOption as any)(name, value);
}

describe("Consistency checks during partial sync", () => {

    it("should NOT fix broken references when sync is incomplete", async () => {
        await getContext().init(async () => {
            // Simulate sync being configured
            setOption("syncServerHost", "https://fake-sync-server");
            expect(syncOptions.isSyncSetup()).toBe(true);

            // Mark sync as incomplete
            setOption("syncIncomplete", "true");

            const { testNoteId, branchId } = simulatePartialSync();

            // Verify the orphaned branch exists before checks
            const sql = getSql();
            const branchBefore = sql.getValue(
                "SELECT branchId FROM branches WHERE branchId = ? AND isDeleted = 0",
                [branchId]
            );
            expect(branchBefore).toBe(branchId);

            // Run consistency checks — with syncIncomplete=true, these should be skipped
            await consistency_checks.runOnDemandChecks(true);

            // The orphaned branch should still exist (NOT deleted)
            const branchAfter = sql.getValue(
                "SELECT branchId FROM branches WHERE branchId = ? AND isDeleted = 0",
                [branchId]
            );
            expect(branchAfter).toBe(branchId);

            // No recovery branch should have been created
            const recoveryBranch = sql.getValue(
                "SELECT branchId FROM branches WHERE noteId = ? AND parentNoteId = 'root' AND prefix = 'recovered'",
                [testNoteId]
            );
            expect(recoveryBranch).toBeFalsy();
        });
    });

    it("should fix broken references when sync is complete", async () => {
        await getContext().init(async () => {
            // Simulate sync being configured and complete
            setOption("syncServerHost", "https://fake-sync-server");
            setOption("syncIncomplete", "false");

            const { testNoteId, branchId } = simulatePartialSync();

            await consistency_checks.runOnDemandChecks(true);

            // The orphaned branch should have been deleted
            const sql = getSql();
            const branchAfter = sql.getValue(
                "SELECT branchId FROM branches WHERE branchId = ? AND isDeleted = 0",
                [branchId]
            );
            expect(branchAfter).toBeFalsy();

            // A recovery branch should have been created under root
            const recoveryBranch = sql.getValue(
                "SELECT branchId FROM branches WHERE noteId = ? AND parentNoteId = 'root' AND prefix = 'recovered'",
                [testNoteId]
            );
            expect(recoveryBranch).toBeTruthy();
        });
    });

    it("should fix broken references when sync is not configured", async () => {
        await getContext().init(async () => {
            // Ensure sync is not configured
            setOption("syncServerHost", "");
            expect(syncOptions.isSyncSetup()).toBe(false);

            const { testNoteId, branchId } = simulatePartialSync();

            await consistency_checks.runOnDemandChecks(true);

            // The orphaned branch should have been deleted (no sync = local DB is authoritative)
            const sql = getSql();
            const branchAfter = sql.getValue(
                "SELECT branchId FROM branches WHERE branchId = ? AND isDeleted = 0",
                [branchId]
            );
            expect(branchAfter).toBeFalsy();

            // A recovery branch should have been created
            const recoveryBranch = sql.getValue(
                "SELECT branchId FROM branches WHERE noteId = ? AND parentNoteId = 'root' AND prefix = 'recovered'",
                [testNoteId]
            );
            expect(recoveryBranch).toBeTruthy();
        });
    });
});

describe("Notes without a usable branch", () => {

    it("should recover notes with no branch and notes whose branches are all deleted", async () => {
        await getContext().init(async () => {
            setOption("syncServerHost", "");

            const sql = getSql();
            const branchless = insertNote("BRANCHLESS");
            const onlyDeleted = insertNote("ONLY_DELETED");
            const stillLinked = insertNote("STILL_LINKED");

            // A deleted branch must not count as a parent, so this note needs recovering too.
            insertBranch("del_br", onlyDeleted, "root", 1);
            // A note keeping one live branch beside a deleted one is fine and must be left alone.
            insertBranch("dead_br", stillLinked, "root", 1);
            insertBranch("live_br", stillLinked, "root", 0);

            becca_loader.reload("branchless note test");

            await consistency_checks.runOnDemandChecks(true);

            const recoveredFor = (noteId: string) => sql.getValue(`
                SELECT branchId FROM branches
                WHERE noteId = ? AND parentNoteId = 'root' AND prefix = 'recovered' AND isDeleted = 0
            `, [noteId]);

            expect(recoveredFor(branchless)).toBeTruthy();
            expect(recoveredFor(onlyDeleted)).toBeTruthy();
            expect(recoveredFor(stillLinked)).toBeFalsy();

            // The pre-existing live branch is the one that kept stillLinked out of the result set.
            const liveBranch = sql.getValue(
                "SELECT branchId FROM branches WHERE branchId = 'live_br' AND isDeleted = 0"
            );
            expect(liveBranch).toBe("live_br");
        });
    });
});
