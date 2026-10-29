import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
    initializeCore: vi.fn((_config: Record<string, unknown>) => Promise.resolve()),
    setBeccaReplicaSink: vi.fn(),
    loadFromFile: vi.fn(),
    replica: { run: vi.fn(), start: vi.fn(), onCommit() {}, onReload() {}, onProtectedSession() {} }
}));

vi.mock("@triliumnext/core", () => ({
    initializeCore: h.initializeCore,
    setBeccaReplicaSink: h.setBeccaReplicaSink,
    becca_loader: { beccaLoaded: Promise.resolve() },
    options: {},
    getLog: () => ({ info() {}, error() {} })
}));
vi.mock("./backup_provider.js", () => ({ default: class {} }));
vi.mock("./cls_provider.js", () => ({ default: class {} }));
vi.mock("./core_assets.js", () => ({ loadCoreSchema: () => "" }));
vi.mock("./crypto_provider.js", () => ({ default: class {} }));
vi.mock("./in_app_help_provider.js", () => ({ default: class {} }));
vi.mock("./log_provider.js", () => ({ default: class { info() {} } }));
vi.mock("./platform_provider.js", () => ({ default: class {} }));
vi.mock("./services/data_dir.js", () => ({ default: { DOCUMENT_PATH: "/data/document.db", TRILIUM_DATA_DIR: "/data" } }));
vi.mock("./services/request.js", () => ({ default: class {} }));
vi.mock("./services/resource_dir.js", () => ({ RESOURCE_DIR: "/res" }));
vi.mock("./services/setup_marker.js", () => ({ consumeSetupMarker: () => null, setupPlatform: {} }));
vi.mock("./services/ws_messaging_provider.js", () => ({ default: class {} }));
vi.mock("./sql_provider.js", () => ({ default: class { loadFromFile = h.loadFromFile; } }));
vi.mock("./zip_provider.js", () => ({ default: class {} }));
vi.mock("./services/config.js", () => ({ default: { General: { readOnly: false } } }));
vi.mock("./services/database_restore.js", () => ({ recoverInterruptedRestore: vi.fn() }));
vi.mock("./services/export/zip/factory.js", () => ({ serverZipExportProviderFactory: vi.fn() }));
vi.mock("./services/i18n.js", () => ({ initializeTranslationsWithParams: vi.fn() }));
vi.mock("./services/image_provider.js", () => ({ serverImageProvider: {} }));
vi.mock("./services/search_replica/replica_client.js", () => ({ createReplicaSearchExecutor: () => h.replica }));

let previousIntegrationTest: string | undefined;

beforeEach(() => {
    vi.resetModules();
    h.initializeCore.mockClear();
    h.setBeccaReplicaSink.mockClear();
    previousIntegrationTest = process.env.TRILIUM_INTEGRATION_TEST;
    delete process.env.TRILIUM_INTEGRATION_TEST;
});

afterEach(() => {
    if (previousIntegrationTest === undefined) {
        delete process.env.TRILIUM_INTEGRATION_TEST;
    } else {
        process.env.TRILIUM_INTEGRATION_TEST = previousIntegrationTest;
    }
});

describe("initializeServerCore", () => {
    it("hands core the pooled content-job executor and the search replica, fed once becca has loaded", async () => {
        const { initializeServerCore } = await import("./core_init.js");

        await initializeServerCore();

        expect(h.loadFromFile).toHaveBeenCalledWith("/data/document.db", false);
        expect(h.initializeCore).toHaveBeenCalledTimes(1);

        const config = h.initializeCore.mock.calls[0][0];
        const contentJobs = config.contentJobs as { run?: unknown; concurrency?: unknown; shutdown?: unknown };

        expect(typeof contentJobs.run).toBe("function");
        expect(typeof contentJobs.shutdown).toBe("function");
        expect(contentJobs.concurrency).toBeGreaterThanOrEqual(1);
        expect(config.search).toBe(h.replica);
        await Promise.resolve();
        expect(h.setBeccaReplicaSink).toHaveBeenCalledWith(h.replica);
        expect(h.replica.start).not.toHaveBeenCalled();
    });
});
