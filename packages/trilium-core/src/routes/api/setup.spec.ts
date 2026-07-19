import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import appInfo from "../../services/app_info";
import optionService from "../../services/options";
import setupService from "../../services/setup";
import sqlInit from "../../services/sql_init";
import { CoreApiTester } from "../../test/api_tester";

/**
 * Drives the shared core setup routes through {@link CoreApiTester} (no
 * Express), so this spec runs under both the node and standalone (WASM) suites.
 *
 * The mutating handlers (new-document, sync-seed, sync-from-server) are stubbed
 * via `vi.spyOn` so they don't wipe/replace the in-memory fixture DB.
 */
let api: CoreApiTester;

describe("Setup API (core)", () => {
    beforeAll(() => {
        api = CoreApiTester.build();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("returns the setup status shape", async () => {
        const res = await api.get<{ isInitialized: boolean; schemaExists: boolean; syncVersion: number }>(
            "/api/setup/status"
        );
        expect(res.status).toBe(200);
        expect(typeof res.body.isInitialized).toBe("boolean");
        expect(typeof res.body.schemaExists).toBe("boolean");
        expect(res.body.syncVersion).toBe(appInfo.syncVersion);
    });

    it("includes the stored sync server so a failed setup can prefill the form, but only pre-initialization", async () => {
        vi.spyOn(sqlInit, "isDbInitialized").mockReturnValue(false);
        const res = await api.get<{ syncServerHost?: string; syncProxy?: string }>("/api/setup/status");
        // The fixture stores empty strings; presence of the keys is the contract.
        expect(res.body.syncServerHost).toBeDefined();
        expect(res.body.syncProxy).toBeDefined();
    });

    it("omits the sync server once initialized — setup/status is unauthenticated", async () => {
        const res = await api.get<{ syncServerHost?: string }>("/api/setup/status");
        expect(res.body.syncServerHost).toBeUndefined();
    });

    it("falls back to empty strings when the sync options are absent", async () => {
        vi.spyOn(sqlInit, "isDbInitialized").mockReturnValue(false);
        vi.spyOn(optionService, "getOptionOrNull").mockReturnValue(null);
        const res = await api.get<{ syncServerHost?: string; syncProxy?: string }>("/api/setup/status");
        expect(res.body.syncServerHost).toBe("");
        expect(res.body.syncProxy).toBe("");
    });

    it("creates a new document (createInitialDatabase stubbed)", async () => {
        const createInitial = vi.spyOn(sqlInit, "createInitialDatabase").mockResolvedValue(undefined);
        const res = await api.post("/api/setup/new-document", { query: { skipDemoDb: "1" } });
        expect(res.status).toBe(204);
        expect(createInitial).toHaveBeenCalledWith(true, undefined);
    });

    it("forwards the locale chosen during setup to createInitialDatabase", async () => {
        const createInitial = vi.spyOn(sqlInit, "createInitialDatabase").mockResolvedValue(undefined);
        const res = await api.post("/api/setup/new-document", { query: { skipDemoDb: "1" }, body: { locale: "de" } });
        expect(res.status).toBe(204);
        expect(createInitial).toHaveBeenCalledWith(true, "de");
    });

    it("returns the sync seed shape", async () => {
        const res = await api.get<{ options: unknown; syncVersion: number }>("/api/setup/sync-seed");
        expect(res.status).toBe(200);
        expect(res.body.syncVersion).toBe(appInfo.syncVersion);
        expect(res.body.options).toBeDefined();
    });

    it("rejects saving a sync seed with a mismatched sync version (400)", async () => {
        const createForSync = vi.spyOn(sqlInit, "createDatabaseForSync").mockResolvedValue(undefined as never);
        const res = await api.post<{ error: string }>("/api/setup/sync-seed", {
            body: { syncVersion: 999999, options: [] }
        });
        expect(res.status).toBe(400);
        expect(res.body.error).toBeTruthy();
        expect(createForSync).not.toHaveBeenCalled();
    });

    it("saves a sync seed with a matching sync version (createDatabaseForSync stubbed)", async () => {
        const createForSync = vi.spyOn(sqlInit, "createDatabaseForSync").mockResolvedValue(undefined as never);
        const res = await api.post("/api/setup/sync-seed", {
            body: { syncVersion: appInfo.syncVersion, options: [] }
        });
        expect(res.status).toBe(204);
        expect(createForSync).toHaveBeenCalledWith([]);
    });

    it("sets up sync from the sync server (setupSyncFromSyncServer stubbed)", async () => {
        const setupSync = vi
            .spyOn(setupService, "setupSyncFromSyncServer")
            .mockResolvedValue({ result: "success" });
        const res = await api.post<{ result: string }>("/api/setup/sync-from-server", {
            body: { syncServerHost: "http://host", syncProxy: "", password: "pw" }
        });
        expect(res.status).toBe(200);
        expect(res.body.result).toBe("success");
        // No blob limit supplied → 0 (unlimited).
        expect(setupSync).toHaveBeenCalledWith("http://host", "", "pw", 0);
    });

    it("threads a positive syncMaxBlobContentSize through to setupSyncFromSyncServer", async () => {
        const setupSync = vi
            .spyOn(setupService, "setupSyncFromSyncServer")
            .mockResolvedValue({ result: "success" });
        const res = await api.post<{ result: string }>("/api/setup/sync-from-server", {
            body: { syncServerHost: "http://host", syncProxy: "", password: "pw", syncMaxBlobContentSize: 20971520 }
        });
        expect(res.status).toBe(200);
        expect(setupSync).toHaveBeenCalledWith("http://host", "", "pw", 20971520);
    });

    it("normalizes an invalid syncMaxBlobContentSize to 0", async () => {
        const setupSync = vi
            .spyOn(setupService, "setupSyncFromSyncServer")
            .mockResolvedValue({ result: "success" });
        const res = await api.post<{ result: string }>("/api/setup/sync-from-server", {
            body: { syncServerHost: "http://host", syncProxy: "", password: "pw", syncMaxBlobContentSize: -5 }
        });
        expect(res.status).toBe(200);
        expect(setupSync).toHaveBeenCalledWith("http://host", "", "pw", 0);
    });
});
