import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { getContext } from "./context.js";
import { getSql } from "./sql/index.js";
import consistency_checks from "./consistency_checks.js";
import syncOptions from "./sync_options.js";
import optionsService from "./options.js";
import noteService from "./notes.js";
import { registerVirtualNoteProvider, unregisterVirtualNoteProvider } from "./virtual_notes.js";
import becca from "../becca/becca.js";
import becca_loader from "../becca/becca_loader.js";
import BAttribute from "../becca/entities/battribute.js";

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

describe("Consistency checks and virtual notes", () => {
    beforeAll(() => {
        registerVirtualNoteProvider({
            namespace: "_vcc",
            parentNoteId: "_hidden",
            getSubtree: () => [{ id: "_vccPage", title: "Virtual page", type: "text" }]
        });
        getContext().init(() => becca_loader.load());
    });

    afterAll(() => {
        unregisterVirtualNoteProvider("_vcc");
        getContext().init(() => becca_loader.load());
    });

    function createNote(title: string) {
        return noteService.createNewNote({ parentNoteId: "root", title, content: "", type: "text" }).note.noteId;
    }

    /** Persisted relation to `targetNoteId`, as `scanForLinks` creates for a reference link. */
    function linkTo(sourceNoteId: string, targetNoteId: string) {
        return new BAttribute({
            noteId: sourceNoteId,
            type: "relation",
            name: "internalLink",
            value: targetNoteId
        }).save().attributeId;
    }

    function isRelationAlive(attributeId: string) {
        return !!getSql().getValue("SELECT attributeId FROM attributes WHERE attributeId = ? AND isDeleted = 0", [attributeId]);
    }

    it("keeps relations targeting virtual notes, while still deleting genuinely broken ones", async () => {
        await getContext().init(async () => {
            setOption("syncServerHost", "");
            setOption("syncIncomplete", "false");

            // A virtual note exists in becca but deliberately never in the `notes` table, so a
            // relation pointing at one looks broken to every SQL-level existence check.
            expect(becca.getNote("_vccPage")?.isVirtual).toBe(true);
            expect(getSql().getValue("SELECT noteId FROM notes WHERE noteId = '_vccPage'")).toBeFalsy();

            const sourceNoteId = createNote("note linking into the virtual subtree");
            const virtualLinkId = linkTo(sourceNoteId, "_vccPage");

            // A relation to a note that is simply gone — `BAttribute.validate()` refuses to create
            // one, so it has to be planted the way sync does: straight into the table.
            const brokenLinkId = "brokenLink___";
            getSql().execute(
                `INSERT INTO attributes (attributeId, noteId, type, name, value, position, utcDateModified, isDeleted, isInheritable)
                 VALUES (?, ?, 'relation', 'internalLink', 'MISSING_TARGET', 10, '2026-01-01 00:00:00Z', 0, 0)`,
                [brokenLinkId, sourceNoteId]
            );
            becca_loader.reload("plant broken relation");

            await consistency_checks.runOnDemandChecks(true);

            expect(isRelationAlive(virtualLinkId)).toBe(true);
            expect(isRelationAlive(brokenLinkId)).toBe(false);

            // ...and the surviving relation keeps its becca backlink, so backlinks and link maps still resolve
            expect(becca.getAttribute(virtualLinkId)).toBeTruthy();
            expect(becca.getNoteOrThrow("_vccPage").targetRelations.some((rel) => rel.attributeId === virtualLinkId)).toBe(true);
        });
    });
});
