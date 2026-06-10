import { afterEach, describe, expect, it, vi } from "vitest";

import appInfo from "./app_info.js";
import * as cls from "./context.js";
import options from "./options.js";
import { type ExecOpts, initRequest, type RequestProvider } from "./request.js";
import setupService from "./setup.js";
import sqlInit from "./sql_init.js";
import syncService from "./sync.js";

let execImpl: (opts: ExecOpts) => Promise<unknown> = async () => ({});
const fakeRequest: RequestProvider = {
    exec: <T>(opts: ExecOpts) => execImpl(opts) as Promise<T>,
    getImage: async () => new ArrayBuffer(0)
};
initRequest(fakeRequest);

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

describe("setup service", () => {
    afterEach(() => {
        execImpl = async () => ({});
        vi.restoreAllMocks();
    });

    it("getSyncSeedOptions returns the document id and secret options", () => {
        const seed = setupService.getSyncSeedOptions();
        expect(seed).toHaveLength(2);
        expect(seed[0]?.name).toBe("documentId");
        expect(seed[1]?.name).toBe("documentSecret");
    });

    describe("hasSyncServerSchemaAndSeed", () => {
        it("returns the schemaExists flag when sync versions match", async () => {
            execImpl = async () => ({ syncVersion: appInfo.syncVersion, schemaExists: true });
            await expect(setupService.hasSyncServerSchemaAndSeed()).resolves.toBe(true);

            execImpl = async () => ({ syncVersion: appInfo.syncVersion, schemaExists: false });
            await expect(setupService.hasSyncServerSchemaAndSeed()).resolves.toBe(false);
        });

        it("throws when the remote sync version differs", async () => {
            execImpl = async () => ({ syncVersion: appInfo.syncVersion + 1, schemaExists: true });
            await expect(setupService.hasSyncServerSchemaAndSeed()).rejects.toThrow(/sync protocol version/);
        });
    });

    it("sendSeedToSyncServer posts the seed and resets the sync counters", async () => {
        const requestedUrls: string[] = [];
        execImpl = async (opts) => {
            requestedUrls.push(opts.url);
            return undefined;
        };

        // setOption (resetting the counters) needs an active CLS context, which the
        // setup route would normally provide.
        await cls.init(() => setupService.sendSeedToSyncServer());

        expect(requestedUrls.some((u) => u.endsWith("/api/setup/sync-seed"))).toBe(true);
        expect(Number(options.getOption("lastSyncedPush"))).toBe(0);
        expect(Number(options.getOption("lastSyncedPull"))).toBe(0);
    });

    describe("setupSyncFromSyncServer", () => {
        it("refuses when the local DB is already initialized", async () => {
            const result = await setupService.setupSyncFromSyncServer("http://srv", "", "pw");
            expect(result).toEqual({ result: "failure", error: "DB is already initialized." });
        });

        it("creates the database and triggers sync on success", async () => {
            vi.spyOn(sqlInit, "isDbInitialized").mockReturnValue(false);
            const createSpy = vi.spyOn(sqlInit, "createDatabaseForSync").mockResolvedValue(undefined as never);
            vi.spyOn(sqlInit, "setDbAsInitialized").mockImplementation(() => {});
            vi.spyOn(syncService, "sync").mockResolvedValue({ success: true });
            execImpl = async () => ({ syncVersion: appInfo.syncVersion, options: [{ name: "documentId", value: "d" }] });

            const result = await setupService.setupSyncFromSyncServer("http://srv", "proxy", "pw");

            expect(result).toEqual({ result: "success" });
            expect(createSpy).toHaveBeenCalledWith([{ name: "documentId", value: "d" }], "http://srv", "proxy");
        });

        it("fails on a sync version mismatch", async () => {
            vi.spyOn(sqlInit, "isDbInitialized").mockReturnValue(false);
            execImpl = async () => ({ syncVersion: appInfo.syncVersion + 5, options: [] });

            const result = await setupService.setupSyncFromSyncServer("http://srv", "", "pw");
            if (result.result !== "failure") throw new Error("expected a failure result");
            expect(result.error).toMatch(/sync protocol version/);
        });

        it("fails gracefully when the seed request throws", async () => {
            vi.spyOn(sqlInit, "isDbInitialized").mockReturnValue(false);
            execImpl = async () => {
                throw new Error("network down");
            };

            const result = await setupService.setupSyncFromSyncServer("http://srv", "", "pw");
            expect(result).toEqual({ result: "failure", error: "network down" });
        });
    });

    describe("triggerSync", () => {
        it("marks the DB as initialized once a successful sync completes", async () => {
            vi.spyOn(syncService, "sync").mockResolvedValue({ success: true });
            const initializedSpy = vi.spyOn(sqlInit, "setDbAsInitialized").mockImplementation(() => {});

            setupService.triggerSync();
            await flush();

            expect(initializedSpy).toHaveBeenCalled();
        });

        it("does not mark the DB initialized when sync fails", async () => {
            vi.spyOn(syncService, "sync").mockResolvedValue({ success: false });
            const initializedSpy = vi.spyOn(sqlInit, "setDbAsInitialized").mockImplementation(() => {});

            setupService.triggerSync();
            await flush();

            expect(initializedSpy).not.toHaveBeenCalled();
        });
    });
});
