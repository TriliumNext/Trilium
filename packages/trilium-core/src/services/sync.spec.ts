import type { EntityChange } from "@triliumnext/commons";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import entityConstructor from "../becca/entity_constructor.js";
import consistencyChecks from "./consistency_checks.js";
import contentHashService from "./content_hash.js";
import * as cls from "./context.js";
import entityChangesService from "./entity_changes.js";
import getInstanceId from "./instance_id.js";
import options from "./options.js";
import { type ExecOpts, initRequest, type RequestProvider } from "./request.js";
import { getSql } from "./sql/index.js";
import setupService from "./setup.js";
import syncService from "./sync.js";
import syncOptions from "./sync_options.js";
import dateUtils from "./utils/date.js";

interface ChangesResponse {
    entityChanges: unknown[];
    lastEntityChangeId: number;
    outstandingPullCount: number;
}
interface CheckResponse {
    maxEntityChangeId: number;
    entityHashes: Record<string, Record<string, string>>;
}

interface FakeConfig {
    login?: { instanceId: string; maxEntityChangeId: number } | null;
    loginThrows?: Error;
    changed?: ChangesResponse[];
    check?: CheckResponse[];
    onCheck?: (callIndex: number) => void;
}

let config: FakeConfig = {};
let changedIdx = 0;
let checkIdx = 0;
const requestLog: Array<{ method: string; url: string }> = [];

const fakeRequest: RequestProvider = {
    exec: (<T>(opts: ExecOpts): Promise<T> => {
        requestLog.push({ method: opts.method, url: opts.url });
        const url = opts.url;
        const reply = (value: unknown) => Promise.resolve(value as T);

        if (url.includes("/api/login/sync")) {
            if (config.loginThrows) return Promise.reject(config.loginThrows);
            if (config.login === null) return reply(undefined);
            return reply(config.login ?? { instanceId: "REMOTE_INSTANCE", maxEntityChangeId: 0 });
        }
        if (url.includes("/api/sync/changed")) {
            const seq = config.changed ?? [{ entityChanges: [], lastEntityChangeId: 0, outstandingPullCount: 0 }];
            return reply(seq[Math.min(changedIdx++, seq.length - 1)]);
        }
        if (url.includes("/api/sync/check-entity-changes")) return reply({});
        if (url.includes("/api/sync/queue-sector")) return reply({});
        if (url.includes("/api/sync/check")) {
            config.onCheck?.(checkIdx);
            const seq = config.check ?? [{ maxEntityChangeId: 0, entityHashes: {} }];
            return reply(seq[Math.min(checkIdx++, seq.length - 1)]);
        }
        // /api/sync/update, /api/sync/finished, /api/setup/*
        return reply({});
    }) as RequestProvider["exec"],
    getImage: async () => new ArrayBuffer(0)
};
initRequest(fakeRequest);

const runSync = () => cls.init(() => syncService.sync());

describe("sync service", () => {
    beforeEach(() => {
        config = {};
        changedIdx = 0;
        checkIdx = 0;
        requestLog.length = 0;
        vi.spyOn(syncOptions, "isSyncSetup").mockReturnValue(true);
        vi.spyOn(syncOptions, "getSyncServerHost").mockReturnValue("http://sync.local");
        vi.spyOn(syncOptions, "getSyncProxy").mockReturnValue("");
        vi.spyOn(syncOptions, "getSyncTimeout").mockReturnValue(2000);
        vi.spyOn(setupService, "hasSyncServerSchemaAndSeed").mockResolvedValue(true);
        // Default: content hashes converge so the do/while loop terminates. Tests
        // that want a divergence override this.
        vi.spyOn(contentHashService, "checkContentHashes").mockReturnValue([]);
    });
    afterEach(() => vi.restoreAllMocks());

    it("reports NOT_CONFIGURED when sync is not set up", async () => {
        vi.spyOn(syncOptions, "isSyncSetup").mockReturnValue(false);
        await expect(runSync()).resolves.toMatchObject({ success: false, errorCode: "NOT_CONFIGURED" });
    });

    it("runs a full login/push/pull/finish/check cycle successfully", async () => {
        // Pull one (safe) change then drain; content check converges immediately.
        config.changed = [
            { entityChanges: [pulledOptionChange()], lastEntityChangeId: 9, outstandingPullCount: 1 },
            { entityChanges: [], lastEntityChangeId: 9, outstandingPullCount: 0 }
        ];
        // Starts cleared: the pull marks it incomplete, convergence clears it again.
        cls.init(() => options.setOption("syncIncomplete", "false"));

        const result = await runSync();

        expect(result).toEqual({ success: true });
        // The incomplete marker is cleared on convergence.
        expect(options.getOption("syncIncomplete")).toBe("false");
        // The expected endpoints were exercised.
        const urls = requestLog.map((r) => r.url);
        expect(urls.some((u) => u.includes("/api/login/sync"))).toBe(true);
        expect(urls.some((u) => u.includes("/api/sync/changed"))).toBe(true);
        expect(urls.some((u) => u.includes("/api/sync/finished"))).toBe(true);
        expect(urls.some((u) => u.includes("/api/sync/check"))).toBe(true);
    });

    it("re-runs the content check while the server reports outstanding pulls", async () => {
        config.check = [
            { maxEntityChangeId: 999_999_999, entityHashes: {} }, // lastSyncedPull < max -> loop again
            { maxEntityChangeId: 0, entityHashes: {} } // converged
        ];
        await expect(runSync()).resolves.toEqual({ success: true });
    });

    it("re-queues failed sectors when content hashes diverge", async () => {
        // First content check diverges (one failed sector), the next converges.
        vi.mocked(contentHashService.checkContentHashes).mockReturnValueOnce([{ entityName: "notes", sector: "a" }]);
        const checksSpy = vi.spyOn(consistencyChecks, "runEntityChangesChecks").mockImplementation(() => {});
        const sectorSpy = vi.spyOn(entityChangesService, "addEntityChangesForSector").mockImplementation(() => {});
        config.check = [
            { maxEntityChangeId: 0, entityHashes: { notes: { a: "deadbeef" } } },
            { maxEntityChangeId: 0, entityHashes: {} }
        ];

        await expect(runSync()).resolves.toEqual({ success: true });
        expect(checksSpy).toHaveBeenCalled();
        expect(sectorSpy).toHaveBeenCalledWith("notes", "a");
        expect(requestLog.some((r) => r.url.includes("/api/sync/queue-sector/notes/a"))).toBe(true);
    });

    it("skips the content check while local pushes are still outstanding", async () => {
        // Inject an outstanding synced change while answering the check request.
        config.onCheck = (callIndex) => {
            if (callIndex === 0) {
                cls.init(() =>
                    getSql().execute(
                        `INSERT INTO entity_changes (entityName, entityId, hash, isErased, changeId, componentId, instanceId, isSynced, utcDateChanged)
                         VALUES ('notes', 'sync_phantom', 'h', 0, 'phantomChg', 'NA', 'REMOTE_INSTANCE', 1, ?)`,
                        [dateUtils.utcNowDateTime()]
                    )
                );
            }
        };
        config.check = [
            { maxEntityChangeId: 0, entityHashes: {} },
            { maxEntityChangeId: 0, entityHashes: {} }
        ];

        await expect(runSync()).resolves.toEqual({ success: true });
    });

    it("tolerates an unserialisable pull response while logging progress", async () => {
        const circular: Record<string, unknown> = { entityChanges: [pulledOptionChange()], lastEntityChangeId: 3, outstandingPullCount: 0 };
        circular.self = circular; // JSON.stringify will throw -> the logging catch handles it
        config.changed = [circular as unknown as ChangesResponse, { entityChanges: [], lastEntityChangeId: 3, outstandingPullCount: 0 }];
        await expect(runSync()).resolves.toEqual({ success: true });
    });

    it("fails when a pull request returns no response", async () => {
        config.changed = [undefined as unknown as ChangesResponse];
        await expect(runSync()).resolves.toEqual({ success: false, message: "Request failed." });
    });

    it("fails when the content check returns no response", async () => {
        config.check = [undefined as unknown as CheckResponse];
        await expect(runSync()).resolves.toEqual({ success: false, message: "Got no response." });
    });

    it("reports a connection failure without a stack-trace message", async () => {
        config.loginThrows = new Error("connect ECONNREFUSED 127.0.0.1:8080");
        await expect(runSync()).resolves.toEqual({ success: false, message: "No connection to sync server." });
    });

    it("reports other sync errors with their message", async () => {
        config.loginThrows = new Error("kaboom");
        await expect(runSync()).resolves.toEqual({ success: false, message: "kaboom" });
    });

    describe("login", () => {
        it("throws when the sync server shares the local instance id", async () => {
            config.login = { instanceId: getInstanceId(), maxEntityChangeId: 0 };
            await expect(cls.init(() => syncService.login())).rejects.toThrow(/instance ID/);
        });

        it("throws when the server returns no response", async () => {
            config.login = null;
            await expect(cls.init(() => syncService.login())).rejects.toThrow(/no response/i);
        });

        it("lowers the last synced pull when it exceeds the server max", async () => {
            cls.init(() => options.setOption("lastSyncedPull", "999999"));
            config.login = { instanceId: "REMOTE_INSTANCE", maxEntityChangeId: 7 };

            await cls.init(() => syncService.login());
            expect(Number(options.getOption("lastSyncedPull"))).toBe(7);
        });

        it("sends the seed to the server when the schema/seed is missing", async () => {
            vi.spyOn(setupService, "hasSyncServerSchemaAndSeed").mockResolvedValue(false);
            const seedSpy = vi.spyOn(setupService, "sendSeedToSyncServer").mockResolvedValue(undefined);
            config.login = { instanceId: "REMOTE_INSTANCE", maxEntityChangeId: 0 };

            await cls.init(() => syncService.login());
            expect(seedSpy).toHaveBeenCalled();
        });
    });

    describe("getEntityChangeRecords", () => {
        it("emits a bare record for erased changes and the entity row for normal ones", () => {
            const noteId = getSql().getValue<string>("SELECT noteId FROM notes WHERE isDeleted = 0 AND noteId <> 'root' LIMIT 1") ?? "root";
            const records = syncService.getEntityChangeRecords([
                ec({ entityName: "notes", entityId: noteId }),
                ec({ entityName: "notes", entityId: "does-not-exist" }),
                ec({ entityName: "notes", entityId: "ignored", isErased: true })
            ]);

            // The missing entity is dropped; the real note and the erased marker remain.
            expect(records.some((r) => r.entityChange.entityId === noteId && r.entity)).toBe(true);
            expect(records.some((r) => r.entityChange.entityId === "ignored" && !("entity" in r && r.entity))).toBe(true);
            expect(records.some((r) => r.entityChange.entityId === "does-not-exist")).toBe(false);
        });

        it("base64-encodes blob content and reads note reordering maps", () => {
            const blobId = getSql().getValue<string>("SELECT blobId FROM blobs WHERE content IS NOT NULL LIMIT 1") ?? "";
            const blobRecords = syncService.getEntityChangeRecords([ec({ entityName: "blobs", entityId: blobId })]);
            const blobEntity = blobRecords[0]?.entity as { content?: unknown } | undefined;
            expect(typeof blobEntity?.content).toBe("string"); // base64

            const reorder = syncService.getEntityChangeRecords([ec({ entityName: "note_reordering", entityId: "root" })]);
            expect(reorder[0]?.entity).toBeTypeOf("object");
        });

        it("throws when an entity type has no primary key", () => {
            vi.spyOn(entityConstructor, "getEntityFromEntityName").mockReturnValue({ primaryKeyName: "" } as ReturnType<typeof entityConstructor.getEntityFromEntityName>);
            expect(() => syncService.getEntityChangeRecords([ec({ entityName: "notes", entityId: "root" })])).toThrow(/Unknown entity/);
        });

        it("stops once the serialized batch exceeds the size limit", () => {
            const big = "x".repeat(1_100_000);
            cls.init(() => {
                getSql().execute("INSERT INTO blobs (blobId, content, dateModified, utcDateModified) VALUES ('sync_big_blob', ?, ?, ?)", [big, dateUtils.utcNowDateTime(), dateUtils.utcNowDateTime()]);
                getSql().execute("INSERT INTO blobs (blobId, content, dateModified, utcDateModified) VALUES ('sync_small_blob', 'y', ?, ?)", [dateUtils.utcNowDateTime(), dateUtils.utcNowDateTime()]);
            });

            const records = syncService.getEntityChangeRecords([
                ec({ entityName: "blobs", entityId: "sync_big_blob" }),
                ec({ entityName: "blobs", entityId: "sync_small_blob" })
            ]);
            // The big blob fills the budget so the small one is not included.
            expect(records).toHaveLength(1);
            expect(records[0]?.entityChange.entityId).toBe("sync_big_blob");
        });
    });

    it("exposes max entity change id and pull counters", () => {
        expect(typeof syncService.getMaxEntityChangeId()).toBe("number");
        expect(typeof syncService.getOutstandingPullCount()).toBe("number");
        // totalPullCount is null between syncs.
        expect([null, ...Array.from({ length: 0 })]).toContain(syncService.getTotalPullCount());
    });

    it("startSyncTimer schedules periodic and kickoff syncs once becca is loaded", async () => {
        // Mock the timer functions so no real sync is ever scheduled (which would
        // fire during later tests). beccaLoaded is already resolved in the bootstrap,
        // so its `.then` callback runs on the microtask queue.
        const setIntervalSpy = vi.spyOn(globalThis, "setInterval").mockReturnValue(0 as unknown as ReturnType<typeof setInterval>);
        const setTimeoutSpy = vi.spyOn(globalThis, "setTimeout").mockReturnValue(0 as unknown as ReturnType<typeof setTimeout>);

        syncService.startSyncTimer();
        await Promise.resolve();
        await Promise.resolve();

        expect(setIntervalSpy).toHaveBeenCalledWith(expect.any(Function), 60000);
        expect(setTimeoutSpy).toHaveBeenCalledWith(expect.any(Function), 5000);
    });
});

function pulledOptionChange(): { entityChange: EntityChange; entity: undefined } {
    // An options change with no entity row -> applied as a no-op by updateEntities.
    return {
        entityChange: ec({ entityName: "options", entityId: "sync_spec_noop_opt" }),
        entity: undefined
    };
}

function ec(overrides: Partial<EntityChange>): EntityChange {
    return {
        entityName: "notes",
        entityId: "x",
        hash: "remote",
        isErased: false,
        isSynced: true,
        utcDateChanged: "2050-01-01 00:00:00.000Z",
        instanceId: "REMOTE_INSTANCE",
        ...overrides
    } as EntityChange;
}
