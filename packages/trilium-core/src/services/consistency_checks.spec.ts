import { describe, expect, it } from "vitest";
import { getContext } from "./context.js";
import { getSql } from "./sql/index.js";
import consistency_checks from "./consistency_checks.js";
import syncOptions from "./sync_options.js";
import optionsService from "./options.js";
import becca_loader from "../becca/becca_loader.js";

/**
 * Wraps a callback in CLS context and waits for it to complete.
 */
function withContext(fn: () => void | Promise<void>): Promise<void> {
    return new Promise<void>((resolve, reject) => {
        getContext().init(async () => {
            try {
                await fn();
                resolve();
            } catch (e) {
                reject(e);
            }
        });
    });
}

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
    const sql = getSql();
    testCounter++;
    const missingParentNoteId = `MISSING_PAR_${testCounter}`;
    const testNoteId = `PARTIAL_NOTE${testCounter}`;
    const branchId = `orphan_br_${testCounter}`;

    sql.execute(`
        INSERT INTO notes (noteId, title, type, mime, isProtected, isDeleted, deleteId, blobId, dateCreated, dateModified, utcDateCreated, utcDateModified)
        VALUES (?, 'Test Note', 'text', 'text/html', 0, 0, NULL,
            (SELECT blobId FROM notes WHERE noteId = 'root'),
            '2026-01-01 00:00:00', '2026-01-01 00:00:00', '2026-01-01 00:00:00Z', '2026-01-01 00:00:00Z')
    `, [testNoteId]);

    sql.execute(`
        INSERT INTO branches (branchId, noteId, parentNoteId, notePosition, prefix, isExpanded, isDeleted, utcDateModified)
        VALUES (?, ?, ?, 999, NULL, 0, 0, '2026-01-01 00:00:00Z')
    `, [branchId, testNoteId, missingParentNoteId]);

    // Reload Becca so it sees the raw-SQL-inserted entities,
    // just like what happens after sync_update applies pulled changes.
    becca_loader.reload("simulate partial sync");

    return { missingParentNoteId, testNoteId, branchId };
}

function setOption(name: string, value: string) {
    (optionsService.setOption as any)(name, value);
}

describe("Consistency checks during partial sync", () => {

    it("should NOT fix broken references when sync is incomplete", async () => {
        await withContext(async () => {
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
        await withContext(async () => {
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
        await withContext(async () => {
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
