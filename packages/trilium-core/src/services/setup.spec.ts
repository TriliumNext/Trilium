import { afterEach, describe, expect, it, vi } from "vitest";

import appInfo from "./app_info.js";
import * as cls from "./context.js";
import options from "./options.js";
import { fakeRequestProvider } from "../test/request_provider.js";
import { type ExecOpts, initRequest, type RequestProvider } from "./request.js";
import setupService from "./setup.js";
import { enterSetupMode, initSetupPlatform, leaveSetupMode } from "./setup_mode.js";
import sqlInit from "./sql_init.js";
import syncService from "./sync.js";

let execImpl: (opts: ExecOpts) => Promise<unknown> = async () => ({});
const fakeRequest: RequestProvider = fakeRequestProvider({
    exec: <T,>(opts: ExecOpts) => execImpl(opts) as Promise<T>,
    getImage: async () => new ArrayBuffer(0)
});
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
            // Default (no mobile limit) forwards 0 as the blob size limit.
            expect(createSpy).toHaveBeenCalledWith([{ name: "documentId", value: "d" }], "http://srv", "proxy", 0);
        });

        it("forwards a blob size limit to createDatabaseForSync", async () => {
            vi.spyOn(sqlInit, "isDbInitialized").mockReturnValue(false);
            const createSpy = vi.spyOn(sqlInit, "createDatabaseForSync").mockResolvedValue(undefined as never);
            vi.spyOn(sqlInit, "setDbAsInitialized").mockImplementation(() => {});
            vi.spyOn(syncService, "sync").mockResolvedValue({ success: true });
            execImpl = async () => ({ syncVersion: appInfo.syncVersion, options: [{ name: "documentId", value: "d" }] });

            await setupService.setupSyncFromSyncServer("http://srv", "proxy", "pw", 20971520);

            expect(createSpy).toHaveBeenCalledWith([{ name: "documentId", value: "d" }], "http://srv", "proxy", 20971520);
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

        describe("with a knowledge base still behind the wizard", () => {
            /** Records whether the erasure happened, and whether the schema was built before it. */
            function watchTheErasure() {
                const erased = { removeDatabase: false, beforeCreate: false };

                initSetupPlatform({
                    writeMarker: async () => {},
                    hasMarker: async () => false,
                    removeMarker: async () => {},
                    removeDatabase: async () => { erased.removeDatabase = true; }
                });
                enterSetupMode({ lang: "en" });

                vi.spyOn(sqlInit, "isDbInitialized").mockReturnValue(false);
                vi.spyOn(sqlInit, "createDatabaseForSync").mockImplementation(async () => {
                    erased.beforeCreate = erased.removeDatabase;
                });
                vi.spyOn(syncService, "sync").mockResolvedValue({ success: true });

                return erased;
            }

            afterEach(() => leaveSetupMode());

            it("keeps it when the server cannot be reached", async () => {
                // A mistyped host, a proxy that is not there, a machine that is off. Every one of
                // them is something the user goes back and corrects — which they can only do if
                // what they were correcting it for is still there.
                const erased = watchTheErasure();
                execImpl = async () => {
                    throw new Error("network down");
                };

                await expect(setupService.setupSyncFromSyncServer("http://srv", "", "pw"))
                    .resolves.toMatchObject({ result: "failure" });
                expect(erased.removeDatabase).toBe(false);
            });

            it("keeps it when the password is refused", async () => {
                const erased = watchTheErasure();
                execImpl = async () => {
                    throw new Error("Incorrect password");
                };

                await expect(setupService.setupSyncFromSyncServer("http://srv", "", "wrong"))
                    .resolves.toMatchObject({ result: "failure" });
                expect(erased.removeDatabase).toBe(false);
            });

            it("keeps it when the server speaks a different sync version", async () => {
                const erased = watchTheErasure();
                execImpl = async () => ({ syncVersion: appInfo.syncVersion + 5, options: [] });

                await expect(setupService.setupSyncFromSyncServer("http://srv", "", "pw"))
                    .resolves.toMatchObject({ result: "failure" });
                expect(erased.removeDatabase).toBe(false);
            });

            it("erases it only once the server has answered, and before the schema is built", async () => {
                // The schema is created by wiping whatever is in the way, so the erasure cannot come
                // after it either: there is exactly one place it belongs.
                const erased = watchTheErasure();
                execImpl = async () => ({ syncVersion: appInfo.syncVersion, options: [] });

                await expect(setupService.setupSyncFromSyncServer("http://srv", "", "pw"))
                    .resolves.toEqual({ result: "success" });
                expect(erased.removeDatabase).toBe(true);
                expect(erased.beforeCreate).toBe(true);
            });
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
