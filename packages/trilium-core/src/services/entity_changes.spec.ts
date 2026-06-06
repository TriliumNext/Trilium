import type { EntityChange } from "@triliumnext/commons";

import { afterEach, describe, expect, it, vi } from "vitest";

import dateUtils from "./utils/date.js";
import entityChangesService from "./entity_changes.js";
import events from "./events.js";
import getInstanceId from "./instance_id.js";
import { getContext } from "./context.js";
import { getSql } from "./sql/index.js";

let counter = 0;

/**
 * Builds a minimal, syntactically valid entity change for an arbitrary
 * (non-real) entity. Each call uses a unique entityId so the unique index on
 * (entityName, entityId) does not collide between the `it()`s sharing the same
 * in-memory fixture DB.
 */
function buildEntityChange(overrides: Partial<EntityChange> = {}): EntityChange {
    counter++;
    return {
        entityName: "notes",
        entityId: `ec-spec-${counter}`,
        hash: "abcd",
        isErased: false,
        utcDateChanged: dateUtils.utcNowDateTime(),
        isSynced: true,
        ...overrides
    } as EntityChange;
}

function readRow(entityName: string, entityId: string) {
    return getSql().getRowOrNull<EntityChange>(
        "SELECT * FROM entity_changes WHERE entityName = ? AND entityId = ?",
        [entityName, entityId]
    );
}

describe("entity_changes service (real DB)", () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    describe("putEntityChange", () => {
        it("inserts the row, generates a changeId, applies defaults and normalizes booleans", () => {
            const ec = buildEntityChange({ isSynced: true, isErased: false });
            // No changeId provided -> a random one must be generated.
            delete ec.changeId;

            getContext().init(() => entityChangesService.putEntityChange(ec));

            const row = readRow(ec.entityName, ec.entityId);
            expect(row).not.toBeNull();
            expect(typeof row!.changeId).toBe("string");
            expect(row!.changeId!.length).toBeGreaterThan(0);
            // Boolean flags are persisted as 0/1 integers.
            expect(row!.isSynced).toBe(1);
            expect(row!.isErased).toBe(0);
            // Defaults are filled in when not supplied.
            expect(row!.instanceId).toBe(getInstanceId());
            expect(row!.componentId).toBeTruthy();
            expect(row!.id).toBeGreaterThan(0);
        });

        it("registers the inserted change id in the CLS context and bumps maxEntityChangeId", () => {
            const ec = buildEntityChange();

            const idsAfter = getContext().init(() => {
                entityChangesService.putEntityChange(ec);
                return getContext().get<number[]>("entityChangeIds") ?? [];
            });

            const row = readRow(ec.entityName, ec.entityId)!;
            expect(idsAfter).toContain(row.id);
            expect(entityChangesService.getMaxEntityChangeId()).toBeGreaterThanOrEqual(row.id!);
        });

        it("falls back to the 'NA' componentId when none is available in the context", () => {
            const ec = buildEntityChange();

            getContext().init(() => entityChangesService.putEntityChange(ec));

            const row = readRow(ec.entityName, ec.entityId)!;
            expect(row.componentId).toBe("NA");
        });

        it("preserves an explicitly provided changeId, componentId and isErased flag", () => {
            const ec = buildEntityChange({
                changeId: "fixedChangeId",
                componentId: "myComponent",
                isErased: true,
                isSynced: false
            });

            getContext().init(() => entityChangesService.putEntityChange(ec));

            const row = readRow(ec.entityName, ec.entityId)!;
            expect(row.changeId).toBe("fixedChangeId");
            expect(row.componentId).toBe("myComponent");
            expect(row.isErased).toBe(1);
            expect(row.isSynced).toBe(0);
        });
    });

    describe("putEntityChangeWithInstanceId", () => {
        it("persists the supplied instance id rather than the local one", () => {
            const ec = buildEntityChange();

            getContext().init(() => entityChangesService.putEntityChangeWithInstanceId(ec, "remoteInst1"));

            const row = readRow(ec.entityName, ec.entityId)!;
            expect(row.instanceId).toBe("remoteInst1");
        });
    });

    describe("putEntityChangeWithForcedChange", () => {
        it("ignores the incoming changeId and generates a fresh one", () => {
            const ec = buildEntityChange({ changeId: "originalChange" });

            getContext().init(() => entityChangesService.putEntityChangeWithForcedChange(ec));

            const row = readRow(ec.entityName, ec.entityId)!;
            expect(typeof row.changeId).toBe("string");
            expect(row.changeId).not.toBe("originalChange");
        });
    });

    describe("putEntityChangeForOtherInstances", () => {
        it("clears the changeId/instanceId so they default to local values", () => {
            const ec = buildEntityChange({
                changeId: "shouldBeDropped",
                instanceId: "shouldBeDropped"
            });

            getContext().init(() => entityChangesService.putEntityChangeForOtherInstances(ec));

            const row = readRow(ec.entityName, ec.entityId)!;
            // Both fields were reset to null and then defaulted at insert time.
            expect(row.changeId).not.toBe("shouldBeDropped");
            expect(row.instanceId).toBe(getInstanceId());
        });
    });

    describe("putNoteReorderingEntityChange", () => {
        it("writes a synced note_reordering change and emits ENTITY_CHANGED with the branch map", () => {
            const emitSpy = vi.spyOn(events, "emit");

            getContext().init(() => entityChangesService.putNoteReorderingEntityChange("root", "comp-reorder"));

            const row = readRow("note_reordering", "root")!;
            expect(row).not.toBeNull();
            expect(row.hash).toBe("N/A");
            expect(row.isSynced).toBe(1);
            expect(row.isErased).toBe(0);
            expect(row.componentId).toBe("comp-reorder");

            const reorderEmit = emitSpy.mock.calls.find(
                ([eventType, data]) => eventType === events.ENTITY_CHANGED && data?.entityName === "note_reordering"
            );
            expect(reorderEmit).toBeDefined();
            // The emitted entity is the branchId -> notePosition map of root's children.
            expect(reorderEmit![1].entity).toBeTypeOf("object");
        });
    });

    describe("getMaxEntityChangeId / recalculateMaxEntityChangeId", () => {
        it("recalculates the cached max id from the actual table contents", () => {
            entityChangesService.recalculateMaxEntityChangeId();
            const dbMax = getSql().getValue<number>("SELECT COALESCE(MAX(id), 0) FROM entity_changes");

            expect(entityChangesService.getMaxEntityChangeId()).toBe(dbMax);

            // Inserting a new change advances the in-memory counter past the
            // previous max, and recalculation converges back to the DB value.
            const ec = buildEntityChange();
            getContext().init(() => entityChangesService.putEntityChange(ec));
            expect(entityChangesService.getMaxEntityChangeId()).toBeGreaterThan(dbMax);

            entityChangesService.recalculateMaxEntityChangeId();
            expect(entityChangesService.getMaxEntityChangeId()).toBe(
                getSql().getValue<number>("SELECT COALESCE(MAX(id), 0) FROM entity_changes")
            );
        });
    });

    describe("addEntityChangesForSector", () => {
        it("re-issues forced changes for every existing change in the sector", () => {
            const sql = getSql();

            // Pick an existing options sector and capture the prior changeIds so
            // we can verify they get rewritten (forced) rather than left as-is.
            const sector = sql.getValue<string>(
                "SELECT SUBSTR(entityId, 1, 1) FROM entity_changes WHERE entityName = 'options' LIMIT 1"
            );
            expect(sector).toBeTruthy();

            const before = sql.getColumn<string>(
                "SELECT changeId FROM entity_changes WHERE entityName = 'options' AND SUBSTR(entityId, 1, 1) = ?",
                [sector]
            );
            expect(before.length).toBeGreaterThan(0);

            getContext().init(() => entityChangesService.addEntityChangesForSector("options", sector));

            const after = sql.getColumn<string>(
                "SELECT changeId FROM entity_changes WHERE entityName = 'options' AND SUBSTR(entityId, 1, 1) = ?",
                [sector]
            );
            // Same number of rows, but every changeId was regenerated.
            expect(after.length).toBe(before.length);
            for (const id of after) {
                expect(before).not.toContain(id);
            }
        });
    });

    describe("fillAllEntityChanges", () => {
        it("rebuilds non-erased entity changes for the core tables without dropping erased ones", () => {
            const sql = getSql();

            // Seed an erased change that must survive the rebuild.
            const erased = buildEntityChange({ isErased: true });
            getContext().init(() => entityChangesService.putEntityChange(erased));

            const erasedCountBefore = sql.getValue<number>(
                "SELECT COUNT(1) FROM entity_changes WHERE isErased = 1"
            );

            getContext().init(() => entityChangesService.fillAllEntityChanges());

            // Every note in becca must now have a corresponding (non-erased) change.
            const notesWithoutChange = sql.getValue<number>(`
                SELECT COUNT(1) FROM notes
                WHERE noteId NOT IN (SELECT entityId FROM entity_changes WHERE entityName = 'notes')`);
            expect(notesWithoutChange).toBe(0);

            // Erased changes are preserved (only non-erased rows are wiped/rebuilt).
            const erasedCountAfter = sql.getValue<number>(
                "SELECT COUNT(1) FROM entity_changes WHERE isErased = 1"
            );
            expect(erasedCountAfter).toBeGreaterThanOrEqual(erasedCountBefore);

            // Blobs are always synced.
            const unsyncedBlobs = sql.getValue<number>(
                "SELECT COUNT(1) FROM entity_changes WHERE entityName = 'blobs' AND isSynced = 0"
            );
            expect(unsyncedBlobs).toBe(0);
        });
    });
});
