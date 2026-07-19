import type { EntityChange } from "@triliumnext/commons";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import consistencyChecksService from "../../services/consistency_checks";
import entityChangesService from "../../services/entity_changes";
import optionService from "../../services/options";
import { getSql } from "../../services/sql/index";
import sqlInit from "../../services/sql_init";
import syncService from "../../services/sync";
import syncOptions from "../../services/sync_options";
import syncUpdateService from "../../services/sync_update";
import ws from "../../services/ws";
import { CoreApiTester } from "../../test/api_tester";

/**
 * Drives the shared core sync routes through {@link CoreApiTester} (no Express),
 * so this spec runs under both the node (better-sqlite3) and standalone (WASM)
 * suites. Network-doing handlers (login/sync) are stubbed via `vi.spyOn`.
 */
let api: CoreApiTester;

describe("Sync API (core)", () => {
    beforeAll(() => {
        api = CoreApiTester.build();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    describe("testSync (POST /api/sync/test)", () => {
        it("reports not-configured when sync is not set up", async () => {
            // On the fixture, isSyncSetup() is false → the early not-configured branch.
            const res = await api.post<{ success: boolean; message: string }>("/api/sync/test");
            expect(res.status).toBe(200);
            expect(res.body.success).toBe(false);
            expect(typeof res.body.message).toBe("string");
        });

        it("logs in and kicks off sync when configured", async () => {
            vi.spyOn(syncOptions, "isSyncSetup").mockReturnValue(true);
            const login = vi.spyOn(syncService, "login").mockResolvedValue({} as never);
            const sync = vi.spyOn(syncService, "sync").mockResolvedValue(undefined as never);

            const res = await api.post<{ success: boolean }>("/api/sync/test");
            expect(res.status).toBe(200);
            expect(res.body.success).toBe(true);
            expect(login).toHaveBeenCalled();
            expect(sync).toHaveBeenCalled();
        });

        it("returns the error message when login fails", async () => {
            vi.spyOn(syncOptions, "isSyncSetup").mockReturnValue(true);
            vi.spyOn(syncService, "login").mockRejectedValue(new Error("boom"));

            const res = await api.post<{ success: boolean; message: string }>("/api/sync/test");
            expect(res.status).toBe(200);
            expect(res.body.success).toBe(false);
            expect(res.body.message).toContain("boom");
        });
    });

    describe("getStats (GET /api/sync/stats)", () => {
        it("returns sync stats in the normal case", async () => {
            vi.spyOn(syncService, "getOutstandingPullCount").mockReturnValue(3);
            vi.spyOn(syncService, "getTotalPullCount").mockReturnValue(7);

            const res = await api.get<{ initialized: boolean; outstandingPullCount: number; totalPullCount: number }>("/api/sync/stats");
            expect(res.status).toBe(200);
            expect(res.body.outstandingPullCount).toBe(3);
            expect(res.body.totalPullCount).toBe(7);
            expect(typeof res.body.initialized).toBe("boolean");
        });

        it("returns an empty object when the schema does not exist", async () => {
            vi.spyOn(sqlInit, "schemaExists").mockReturnValue(false);

            const res = await api.get<Record<string, never>>("/api/sync/stats");
            expect(res.status).toBe(200);
            expect(res.body).toEqual({});
        });

        it("exposes the last sync error while the DB is not yet initialized (setup wizard)", async () => {
            vi.spyOn(syncService, "getLastSyncError").mockReturnValue("401 Logged in session not found");
            const prevInitialized = optionService.getOption("initialized");
            getSql().execute("UPDATE options SET value = 'false' WHERE name = 'initialized'");
            try {
                const res = await api.get<{ initialized: boolean; lastSyncError: string | null }>("/api/sync/stats");
                expect(res.status).toBe(200);
                expect(res.body.initialized).toBe(false);
                expect(res.body.lastSyncError).toBe("401 Logged in session not found");
            } finally {
                getSql().execute("UPDATE options SET value = ? WHERE name = 'initialized'", [prevInitialized]);
            }
        });

        it("does not expose sync errors once initialized — the stats endpoint is unauthenticated", async () => {
            vi.spyOn(syncService, "getLastSyncError").mockReturnValue("must stay private");

            const res = await api.get<{ initialized: boolean; lastSyncError?: string }>("/api/sync/stats");
            expect(res.status).toBe(200);
            expect(res.body.initialized).toBe(true);
            expect(res.body.lastSyncError).toBeUndefined();
        });
    });

    it("checkSync returns entity hashes and the max entity change id", async () => {
        const res = await api.get<{ entityHashes: unknown; maxEntityChangeId: number }>("/api/sync/check");
        expect(res.status).toBe(200);
        expect(res.body).toHaveProperty("entityHashes");
        expect(typeof res.body.maxEntityChangeId).toBe("number");
    });

    it("syncNow signals progress and returns the sync result", async () => {
        const progress = vi.spyOn(ws, "syncPullInProgress").mockImplementation(() => {});
        vi.spyOn(syncService, "sync").mockResolvedValue("sync-result" as never);

        const res = await api.post<string>("/api/sync/now");
        expect(res.status).toBe(200);
        expect(progress).toHaveBeenCalled();
        expect(res.body).toBe("sync-result");
    });

    it("fillEntityChanges triggers fillAllEntityChanges", async () => {
        const fill = vi.spyOn(entityChangesService, "fillAllEntityChanges").mockImplementation(() => {});

        const res = await api.post("/api/sync/fill-entity-changes");
        expect(res.status).toBe(204);
        expect(fill).toHaveBeenCalled();
    });

    it("forceFullSync resets the sync pointers and triggers a sync", async () => {
        const setOption = vi.spyOn(optionService, "setOption").mockImplementation(() => {});
        const sync = vi.spyOn(syncService, "sync").mockResolvedValue(undefined as never);

        const res = await api.post("/api/sync/force-full-sync");
        expect(res.status).toBe(204);
        expect(setOption).toHaveBeenCalledWith("lastSyncedPull", 0);
        expect(setOption).toHaveBeenCalledWith("lastSyncedPush", 0);
        expect(sync).toHaveBeenCalled();
    });

    describe("getChanged (GET /api/sync/changed)", () => {
        it("rejects a missing/invalid lastEntityChangeId", async () => {
            const res = await api.get<{ message: string }>("/api/sync/changed");
            expect(res.status).toBe(400);
        });

        it("returns entity change records for the normal branch", async () => {
            const res = await api.get<{ entityChanges: unknown[]; lastEntityChangeId: number; outstandingPullCount: number }>(
                "/api/sync/changed",
                { query: { instanceId: "someOtherInstance", lastEntityChangeId: "0" } }
            );
            expect(res.status).toBe(200);
            expect(Array.isArray(res.body.entityChanges)).toBe(true);
            expect(res.body.entityChanges.length).toBeGreaterThan(0);
            expect(typeof res.body.outstandingPullCount).toBe("number");
        });

        it("advances past batches that are fully filtered out by instanceId", async () => {
            // Seed a contiguous block of synced rows beyond the existing max id, all
            // belonging to a single instanceId. Querying with that instanceId and a
            // lastEntityChangeId just below the block makes the first batch consist
            // ENTIRELY of filtered-out rows → exercises the do/while advance branch.
            const sql = getSql();
            const maxId = sql.getValue<number>("SELECT COALESCE(MAX(id), 0) FROM entity_changes");
            const baseId = maxId + 1;
            for (let i = 0; i < 3; i++) {
                sql.execute(
                    `INSERT INTO entity_changes (id, entityName, entityId, hash, isErased, changeId, componentId, instanceId, isSynced, utcDateChanged)
                     VALUES (?, 'options', ?, 'h', 0, ?, 'cmp', 'LOOPTEST', 1, '2020-01-01T00:00:00.000Z')`,
                    [baseId + i, `loop_${i}`, `chg_${i}`]
                );
            }

            const res = await api.get<{ entityChanges: unknown[]; lastEntityChangeId: number; outstandingPullCount: number }>(
                "/api/sync/changed",
                { query: { instanceId: "LOOPTEST", lastEntityChangeId: String(maxId) } }
            );
            expect(res.status).toBe(200);
            // Every row in range belongs to LOOPTEST, so all are filtered out.
            expect(res.body.entityChanges).toEqual([]);
            expect(res.body.lastEntityChangeId).toBe(baseId + 2);
            expect(res.body.outstandingPullCount).toBe(0);
        });

        it("counts outstanding changes by id only (index-only), independent of instanceId", async () => {
            // The outstanding count is an index-only range count on (isSynced, id) and deliberately does
            // NOT filter by instanceId. So a change owned by the querying client, sitting beyond the
            // returned cursor, is now included in the estimate (it is skipped when actually returned, so
            // the count converges to 0 on the next pull).
            const sql = getSql();
            const maxId = sql.getValue<number>("SELECT COALESCE(MAX(id), 0) FROM entity_changes");

            // a real option so the "other instance" change referencing it is returnable
            sql.execute("INSERT INTO options (name, value, isSynced, utcDateModified) VALUES ('otst_opt', 'v', 1, '2020-01-01T00:00:00.000Z')");
            // change A (another instance) → returned, advancing the cursor to maxId + 1
            sql.execute(
                `INSERT INTO entity_changes (id, entityName, entityId, hash, isErased, changeId, componentId, instanceId, isSynced, utcDateChanged)
                 VALUES (?, 'options', 'otst_opt', 'h', 0, 'otst_A', 'cmp', 'OTHER', 1, '2020-01-01T00:00:00.000Z')`,
                [maxId + 1]
            );
            // change B: the querying client's OWN change, id beyond A → excluded from the returned records
            // but counted by the index-only outstanding count
            sql.execute(
                `INSERT INTO entity_changes (id, entityName, entityId, hash, isErased, changeId, componentId, instanceId, isSynced, utcDateChanged)
                 VALUES (?, 'options', 'otst_optB', 'h', 0, 'otst_B', 'cmp', 'CLIENTX', 1, '2020-01-01T00:00:00.000Z')`,
                [maxId + 2]
            );

            const res = await api.get<{ entityChanges: unknown[]; lastEntityChangeId: number; outstandingPullCount: number }>(
                "/api/sync/changed",
                { query: { instanceId: "CLIENTX", lastEntityChangeId: String(maxId) } }
            );

            expect(res.status).toBe(200);
            expect(res.body.lastEntityChangeId).toBe(maxId + 1); // A returned, cursor advanced past it
            expect(res.body.outstandingPullCount).toBe(1); // B counted by id, despite being the client's own

            // keep the shared DB clean for other specs
            sql.execute("DELETE FROM entity_changes WHERE id IN (?, ?)", [maxId + 1, maxId + 2]);
            sql.execute("DELETE FROM options WHERE name = 'otst_opt'");
        });

        it("fills the response across multiple 1000-row fetches instead of stopping at the row limit", async () => {
            // 1100 metadata-only rows estimate to ~0.33 MB — far below the 8 MB byte cap — so a
            // single pull must now return all of them in one response (two LIMIT-1000 fetches)
            // rather than capping at 1000 rows per round-trip.
            const sql = getSql();
            const maxId = sql.getValue<number>("SELECT COALESCE(MAX(id), 0) FROM entity_changes");
            const COUNT = 1100;

            sql.transactional(() => {
                for (let i = 0; i < COUNT; i++) {
                    sql.execute("INSERT INTO options (name, value, isSynced, utcDateModified) VALUES (?, 'v', 1, '2020-01-01T00:00:00.000Z')", [`rowcap_opt_${i}`]);
                    sql.execute(
                        `INSERT INTO entity_changes (id, entityName, entityId, hash, isErased, changeId, componentId, instanceId, isSynced, utcDateChanged)
                         VALUES (?, 'options', ?, 'h', 0, ?, 'cmp', 'OTHER', 1, '2020-01-01T00:00:00.000Z')`,
                        [maxId + 1 + i, `rowcap_opt_${i}`, `rowcap_chg_${i}`]
                    );
                }
            });

            const res = await api.get<{ entityChanges: unknown[]; lastEntityChangeId: number; outstandingPullCount: number }>(
                "/api/sync/changed",
                { query: { instanceId: "CLIENTX", lastEntityChangeId: String(maxId) } }
            );

            expect(res.status).toBe(200);
            expect(res.body.entityChanges.length).toBe(COUNT); // > 1000: the row limit no longer binds
            expect(res.body.lastEntityChangeId).toBe(maxId + COUNT);
            expect(res.body.outstandingPullCount).toBe(0);

            sql.transactional(() => {
                sql.execute("DELETE FROM entity_changes WHERE id BETWEEN ? AND ?", [maxId + 1, maxId + COUNT]);
                sql.execute("DELETE FROM options WHERE name LIKE 'rowcap_opt_%'");
            });
        });

        it("stubs blob content larger than maxBlobContentSize while leaving the hash and other rows intact", () => {
            const sql = getSql();
            const maxId = sql.getValue<number>("SELECT COALESCE(MAX(id), 0) FROM entity_changes");

            // A large blob (100 bytes) plus a small option change, both from another instance.
            const bigContent = "x".repeat(100);
            sql.execute(
                "INSERT INTO blobs (blobId, content, dateModified, utcDateModified) VALUES ('bigblob1', ?, '2020-01-01T00:00:00.000Z', '2020-01-01T00:00:00.000Z')",
                [bigContent]
            );
            sql.execute(
                `INSERT INTO entity_changes (id, entityName, entityId, hash, isErased, changeId, componentId, instanceId, isSynced, utcDateChanged)
                 VALUES (?, 'blobs', 'bigblob1', 'blobhash', 0, 'blobchg', 'cmp', 'OTHER', 1, '2020-01-01T00:00:00.000Z')`,
                [maxId + 1]
            );
            const blobChange = sql.getRow<EntityChange>("SELECT * FROM entity_changes WHERE id = ?", [maxId + 1]);

            // Above the limit → content withheld (empty string), but the entity_change (and its hash)
            // is untouched, so the client's content-hash checks still pass.
            const [stubbed] = syncService.getEntityChangeRecords([blobChange], undefined, 50);
            expect(stubbed.entity?.content).toBe("");
            expect(stubbed.entityChange.hash).toBe("blobhash");

            // Below the limit → full (base64-encoded) content is served.
            const [full] = syncService.getEntityChangeRecords([blobChange], undefined, 200);
            expect(typeof full.entity?.content).toBe("string");
            expect((full.entity?.content as string).length).toBeGreaterThan(0);
            expect(full.entity?.content).not.toBe("");

            // No limit at all → also full content (default push/desktop behavior).
            const [unlimited] = syncService.getEntityChangeRecords([blobChange]);
            expect(unlimited.entity?.content).not.toBe("");

            sql.execute("DELETE FROM entity_changes WHERE id = ?", [maxId + 1]);
            sql.execute("DELETE FROM blobs WHERE blobId = 'bigblob1'");
        });

        it("does not stub a blob at or below maxBlobContentSize", () => {
            const sql = getSql();
            const maxId = sql.getValue<number>("SELECT COALESCE(MAX(id), 0) FROM entity_changes");

            const smallContent = "y".repeat(10);
            sql.execute(
                "INSERT INTO blobs (blobId, content, dateModified, utcDateModified) VALUES ('smallblob1', ?, '2020-01-01T00:00:00.000Z', '2020-01-01T00:00:00.000Z')",
                [smallContent]
            );
            sql.execute(
                `INSERT INTO entity_changes (id, entityName, entityId, hash, isErased, changeId, componentId, instanceId, isSynced, utcDateChanged)
                 VALUES (?, 'blobs', 'smallblob1', 'smallhash', 0, 'smallchg', 'cmp', 'OTHER', 1, '2020-01-01T00:00:00.000Z')`,
                [maxId + 1]
            );
            const blobChange = sql.getRow<EntityChange>("SELECT * FROM entity_changes WHERE id = ?", [maxId + 1]);

            // 10 bytes with a 10-byte limit is not "larger than", so it is served in full.
            const [record] = syncService.getEntityChangeRecords([blobChange], undefined, 10);
            expect(record.entity?.content).not.toBe("");

            sql.execute("DELETE FROM entity_changes WHERE id = ?", [maxId + 1]);
            sql.execute("DELETE FROM blobs WHERE blobId = 'smallblob1'");
        });

        it("passes maxBlobContentSize from the query string through to stubbing", async () => {
            const sql = getSql();
            const maxId = sql.getValue<number>("SELECT COALESCE(MAX(id), 0) FROM entity_changes");

            const bigContent = "z".repeat(100);
            sql.execute(
                "INSERT INTO blobs (blobId, content, dateModified, utcDateModified) VALUES ('routeblob1', ?, '2020-01-01T00:00:00.000Z', '2020-01-01T00:00:00.000Z')",
                [bigContent]
            );
            sql.execute(
                `INSERT INTO entity_changes (id, entityName, entityId, hash, isErased, changeId, componentId, instanceId, isSynced, utcDateChanged)
                 VALUES (?, 'blobs', 'routeblob1', 'routehash', 0, 'routechg', 'cmp', 'OTHER', 1, '2020-01-01T00:00:00.000Z')`,
                [maxId + 1]
            );

            type Resp = { entityChanges: { entityChange: EntityChange; entity?: { content?: string } }[] };

            const stubbedRes = await api.get<Resp>("/api/sync/changed", {
                query: { instanceId: "CLIENTX", lastEntityChangeId: String(maxId), maxBlobContentSize: "50" }
            });
            const stubbedRec = stubbedRes.body.entityChanges.find((r) => r.entityChange.entityId === "routeblob1");
            expect(stubbedRec?.entity?.content).toBe("");
            expect(stubbedRec?.entityChange.hash).toBe("routehash");

            // Invalid / non-positive values disable the limit → full content.
            for (const bad of ["0", "-1", "abc"]) {
                const res = await api.get<Resp>("/api/sync/changed", {
                    query: { instanceId: "CLIENTX", lastEntityChangeId: String(maxId), maxBlobContentSize: bad }
                });
                const rec = res.body.entityChanges.find((r) => r.entityChange.entityId === "routeblob1");
                expect(rec?.entity?.content).not.toBe("");
            }

            sql.execute("DELETE FROM entity_changes WHERE id = ?", [maxId + 1]);
            sql.execute("DELETE FROM blobs WHERE blobId = 'routeblob1'");
        });

        it("getEntityChangeRecords stops accumulating once the response byte cap is reached", () => {
            const sql = getSql();
            const maxId = sql.getValue<number>("SELECT COALESCE(MAX(id), 0) FROM entity_changes");
            const changes: EntityChange[] = [];
            for (let i = 0; i < 3; i++) {
                sql.execute("INSERT INTO options (name, value, isSynced, utcDateModified) VALUES (?, 'v', 1, '2020-01-01T00:00:00.000Z')", [`cap_opt_${i}`]);
                sql.execute(
                    `INSERT INTO entity_changes (id, entityName, entityId, hash, isErased, changeId, componentId, instanceId, isSynced, utcDateChanged)
                     VALUES (?, 'options', ?, 'h', 0, ?, 'cmp', 'OTHER', 1, '2020-01-01T00:00:00.000Z')`,
                    [maxId + 1 + i, `cap_opt_${i}`, `cap_chg_${i}`]
                );
                changes.push(sql.getRow<EntityChange>("SELECT * FROM entity_changes WHERE id = ?", [maxId + 1 + i]));
            }

            // Each option record estimates ~300 bytes, so a 400-byte cap stops right after the second
            // record crosses it (the crossing record is still included).
            expect(syncService.getEntityChangeRecords(changes, 400)).toHaveLength(2);
            // With the (large) default cap all three are returned.
            expect(syncService.getEntityChangeRecords(changes)).toHaveLength(3);

            sql.execute("DELETE FROM entity_changes WHERE id BETWEEN ? AND ?", [maxId + 1, maxId + 3]);
            for (let i = 0; i < 3; i++) sql.execute("DELETE FROM options WHERE name = ?", [`cap_opt_${i}`]);
        });
    });

    describe("update (PUT /api/sync/update)", () => {
        it("applies a single-page push", async () => {
            const update = vi.spyOn(syncUpdateService, "updateEntities").mockImplementation(() => {});

            const res = await api.put("/api/sync/update", {
                headers: { pageCount: "1", pageIndex: "0" },
                body: { entities: [], instanceId: "x" }
            });
            expect(res.status).toBe(204);
            expect(update).toHaveBeenCalledWith([], "x");
        });

        it("throws when a multi-page request has no request ID", async () => {
            const res = await api.put<{ message: string }>("/api/sync/update", {
                headers: { pageCount: "2", pageIndex: "0" },
                body: ""
            });
            expect(res.status).toBe(500);
            expect(res.body.message).toContain("Missing request ID");
        });

        it("accumulates paginated chunks and applies them on the last page", async () => {
            const update = vi.spyOn(syncUpdateService, "updateEntities").mockImplementation(() => {});
            const payload = JSON.stringify({ entities: [{ a: 1 }], instanceId: "y" });
            const mid = Math.floor(payload.length / 2);

            const first = await api.put("/api/sync/update", {
                headers: { pageCount: "2", pageIndex: "0", requestId: "r1" },
                body: payload.slice(0, mid)
            });
            // Not the last page yet → returns undefined (no body) and does not apply.
            expect(first.status).toBe(204);
            expect(update).not.toHaveBeenCalled();

            const last = await api.put("/api/sync/update", {
                headers: { pageCount: "2", pageIndex: "1", requestId: "r1" },
                body: payload.slice(mid)
            });
            expect(last.status).toBe(204);
            expect(update).toHaveBeenCalledWith([{ a: 1 }], "y");
        });

        it("throws when a continuation page has no initialized record", async () => {
            const res = await api.put<{ message: string }>("/api/sync/update", {
                headers: { pageCount: "2", pageIndex: "1", requestId: "rX" },
                body: "chunk"
            });
            expect(res.status).toBe(500);
            expect(res.body.message).toContain("does not have expected record");
        });
    });

    it("syncFinished marks the database as initialized", async () => {
        const setInit = vi.spyOn(sqlInit, "setDbAsInitialized").mockImplementation(() => {});

        const res = await api.post("/api/sync/finished");
        expect(res.status).toBe(204);
        expect(setInit).toHaveBeenCalled();
    });

    it("queueSector adds entity changes for the sector", async () => {
        const add = vi.spyOn(entityChangesService, "addEntityChangesForSector").mockImplementation(() => {});

        const res = await api.post("/api/sync/queue-sector/notes/a");
        expect(res.status).toBe(204);
        expect(add).toHaveBeenCalledWith("notes", "a");
    });

    it("checkEntityChanges runs the consistency checks", async () => {
        const check = vi.spyOn(consistencyChecksService, "runEntityChangesChecks").mockImplementation(() => {});

        const res = await api.post("/api/sync/check-entity-changes");
        expect(res.status).toBe(204);
        expect(check).toHaveBeenCalled();
    });
});
