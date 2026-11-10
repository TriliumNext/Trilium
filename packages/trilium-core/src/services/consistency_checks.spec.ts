import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { getContext } from "./context.js";
import { getSql } from "./sql/index.js";
import consistency_checks from "./consistency_checks.js";
import eraseService from "./erase.js";
import { getLog } from "./log.js";
import syncOptions from "./sync_options.js";
import optionsService from "./options.js";
import noteService from "./notes.js";
import sqlInit from "./sql_init.js";
import ws from "./ws.js";
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

/** Plants a row straight into `table`, the way sync or a crash can leave one, bypassing becca. */
function insertRow(table: string, row: Record<string, string | number | null>) {
    const columns = Object.keys(row);
    getSql().execute(
        `INSERT INTO ${table} (${columns.join(", ")}) VALUES (${columns.map(() => "?").join(", ")})`,
        Object.values(row)
    );
}

function plantNote(noteId: string, overrides: Record<string, string | number | null> = {}) {
    insertRow("notes", {
        noteId, title: noteId, type: "text", mime: "text/html", isProtected: 0, isDeleted: 0,
        blobId: getSql().getValue<string>("SELECT blobId FROM notes WHERE noteId = 'root'"),
        dateCreated: "2026-01-01 00:00:00", dateModified: "2026-01-01 00:00:00",
        utcDateCreated: "2026-01-01 00:00:00Z", utcDateModified: "2026-01-01 00:00:00Z",
        ...overrides
    });
}

function plantBranch(branchId: string, noteId: string, parentNoteId: string, utcDateModified = "2026-01-01 00:00:00Z") {
    insertRow("branches", { branchId, noteId, parentNoteId, notePosition: 999, isExpanded: 0, isDeleted: 0, utcDateModified });
}

function plantAttribute(attributeId: string, noteId: string, type: string, name: string, value = "") {
    insertRow("attributes", { attributeId, noteId, type, name, value, position: 0, utcDateModified: "2026-01-01 00:00:00Z", isDeleted: 0, isInheritable: 0 });
}

function plantAttachment(attachmentId: string, ownerId: string, blobId: string) {
    insertRow("attachments", {
        attachmentId, ownerId, role: "file", mime: "text/plain", title: attachmentId, blobId,
        dateModified: "2026-01-01 00:00:00", utcDateModified: "2026-01-01 00:00:00Z", isDeleted: 0
    });
}

function plantEntityChange(entityName: string, entityId: string, isErased: number) {
    insertRow("entity_changes", {
        entityName, entityId, hash: "x", isErased, changeId: entityId, componentId: "spec",
        instanceId: "spec", isSynced: 1, utcDateChanged: "2026-01-01 00:00:00Z"
    });
}

describe("Consistency checks over a corrupted database", () => {
    const sql = () => getSql();
    const isLive = (table: string, key: string, id: string) =>
        !!sql().getValue(`SELECT 1 FROM ${table} WHERE ${key} = ? AND isDeleted = 0`, [ id ]);
    const exists = (table: string, key: string, id: string) =>
        !!sql().getValue(`SELECT 1 FROM ${table} WHERE ${key} = ?`, [ id ]);
    const parentsOf = (noteId: string) =>
        sql().getColumn<string>("SELECT parentNoteId FROM branches WHERE noteId = ? AND isDeleted = 0 ORDER BY parentNoteId", [ noteId ]);

    beforeAll(() => {
        getContext().init(() => {
            setOption("syncServerHost", "");
            setOption("syncIncomplete", "false");
            becca_loader.load();
        });
    });

    afterEach(() => vi.restoreAllMocks());

    it("reports every issue without autofix, then repairs them with it", async () => {
        const send = vi.spyOn(ws, "sendMessageToAllClients").mockImplementation(() => {});
        const info = vi.spyOn(getLog(), "info");
        let serviceNoteId = "";

        getContext().init(() => {
            const textBlobId = sql().getValue<string>("SELECT blobId FROM notes WHERE noteId = 'root'");

            // Broken references.
            plantBranch("CC_br_nonote", "CC_GHOST", "root");
            plantNote("CC_MP1");
            plantBranch("CC_br_mp1", "CC_MP1", "CC_NOPARENT");
            plantNote("CC_MP2");
            plantBranch("CC_br_mp2", "CC_MP2", "CC_NOPARENT");
            plantBranch("CC_br_mp2root", "CC_MP2", "root");
            plantAttribute("CC_attr_nonote", "CC_GHOST2", "label", "x");
            plantAttribute("CC_rel_missing", "root", "relation", "y", "CC_GHOST4");
            plantAttachment("CC_att_orphan", "CC_GHOST3", textBlobId);
            plantAttachment("CC_att_orphan_noblob", "CC_GHOST3", "CC_missing6");
            plantNote("CC_MP3", { isDeleted: 1 });
            plantBranch("CC_br_mp3", "CC_MP3", "CC_NOPARENT");
            plantNote("CC_NOBRANCH");

            // Entities that outlive their deleted note.
            plantNote("CC_DEL1", { isDeleted: 1 });
            plantBranch("CC_br_del1", "CC_DEL1", "root");
            plantNote("CC_CHILD");
            plantBranch("CC_br_child", "CC_CHILD", "CC_DEL1");
            plantAttachment("CC_att_del", "CC_DEL1", textBlobId);
            plantAttachment("CC_att_del_noblob", "CC_DEL1", "CC_missing7");
            plantAttribute("CC_attr_del", "CC_DEL1", "label", "z");
            plantAttribute("CC_rel_todel", "root", "relation", "w", "CC_DEL1");

            // Parent-child duplicates: one pair unknown to becca, one whose survivor becca knows.
            plantNote("CC_DUPA");
            plantBranch("CC_br_dupa1", "CC_DUPA", "root", "2026-01-01 00:00:00Z");
            plantBranch("CC_br_dupa2", "CC_DUPA", "root", "2026-01-02 00:00:00Z");
            serviceNoteId = noteService.createNewNote({ parentNoteId: "root", title: "CC dup", content: "", type: "text" }).note.noteId;
            plantBranch("CC_br_dupb2", serviceNoteId, "root", "2099-01-01 00:00:00Z");

            // Logic issues.
            plantNote("CC_BADTYPE", { type: "bogus" });
            plantBranch("CC_br_badtype", "CC_BADTYPE", "root");
            plantNote("CC_NOBLOB_PROT", { isProtected: 1, blobId: "CC_missing3" });
            plantBranch("CC_br_noblob_prot", "CC_NOBLOB_PROT", "root");
            insertRow("blobs", { blobId: "CC_nullblob2", content: null, dateModified: "2026-01-01 00:00:00", utcDateModified: "2026-01-01 00:00:00Z" });
            plantNote("CC_NULL_JSON", { type: "code", mime: "application/json", blobId: "CC_nullblob2" });
            plantBranch("CC_br_null_json", "CC_NULL_JSON", "root");
            insertRow("revisions", {
                revisionId: "CC_rev", noteId: "root", type: "text", mime: "text/html", title: "rev", blobId: "CC_missing4",
                utcDateLastEdited: "2026-01-01 00:00:00Z", utcDateCreated: "2026-01-01 00:00:00Z", utcDateModified: "2026-01-01 00:00:00Z",
                dateLastEdited: "2026-01-01 00:00:00", dateCreated: "2026-01-01 00:00:00"
            });
            plantAttachment("CC_att_noblob", "root", "CC_missing5");
            plantNote("CC_SEARCH", { type: "search", mime: "application/json" });
            plantBranch("CC_br_search", "CC_SEARCH", "root");
            plantNote("CC_SCHILD");
            plantBranch("CC_br_schild", "CC_SCHILD", "CC_SEARCH");
            plantAttribute("CC_rel_empty", "root", "relation", "empty", "");
            plantAttribute("CC_attr_badtype", "root", "weird", "odd");

            // Entity changes, names and sync position.
            plantEntityChange("notes", "CC_NOEXIST", 0);
            plantAttribute("CC_attr_erased", "root", "label", "erased");
            plantEntityChange("attributes", "CC_attr_erased", 1);
            insertRow("etapi_tokens", { etapiTokenId: "CC_token", name: "t", tokenHash: "h", utcDateCreated: "2026-01-01 00:00:00Z", utcDateModified: "" });
            insertRow("options", { name: "CC_option", value: "1", isSynced: 0, utcDateModified: "2026-01-01 00:00:00Z" });
            plantAttribute("CC_attr_badname", "root", "label", "bad name");
            sql().execute("UPDATE options SET value = '999999999' WHERE name = 'lastSyncedPush'");
        });

        await getContext().init(() => consistency_checks.runOnDemandChecks(false));
        expect(send).toHaveBeenCalledWith({ type: "consistency-checks-failed" });
        expect(isLive("branches", "branchId", "CC_br_nonote")).toBe(true);
        expect(sql().getValue("SELECT type FROM attributes WHERE attributeId = 'CC_attr_badtype'")).toBe("weird");
        expect(info.mock.calls.filter(([ message ]) => String(message).startsWith("Consistency error")).length).toBeGreaterThan(30);

        // First repair while becca is stale: fixers that need the cached entity skip it, and one fixer fails.
        vi.spyOn(eraseService, "eraseRevisions").mockImplementationOnce(() => {
            throw new Error("erase failed");
        });
        await getContext().init(() => consistency_checks.runOnDemandChecks(true));
        expect(info).toHaveBeenCalledWith(expect.stringContaining("Fixer failed with erase failed"));
        expect(info).toHaveBeenCalledWith("Consistency error: Unable to find original branch.");

        // Becca is reloaded by now, so the second pass reaches the rest.
        await getContext().init(() => consistency_checks.runOnDemandChecks(true));

        expect(isLive("branches", "branchId", "CC_br_nonote")).toBe(false);
        expect(isLive("branches", "branchId", "CC_br_mp3")).toBe(false);
        expect(parentsOf("CC_NOBRANCH")).toEqual([ "root" ]);
        for (const attachmentId of [ "CC_att_orphan_noblob", "CC_att_del_noblob" ]) {
            expect(exists("attachments", "attachmentId", attachmentId)).toBe(false);
        }
        expect(parentsOf("CC_MP1")).toEqual([ "root" ]);
        expect(parentsOf("CC_MP2")).toEqual([ "root" ]);
        expect(sql().getValue("SELECT prefix FROM branches WHERE branchId = 'CC_br_mp2root'")).toBeNull();
        for (const attributeId of [ "CC_attr_nonote", "CC_rel_missing", "CC_attr_del", "CC_rel_todel", "CC_rel_empty" ]) {
            expect(isLive("attributes", "attributeId", attributeId)).toBe(false);
        }
        expect(isLive("attachments", "attachmentId", "CC_att_orphan")).toBe(false);
        expect(isLive("attachments", "attachmentId", "CC_att_del")).toBe(false);
        expect(isLive("branches", "branchId", "CC_br_del1")).toBe(false);
        expect(parentsOf("CC_CHILD")).toEqual([ "root" ]);
        expect(parentsOf("CC_DUPA")).toEqual([ "root" ]);
        expect(sql().getValue("SELECT COUNT(*) FROM branches WHERE noteId = ? AND isDeleted = 0", [ serviceNoteId ])).toBe(1);
        expect(isLive("branches", "branchId", "CC_br_dupb2")).toBe(false);

        expect(sql().getValue("SELECT type FROM notes WHERE noteId = 'CC_BADTYPE'")).toBe("file");
        const contentOf = (noteId: string) => sql().getValue("SELECT content FROM blobs JOIN notes USING (blobId) WHERE noteId = ?", [ noteId ]);
        expect(sql().getValue("SELECT blobId FROM notes WHERE noteId = 'CC_NOBLOB_PROT'")).toBe("CC_missing3");
        expect(String(contentOf("CC_NULL_JSON"))).toBe("{}");

        await getContext().init(() => consistency_checks.runOnDemandChecks(true));
        expect(exists("revisions", "revisionId", "CC_rev")).toBe(false);
        expect(exists("attachments", "attachmentId", "CC_att_noblob")).toBe(false);
        expect(parentsOf("CC_SCHILD")).toEqual([ "root" ]);
        expect(sql().getValue("SELECT type FROM attributes WHERE attributeId = 'CC_attr_badtype'")).toBe("label");

        expect(exists("entity_changes", "entityId", "CC_NOEXIST")).toBe(false);
        expect(exists("attributes", "attributeId", "CC_attr_erased")).toBe(false);
        expect(sql().getValue("SELECT utcDateChanged FROM entity_changes WHERE entityName = 'etapi_tokens' AND entityId = 'CC_token'")).toBe("2026-01-01 00:00:00Z");
        expect(sql().getValue("SELECT isSynced FROM entity_changes WHERE entityName = 'options' AND entityId = 'CC_option'")).toBe(0);
        expect(sql().getValue("SELECT name FROM attributes WHERE attributeId = 'CC_attr_badname'")).toBe("bad_name");
        expect(Number(sql().getValue("SELECT value FROM options WHERE name = 'lastSyncedPush'")))
            .toBeLessThanOrEqual(sql().getValue<number>("SELECT MAX(id) FROM entity_changes"));

        // A protected note without its blob cannot be repaired, so it is removed to leave a consistent database.
        getContext().init(() => {
            sql().execute("DELETE FROM notes WHERE noteId = 'CC_NOBLOB_PROT'");
            sql().execute("DELETE FROM branches WHERE branchId = 'CC_br_noblob_prot'");
            sql().execute("DELETE FROM entity_changes WHERE entityId IN ('CC_NOBLOB_PROT', 'CC_br_noblob_prot')");
            becca_loader.reload("remove unrepairable note");
        });
    });

    it("reports a tree cycle without autofix and breaks it with autofix", async () => {
        getContext().init(() => {
            plantNote("CC_CYA");
            plantNote("CC_CYB");
            plantBranch("CC_br_cya_root", "CC_CYA", "root");
            plantBranch("CC_br_cya_cyb", "CC_CYA", "CC_CYB");
            plantBranch("CC_br_cyb_cya", "CC_CYB", "CC_CYA");
            consistency_checks.runEntityChangesChecks();
            becca_loader.reload("plant tree cycle");
        });
        const send = vi.spyOn(ws, "sendMessageToAllClients").mockImplementation(() => {});
        const info = vi.spyOn(getLog(), "info");

        await getContext().init(() => consistency_checks.runOnDemandChecks(false));
        expect(send).toHaveBeenCalledWith({ type: "consistency-checks-failed" });
        expect(info).toHaveBeenCalledWith(expect.stringContaining("Consistency error: Tree cycle detected"));

        await getContext().init(() => consistency_checks.runOnDemandChecks(true));
        expect(isLive("branches", "branchId", "CC_br_cya_cyb") && isLive("branches", "branchId", "CC_br_cyb_cya")).toBe(false);
        expect(isLive("branches", "branchId", "CC_br_cya_root")).toBe(true);

        // A large database skips the unindexed scan for notes with null content.
        vi.spyOn(sqlInit, "getDbSize").mockReturnValueOnce(1_000_000);
        await getContext().init(() => consistency_checks.runOnDemandChecks(true));
        expect(info).toHaveBeenCalledWith(expect.stringContaining("All consistency checks passed with no errors detected"));
    });

    it("gives up on a tree cycle whose branch is missing from becca instead of retrying forever", async () => {
        getContext().init(() => {
            plantNote("CC_CY2A");
            plantNote("CC_CY2B");
            plantBranch("CC_br_cy2a_root", "CC_CY2A", "root");
            plantBranch("CC_br_cy2a_cy2b", "CC_CY2A", "CC_CY2B");
            plantBranch("CC_br_cy2b_cy2a", "CC_CY2B", "CC_CY2A");
            consistency_checks.runEntityChangesChecks();
        });
        const send = vi.spyOn(ws, "sendMessageToAllClients").mockImplementation(() => {});
        const info = vi.spyOn(getLog(), "info");
        const getRows = sql().getRows.bind(sql());
        let cycleChecks = 0;
        vi.spyOn(sql(), "getRows").mockImplementation((query: string, params?: unknown[]) => {
            if (query.includes("SELECT noteId, parentNoteId FROM branches") && ++cycleChecks > 20) {
                throw new Error("tree cycle check did not terminate");
            }
            return getRows(query, params as never);
        });

        await getContext().init(() => consistency_checks.runOnDemandChecks(true));
        expect(cycleChecks).toBe(1);
        expect(info).toHaveBeenCalledWith(expect.stringContaining("Consistency error: Tree cycle detected at parent-child relationship: 'CC_CY2A' - 'CC_CY2B'"));
        expect(send).toHaveBeenCalledWith({ type: "consistency-checks-failed" });

        vi.mocked(sql().getRows).mockRestore();
        getContext().init(() => becca_loader.reload("cycle branches known to becca"));
        await getContext().init(() => consistency_checks.runOnDemandChecks(true));
        expect(isLive("branches", "branchId", "CC_br_cy2a_cy2b") && isLive("branches", "branchId", "CC_br_cy2b_cy2a")).toBe(false);
    });

    it("runs the entity change checks alone and on a schedule", async () => {
        getContext().init(() => insertRow("options", { name: "CC_option2", value: "1", isSynced: 1, utcDateModified: "2026-01-01 00:00:00Z" }));
        getContext().init(() => consistency_checks.runEntityChangesChecks());
        expect(exists("entity_changes", "entityId", "CC_option2")).toBe(true);

        vi.useFakeTimers();
        try {
            const getOptionBool = vi.spyOn(optionsService, "getOptionBool");
            consistency_checks.startConsistencyChecks();
            await sqlInit.dbReady;
            await vi.advanceTimersByTimeAsync(4 * 1000);
            expect(getOptionBool).toHaveBeenCalledWith("autoFixConsistencyIssues");

            getOptionBool.mockClear();
            await vi.advanceTimersByTimeAsync(60 * 60 * 1000);
            expect(getOptionBool).toHaveBeenCalledWith("autoFixConsistencyIssues");
        } finally {
            vi.clearAllTimers();
            vi.useRealTimers();
        }
    });
});
