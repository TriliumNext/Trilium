import fs from "fs";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    initializeCore: vi.fn(),
    recoverInterruptedRestore: vi.fn(),
    providerConstructed: vi.fn(),
    loadFromFile: vi.fn(),
    loadFromBuffer: vi.fn(),
    sendTransactionEntityChangesToAllClients: vi.fn(),
    getAndClearEntityChangeIds: vi.fn(),
    loadBecca: vi.fn(),
    recalculateMaxEntityChangeId: vi.fn(),
    setupMarker: { kind: "restore" },
    setupPlatform: { name: "server" }
}));

vi.mock("@triliumnext/core", async (importOriginal) => ({
    ...await importOriginal<typeof import("@triliumnext/core")>(),
    initializeCore: mocks.initializeCore,
    ws: { sendTransactionEntityChangesToAllClients: mocks.sendTransactionEntityChangesToAllClients },
    cls: { getAndClearEntityChangeIds: mocks.getAndClearEntityChangeIds },
    becca_loader: { load: mocks.loadBecca },
    entity_changes: { recalculateMaxEntityChangeId: mocks.recalculateMaxEntityChangeId }
}));
vi.mock("./sql_provider.js", () => ({
    default: class {
        loadFromFile = mocks.loadFromFile;
        loadFromBuffer = mocks.loadFromBuffer;
        constructor() {
            mocks.providerConstructed();
        }
    }
}));
vi.mock("./services/database_restore.js", () => ({ recoverInterruptedRestore: mocks.recoverInterruptedRestore }));
vi.mock("./services/setup_marker.js", () => ({
    consumeSetupMarker: () => mocks.setupMarker,
    setupPlatform: mocks.setupPlatform
}));

import { initializeServerCore } from "./core_init.js";
import NodejsCryptoProvider from "./crypto_provider.js";
import NodejsInAppHelpProvider from "./in_app_help_provider.js";
import ServerLogService from "./log_provider.js";
import ServerPlatformProvider from "./platform_provider.js";
import config from "./services/config.js";
import dataDirs from "./services/data_dir.js";
import { serverZipExportProviderFactory } from "./services/export/zip/factory.js";
import { initializeTranslationsWithParams } from "./services/i18n.js";
import { serverImageProvider } from "./services/image_provider.js";
import { RESOURCE_DIR } from "./services/resource_dir.js";
import WebSocketMessagingProvider from "./services/ws_messaging_provider.js";

type CoreInitArgs = {
    dbConfig: {
        provider: unknown;
        isReadOnly: boolean;
        onTransactionCommit(): void;
        onTransactionRollback(): void;
    };
    log: ServerLogService;
    getDemoArchive(): Promise<Uint8Array>;
    [key: string]: unknown;
};

describe("initializeServerCore", () => {
    const originalIntegrationTest = process.env.TRILIUM_INTEGRATION_TEST;
    const originalReadOnly = config.General.readOnly;
    const readFileSync = fs.readFileSync;
    const documentBuffer = Buffer.from("document");
    const demoBuffer = Buffer.from("demo");

    beforeEach(() => {
        vi.clearAllMocks();
        vi.spyOn(fs, "readFileSync").mockImplementation(((file: fs.PathOrFileDescriptor, options?: unknown) => {
            if (file === dataDirs.DOCUMENT_PATH) {
                return documentBuffer;
            }
            if (file === path.join(RESOURCE_DIR, "db", "demo.zip")) {
                return demoBuffer;
            }
            return readFileSync(file, options as BufferEncoding);
        }) as typeof fs.readFileSync);
    });

    afterEach(() => {
        if (originalIntegrationTest === undefined) {
            delete process.env.TRILIUM_INTEGRATION_TEST;
        } else {
            process.env.TRILIUM_INTEGRATION_TEST = originalIntegrationTest;
        }
        config.General.readOnly = originalReadOnly;
        vi.restoreAllMocks();
    });

    async function initialize() {
        await initializeServerCore();
        expect(mocks.initializeCore).toHaveBeenCalledOnce();
        return mocks.initializeCore.mock.calls[0][0] as CoreInitArgs;
    }

    it("recovers an interrupted restore, then hands core an in-memory copy and every Node provider", async () => {
        process.env.TRILIUM_INTEGRATION_TEST = "memory";
        config.General.readOnly = false;

        const args = await initialize();

        expect(mocks.recoverInterruptedRestore.mock.invocationCallOrder[0])
            .toBeLessThan(mocks.providerConstructed.mock.invocationCallOrder[0]);
        expect(mocks.loadFromBuffer).toHaveBeenCalledExactlyOnceWith(documentBuffer);
        expect(mocks.loadFromFile).not.toHaveBeenCalled();

        expect(args.dbConfig.isReadOnly).toBe(false);
        expect(args.log).toBeInstanceOf(ServerLogService);
        expect(args.crypto).toBeInstanceOf(NodejsCryptoProvider);
        expect(args.messaging).toBeInstanceOf(WebSocketMessagingProvider);
        expect(args.platform).toBeInstanceOf(ServerPlatformProvider);
        expect(args.inAppHelp).toBeInstanceOf(NodejsInAppHelpProvider);
        expect(args.schema).toEqual(expect.stringContaining("CREATE TABLE"));
        expect(args).toMatchObject({
            config,
            zipExportProviderFactory: serverZipExportProviderFactory,
            translations: initializeTranslationsWithParams,
            image: serverImageProvider,
            setupMarker: mocks.setupMarker,
            setupPlatform: mocks.setupPlatform,
            extraAppInfo: {
                nodeVersion: process.version,
                dataDirectory: path.resolve(dataDirs.TRILIUM_DATA_DIR)
            }
        });
        expect(await args.getDemoArchive()).toBe(demoBuffer);
    });

    it("opens the database file itself outside integration tests, honouring read-only mode", async () => {
        delete process.env.TRILIUM_INTEGRATION_TEST;
        config.General.readOnly = true;

        const args = await initialize();

        expect(mocks.loadFromFile).toHaveBeenCalledExactlyOnceWith(dataDirs.DOCUMENT_PATH, true);
        expect(mocks.loadFromBuffer).not.toHaveBeenCalled();
        expect(args.dbConfig.isReadOnly).toBe(true);
    });

    it("pushes committed changes to clients and reloads becca after a rollback that dirtied it", async () => {
        const args = await initialize();
        const logInfo = vi.spyOn(args.log, "info").mockImplementation(() => {});

        args.dbConfig.onTransactionCommit();
        await vi.waitFor(() => expect(mocks.sendTransactionEntityChangesToAllClients).toHaveBeenCalledOnce());

        mocks.getAndClearEntityChangeIds.mockReturnValueOnce([]);
        args.dbConfig.onTransactionRollback();
        await vi.waitFor(() => expect(mocks.recalculateMaxEntityChangeId).toHaveBeenCalledOnce());
        expect(mocks.loadBecca).not.toHaveBeenCalled();
        expect(logInfo).not.toHaveBeenCalled();

        mocks.getAndClearEntityChangeIds.mockReturnValueOnce([ 12, 13 ]);
        args.dbConfig.onTransactionRollback();
        await vi.waitFor(() => expect(mocks.recalculateMaxEntityChangeId).toHaveBeenCalledTimes(2));
        expect(mocks.loadBecca).toHaveBeenCalledOnce();
        expect(logInfo).toHaveBeenCalledWith("Transaction rollback dirtied the becca, forcing reload.");
    });
});
