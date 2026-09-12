import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

import appInfo from "../../services/app_info";
import { getBackup } from "../../services/backup";
import * as passwordService from "../../services/encryption/password";
import passwordEncryptionService from "../../services/encryption/password_encryption";
import optionService from "../../services/options";
import setupService from "../../services/setup";
import { isSetupAuthorized, resetSetupAuth } from "../../services/setup_auth";
import {
    enterSetupMode,
    initSetupPlatform,
    leaveSetupMode,
    markExistingDataDiscarded
} from "../../services/setup_mode";
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

describe("Setup API with a knowledge base behind the wizard (core)", () => {
    beforeAll(() => {
        api = CoreApiTester.build();
    });

    beforeEach(() => {
        initSetupPlatform(platform);
        enterSetupMode({ lang: "en" });
    });

    afterEach(() => {
        leaveSetupMode();
        Object.values(platform).forEach((fn) => fn.mockClear());
        vi.restoreAllMocks();
    });

    it("erases it before creating a document, which is the moment the user commits to that", async () => {
        const createInitial = vi.spyOn(sqlInit, "createInitialDatabase").mockResolvedValue(undefined);

        const res = await api.post("/api/setup/new-document", { query: { skipDemoDb: "1" } });

        expect(res.status).toBe(204);
        expect(platform.removeDatabase).toHaveBeenCalledOnce();
        expect(createInitial).toHaveBeenCalled();
    });

    it("leaves the erasing to the sync itself, which alone knows when it is safe", async () => {
        // Deliberately not here: reaching a sync server can fail on a mistyped host, a refused
        // password or a version mismatch, and every one of those has to leave the knowledge base
        // where it was. `setupSyncFromSyncServer` erases once the server has answered — see the
        // service's own spec, which pins that ordering.
        vi.spyOn(setupService, "setupSyncFromSyncServer").mockResolvedValue({ result: "success" });

        const res = await api.post("/api/setup/sync-from-server", {
            body: { syncServerHost: "http://host", syncProxy: "", password: "pw" }
        });

        expect(res.status).toBe(200);
        expect(platform.removeDatabase).not.toHaveBeenCalled();
    });

    it("refuses a pushed sync seed until the local user has cleared the way for it", async () => {
        // The push comes from the other device and carries nothing this instance issued, so what
        // stands in for a token is the state: a schema is created here by wiping what is in the way.
        const createForSync = vi.spyOn(sqlInit, "createDatabaseForSync").mockResolvedValue(undefined as never);

        const refused = await api.post<{ error: string }>("/api/setup/sync-seed", {
            body: { syncVersion: appInfo.syncVersion, options: [] }
        });

        expect(refused.status).toBe(400);
        expect(createForSync).not.toHaveBeenCalled();

        markExistingDataDiscarded();
        const accepted = await api.post("/api/setup/sync-seed", {
            body: { syncVersion: appInfo.syncVersion, options: [] }
        });

        expect(accepted.status).toBe(204);
        expect(createForSync).toHaveBeenCalled();
    });

    it("withholds the stored sync server while the wizard is locked", async () => {
        vi.spyOn(sqlInit, "isDbInitialized").mockReturnValue(false);
        vi.spyOn(passwordService, "isPasswordSet").mockReturnValue(true);

        const locked = await api.get<{ authRequired: boolean; syncServerHost?: string }>("/api/setup/status");

        expect(locked.body.authRequired).toBe(true);
        // A live instance's own sync server, on an endpoint anybody who can reach the port may read.
        expect(locked.body.syncServerHost).toBeUndefined();
    });

    it("answers whether a start-over is waiting, and takes the request back", async () => {
        platform.hasMarker.mockResolvedValue(true);
        const pending = await api.get<{ requested: boolean }>("/api/setup/boot");
        expect(pending.body.requested).toBe(true);

        const cancelled = await api.delete("/api/setup/boot");
        expect(cancelled.status).toBe(204);
        expect(platform.removeMarker).toHaveBeenCalled();
    });
});

describe("asking the next start to be the wizard (core)", () => {
    beforeAll(() => {
        api = CoreApiTester.build();
    });

    beforeEach(() => initSetupPlatform(platform));

    afterEach(() => {
        Object.values(platform).forEach((fn) => fn.mockClear());
        vi.restoreAllMocks();
    });

    it("writes a marker carrying the instance's own language, and no screen unless one was named", async () => {
        // The language cannot be read from the marker's own request: by the time it is acted on the
        // database it came from is deliberately closed, so it has to be carried across.
        vi.spyOn(optionService, "getOptionOrNull").mockImplementation((name) => (name === "locale" ? "ro" : null));

        const res = await api.post("/api/setup/boot");

        expect(res.status).toBe(204);
        expect(platform.writeMarker).toHaveBeenCalledWith({ lang: "ro" });
    });

    it("falls back to English where the instance has no language of its own recorded", async () => {
        vi.spyOn(optionService, "getOptionOrNull").mockReturnValue(null);

        await api.post("/api/setup/boot");

        expect(platform.writeMarker).toHaveBeenCalledWith({ lang: "en" });
    });

    it("carries a screen the caller named, and drops one it made up", async () => {
        vi.spyOn(optionService, "getOptionOrNull").mockReturnValue("en");

        await api.post("/api/setup/boot", { body: { targetScreen: "restore-backup" } });
        expect(platform.writeMarker).toHaveBeenLastCalledWith({ lang: "en", targetScreen: "restore-backup" });

        // Two of the wizard's screens create a database the moment they are shown. A request must
        // not be able to name one, so anything unrecognised is dropped rather than carried.
        await api.post("/api/setup/boot", { body: { targetScreen: "createNewDocumentEmpty" } });
        expect(platform.writeMarker).toHaveBeenLastCalledWith({ lang: "en" });
    });
});

describe("unlocking the wizard (core)", () => {
    beforeAll(() => {
        api = CoreApiTester.build();
    });

    beforeEach(() => {
        resetSetupAuth();
        initSetupPlatform(platform);
        enterSetupMode({ lang: "en" });
        vi.spyOn(passwordService, "isPasswordSet").mockReturnValue(true);
    });

    afterEach(() => {
        leaveSetupMode();
        resetSetupAuth();
        vi.restoreAllMocks();
    });

    it("hands back a token for the right password", async () => {
        vi.spyOn(passwordEncryptionService, "verifyPassword").mockResolvedValue(true);

        const res = await api.post<{ authenticated: boolean; token?: string }>(
            "/api/setup/auth", { body: { password: "hunter2" } });

        expect(res.status).toBe(200);
        expect(res.body.authenticated).toBe(true);
        expect(isSetupAuthorized(res.body.token)).toBe(true);
    });

    it("says only no for the wrong one, and hands back nothing to go on", async () => {
        vi.spyOn(passwordEncryptionService, "verifyPassword").mockResolvedValue(false);

        const res = await api.post<{ authenticated: boolean; token?: string }>(
            "/api/setup/auth", { body: { password: "wrong" } });

        expect(res.status).toBe(200);
        expect(res.body).toEqual({ authenticated: false });
    });

    it("treats a body that carries no password as an empty one rather than failing on it", async () => {
        // The body arrives from a client and may be anything at all, including nothing.
        const verify = vi.spyOn(passwordEncryptionService, "verifyPassword").mockResolvedValue(false);

        await api.post("/api/setup/auth", { body: {} });
        await api.post("/api/setup/auth", { body: { password: 42 } });

        expect(verify).toHaveBeenNthCalledWith(1, "");
        expect(verify).toHaveBeenNthCalledWith(2, "");
    });
});

describe("what becomes of the knowledge base behind the wizard (core)", () => {
    beforeAll(() => {
        api = CoreApiTester.build();
    });

    beforeEach(() => {
        initSetupPlatform(platform);
        enterSetupMode({ lang: "en" });
    });

    afterEach(() => {
        leaveSetupMode();
        Object.values(platform).forEach((fn) => fn.mockClear());
        vi.restoreAllMocks();
    });

    it("starts a backup and follows it through the status, rather than waiting on the request", async () => {
        // The write runs for minutes on a large knowledge base, and on standalone a request rides
        // the service worker, whose fetches the browser reclaims long before that.
        const written = { fileName: "b.tnbackup", filePath: "/b/b.tnbackup", directoryPath: "/b", fileSize: 12 };
        const backup = getBackup() as { backupAs?: unknown };
        const previous = backup.backupAs;
        backup.backupAs = async () => written;

        const started = await api.post("/api/setup/existing/backup", { body: { name: "Before the change" } });
        expect(started.status).toBe(204);

        await vi.waitFor(async () => {
            const res = await api.get<{ state: string; result?: typeof written }>("/api/setup/existing/status");
            expect(res.body.state).toBe("done");
            expect(res.body.result).toEqual(written);
        });

        backup.backupAs = previous;
    });

    it("offers back the answers this instance already backs up under", async () => {
        vi.spyOn(optionService, "getOptionOrNull").mockImplementation((name) =>
            (name === "backupEnableCompression" ? "true" : "false"));

        const res = await api.get<{ compress: boolean; encrypt: boolean; storedPassphrase: boolean }>(
            "/api/setup/existing/backup-defaults");

        expect(res.status).toBe(200);
        expect(res.body).toMatchObject({ compress: true, encrypt: false });
        // Whether there is a passphrase, never what it is: a screen that could read it could be
        // made to hand it over.
        expect(typeof res.body.storedPassphrase).toBe("boolean");
    });

    it("erases it when that is what was asked for, and refuses to a second time", async () => {
        const erased = await api.post("/api/setup/existing/delete");

        expect(erased.status).toBe(204);
        expect(platform.removeDatabase).toHaveBeenCalledOnce();

        // Asked again, there is nothing left to act on and the route says so rather than erasing a
        // file that is already gone.
        const again = await api.post<{ message?: string }>("/api/setup/existing/delete");
        expect(again.status).toBe(500);
        expect(platform.removeDatabase).toHaveBeenCalledOnce();
    });

    it("puts the instance back on the database it was booted away from", async () => {
        vi.spyOn(sqlInit, "initDbConnection").mockResolvedValue(undefined);

        const res = await api.post("/api/setup/existing/keep");

        expect(res.status).toBe(204);
        // The marker goes first: a start that finds one comes up as the wizard all over again.
        expect(platform.removeMarker).toHaveBeenCalled();
        expect(platform.removeDatabase).not.toHaveBeenCalled();
    });
});

/** A platform whose marker and database are only ever written down as having been asked for. */
const platform = {
    writeMarker: vi.fn(async () => {}),
    hasMarker: vi.fn(async () => false),
    removeMarker: vi.fn(async () => {}),
    removeDatabase: vi.fn(async () => {})
};
