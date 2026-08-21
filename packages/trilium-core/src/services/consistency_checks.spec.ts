import { describe, expect, it } from "vitest";
import { getContext } from "./context.js";
import { getSql } from "./sql/index.js";
import consistency_checks from "./consistency_checks.js";
import syncOptions from "./sync_options.js";
import optionsService from "./options.js";
import becca_loader from "../becca/becca_loader.js";

let testCounter = 0;

const DEFAULT_FLASHCARD_SCHEDULER_CONFIG = JSON.stringify({
    requestRetention: 0.9,
    maximumInterval: 36500,
    enableFuzz: true,
    enableShortTerm: true,
    learningSteps: ["1m", "10m"],
    relearningSteps: ["10m"],
    weights: null
});

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

function insertFlashcard(cardId: string, noteId: string, deckNoteId: string) {
    getSql().execute(`
        INSERT INTO flashcards (cardId, noteId, deckNoteId, ordinal, state, due, stability,
            difficulty, elapsedDays, scheduledDays, learningSteps, reps, lapses, lastReview,
            suspended, algorithm, algorithmVersion, schedulingRevision, utcDateCreated,
            utcDateModified, isDeleted, deleteId, schedulerConfig)
        VALUES (?, ?, ?, 0, 0, '2026-01-01 00:00:00.000Z', 0, 0, 0, 0, 0, 0, 0,
            NULL, 0, 'fsrs-6', 'ts-fsrs@5.4.1', 0, '2026-01-01 00:00:00.000Z',
            '2026-01-01 00:00:00.000Z', 0, NULL, ?)
    `, [cardId, noteId, deckNoteId, DEFAULT_FLASHCARD_SCHEDULER_CONFIG]);
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
            // Ensure sync is not configured. A stale syncIncomplete flag must not skip repairs.
            setOption("syncServerHost", "");
            setOption("syncIncomplete", "true");
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

describe("Flashcard consistency checks", () => {

    it("deletes cards with missing sources and moves cards with missing decks to root", async () => {
        await getContext().init(async () => {
            setOption("syncServerHost", "");

            testCounter++;
            const missingDeckSourceNoteId = insertNote(`FC_SRC_DECK_MISSING_${testCounter}`);
            const deletedDeckSourceNoteId = insertNote(`FC_SRC_DECK_DELETED_${testCounter}`);
            const deletedSourceNoteId = insertNote(`FC_SRC_DEL_${testCounter}`);
            const missingSourceCardId = `fc_missing_src_${testCounter}`;
            const deletedSourceCardId = `fc_deleted_src_${testCounter}`;
            const missingDeckCardId = `fc_missing_deck_${testCounter}`;
            const deletedDeckCardId = `fc_deleted_deck_${testCounter}`;
            const deletedDeckNoteId = insertNote(`FC_DECK_DEL_${testCounter}`);

            getSql().execute("UPDATE notes SET isDeleted = 1 WHERE noteId IN (?, ?)", [
                deletedSourceNoteId,
                deletedDeckNoteId
            ]);
            insertFlashcard(missingSourceCardId, `FC_SRC_MISSING_${testCounter}`, "root");
            insertFlashcard(deletedSourceCardId, deletedSourceNoteId, "root");
            insertFlashcard(missingDeckCardId, missingDeckSourceNoteId, `FC_DECK_MISSING_${testCounter}`);
            insertFlashcard(deletedDeckCardId, deletedDeckSourceNoteId, deletedDeckNoteId);

            becca_loader.reload("flashcard consistency test");

            await consistency_checks.runOnDemandChecks(true);

            const sql = getSql();
            const isDeleted = (cardId: string) => sql.getValue<number>(
                "SELECT isDeleted FROM flashcards WHERE cardId = ?",
                [cardId]
            );
            const deckNoteId = (cardId: string) => sql.getValue<string>(
                "SELECT deckNoteId FROM flashcards WHERE cardId = ?",
                [cardId]
            );
            const changeCount = (cardId: string) => sql.getValue<number>(`
                SELECT COUNT(1) FROM entity_changes
                WHERE entityName = 'flashcards' AND entityId = ?
            `, [cardId]) ?? 0;

            expect(isDeleted(missingSourceCardId)).toBe(1);
            expect(isDeleted(deletedSourceCardId)).toBe(1);
            expect(isDeleted(missingDeckCardId)).toBe(0);
            expect(isDeleted(deletedDeckCardId)).toBe(0);
            expect(deckNoteId(missingDeckCardId)).toBe("root");
            expect(deckNoteId(deletedDeckCardId)).toBe("root");
            expect(changeCount(missingSourceCardId)).toBeGreaterThan(0);
            expect(changeCount(missingDeckCardId)).toBeGreaterThan(0);
        });
    });
});
