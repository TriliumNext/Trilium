import type { EntityChange, EntityChangeRecord, EntityRow } from "@triliumnext/commons";
import { afterEach, describe, expect, it, vi } from "vitest";

import * as cls from "./context.js";
import events from "./events.js";
import notes from "./notes.js";
import { getSql } from "./sql/index.js";
import syncUpdateService from "./sync_update.js";
import { encodeBase64 } from "./utils/binary.js";
import dateUtils from "./utils/date.js";
import ws from "./ws.js";

const FUTURE = "2099-01-01 00:00:00.000Z";
const PAST = "2000-01-01 00:00:00.000Z";

let counter = 0;
function createNote(title = "sync-update"): string {
    counter++;
    return cls.init(() => notes.createNewNote({
        parentNoteId: "root",
        title: `${title}-${counter}`,
        content: "<p>x</p>",
        type: "text"
    }).note.noteId);
}

function noteRow(noteId: string): EntityRow {
    const row = getSql().getRowOrNull<EntityRow>("SELECT * FROM notes WHERE noteId = ?", [noteId]);
    if (!row) throw new Error(`no note row ${noteId}`);
    return row;
}

/** A note row with a few columns overridden, cast to the permissive EntityRow shape. */
function rowWith(noteId: string, extra: Record<string, unknown>): EntityRow {
    return { ...noteRow(noteId), ...extra } as unknown as EntityRow;
}

function localHash(entityName: string, entityId: string): string {
    return getSql().getValue<string>("SELECT hash FROM entity_changes WHERE entityName = ? AND entityId = ?", [entityName, entityId]) ?? "";
}

function buildEC(overrides: Partial<EntityChange>): EntityChange {
    return {
        entityName: "notes",
        entityId: "x",
        hash: "remote-hash",
        isErased: false,
        isSynced: true,
        utcDateChanged: FUTURE,
        ...overrides
    } as EntityChange;
}

function apply(records: EntityChangeRecord[], instanceId = "remoteInst") {
    return cls.init(() => syncUpdateService.updateEntities(records, instanceId));
}

describe("sync_update service (real DB)", () => {
    afterEach(() => vi.restoreAllMocks());

    it("returns immediately for an empty change set without signalling a pull", () => {
        const pullSpy = vi.spyOn(ws, "syncPullInProgress");
        apply([]);
        expect(pullSpy).not.toHaveBeenCalled();
    });

    it("skips changes whose changeId has already been applied", () => {
        const pullSpy = vi.spyOn(ws, "syncPullInProgress");
        const noteId = createNote();
        const changeId = localChangeId("notes", noteId);

        apply([{ entityChange: buildEC({ entityId: noteId, changeId }), entity: noteRow(noteId) }]);
        // Already-applied change -> no pull signalled.
        expect(pullSpy).not.toHaveBeenCalled();
    });

    it("applies a newer remote note, signals a pull and emits ENTITY_CHANGE_SYNCED", () => {
        const pullSpy = vi.spyOn(ws, "syncPullInProgress");
        const emitSpy = vi.spyOn(events, "emit");
        const noteId = createNote();
        const row = rowWith(noteId, { title: "updated-by-sync" });

        apply([{ entityChange: buildEC({ entityId: noteId, hash: "changed" }), entity: row }], "remoteInstA");

        expect(pullSpy).toHaveBeenCalledOnce();
        expect(getSql().getValue("SELECT title FROM notes WHERE noteId = ?", [noteId])).toBe("updated-by-sync");
        expect(getSql().getValue("SELECT instanceId FROM entity_changes WHERE entityName='notes' AND entityId=?", [noteId])).toBe("remoteInstA");
        expect(emitSpy).toHaveBeenCalledWith(events.ENTITY_CHANGE_SYNCED, expect.objectContaining({ entityName: "notes" }));
    });

    it("emits ENTITY_DELETE_SYNCED when the synced row is marked deleted", () => {
        const emitSpy = vi.spyOn(events, "emit");
        const noteId = createNote();
        const row = rowWith(noteId, { isDeleted: 1 });

        apply([{ entityChange: buildEC({ entityId: noteId, hash: "changed" }), entity: row }]);

        expect(emitSpy).toHaveBeenCalledWith(events.ENTITY_DELETE_SYNCED, expect.objectContaining({ entityName: "notes", entityId: noteId }));
    });

    it("erases a note when the remote change is erased and was not erased locally", () => {
        const noteId = createNote();
        apply([{ entityChange: buildEC({ entityId: noteId, isErased: true }), entity: undefined }]);
        expect(getSql().getRowOrNull("SELECT 1 FROM notes WHERE noteId = ?", [noteId])).toBeNull();
    });

    it("re-erases a note that was already erased locally", () => {
        const noteId = createNote();
        cls.init(() => getSql().execute("UPDATE entity_changes SET isErased = 1 WHERE entityName='notes' AND entityId=?", [noteId]));

        apply([{ entityChange: buildEC({ entityId: noteId, isErased: true }), entity: undefined }]);
        expect(getSql().getRowOrNull("SELECT 1 FROM notes WHERE noteId = ?", [noteId])).toBeNull();
    });

    it("requeues the change for other instances when the local copy is newer (conflict)", () => {
        const emitSpy = vi.spyOn(events, "emit");
        const noteId = createNote();
        const before = getSql().getValue("SELECT title FROM notes WHERE noteId = ?", [noteId]);

        apply([{ entityChange: buildEC({ entityId: noteId, hash: "different", utcDateChanged: PAST }), entity: rowWith(noteId, { title: "should-not-apply" }) }]);

        // Older remote change is rejected, local row untouched.
        expect(getSql().getValue("SELECT title FROM notes WHERE noteId = ?", [noteId])).toBe(before);
        expect(emitSpy).not.toHaveBeenCalledWith(events.ENTITY_CHANGE_SYNCED, expect.anything());
    });

    it("is a no-op when local and remote are identical but remote is older", () => {
        const noteId = createNote();
        const sameHash = localHash("notes", noteId);

        // hash equal + isErased equal (stored as integer 0) + remote older -> falls
        // through to the final `return false` without re-queuing or applying anything.
        apply([{ entityChange: buildEC({ entityId: noteId, hash: sameHash, isErased: 0 as unknown as boolean, utcDateChanged: PAST }), entity: noteRow(noteId) }]);
        expect(getSql().getRowOrNull("SELECT 1 FROM notes WHERE noteId = ?", [noteId])).not.toBeNull();
    });

    it("applies a note reordering by updating branch positions", () => {
        const parentNoteId = createNote("reorder-parent");
        const childBranchId = cls.init(() =>
            notes.createNewNote({ parentNoteId, title: "child", content: "<p/>", type: "text" }).branch.branchId
        );
        if (!childBranchId) throw new Error("child branch missing");

        apply([{ entityChange: buildEC({ entityName: "note_reordering", entityId: parentNoteId }), entity: { [childBranchId]: 77 } as unknown as EntityRow }]);

        expect(getSql().getValue("SELECT notePosition FROM branches WHERE branchId = ?", [childBranchId])).toBe(77);
    });

    it("decodes base64 blob content (including the empty-buffer special case)", () => {
        apply([
            { entityChange: buildEC({ entityName: "blobs", entityId: "su_blob_full" }), entity: blobRow("su_blob_full", encodeBase64("hello")) },
            { entityChange: buildEC({ entityName: "blobs", entityId: "su_blob_empty" }), entity: blobRow("su_blob_empty", "") }
        ]);

        const full = getSql().getValue<Buffer | Uint8Array>("SELECT content FROM blobs WHERE blobId = ?", ["su_blob_full"]);
        expect(Buffer.from(full ?? []).toString()).toBe("hello");
        const empty = getSql().getValue("SELECT content FROM blobs WHERE blobId = ?", ["su_blob_empty"]);
        expect(empty === "" || (empty && Buffer.from(empty as Uint8Array).length === 0)).toBeTruthy();
    });

    it("ignores option changes that have no entity row", () => {
        // entityName 'options' + no row -> early return, no throw.
        expect(() => apply([{ entityChange: buildEC({ entityName: "options", entityId: "su_missing_option" }), entity: undefined }])).not.toThrow();
    });

    it("logs but does not crash when asked to erase an unsupported entity type", () => {
        // 'options' is not in the eraseable entity list.
        expect(() => apply([{ entityChange: buildEC({ entityName: "options", entityId: "su_unknown_erase", isErased: true }), entity: { name: "su_unknown_erase", value: "v" } as unknown as EntityRow }])).not.toThrow();
    });

    it("throws on a normal change missing its entity row", () => {
        expect(() => apply([{ entityChange: buildEC({ entityId: "su_no_row_note" }), entity: undefined }])).toThrow(/Empty entity row/);
    });

    it("throws on a note_reordering change missing its body", () => {
        expect(() => apply([{ entityChange: buildEC({ entityName: "note_reordering", entityId: "su_no_reorder" }), entity: undefined }])).toThrow(/Empty note_reordering body/);
    });
});

function localChangeId(entityName: string, entityId: string): string {
    return getSql().getValue<string>("SELECT changeId FROM entity_changes WHERE entityName = ? AND entityId = ?", [entityName, entityId]) ?? "";
}

function blobRow(blobId: string, content: string): EntityRow {
    const now = dateUtils.utcNowDateTime();
    return { blobId, content, dateModified: now, utcDateModified: now } as unknown as EntityRow;
}
