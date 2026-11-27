import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
    initializeServerCore: vi.fn(),
    startTriliumServer: vi.fn(),
    isDbInitialized: vi.fn(),
    banner: vi.fn(),
    t: vi.fn((key: string, options: { port: number }) => `${key}@${options.port}`)
}));

vi.mock("./core_init.js", () => ({ initializeServerCore: mocks.initializeServerCore }));
vi.mock("./www.js", () => ({ default: mocks.startTriliumServer }));
vi.mock("./services/port.js", () => ({ default: 8123 }));
vi.mock("i18next", () => ({ t: mocks.t }));
vi.mock("@triliumnext/core", () => ({
    getLog: () => ({ banner: mocks.banner }),
    sql_init: { isDbInitialized: mocks.isDbInitialized }
}));

/** `main.ts` is the server's entry point: importing it starts the application. */
async function runMain() {
    vi.resetModules();
    await import("./main.js");
    // Startup is a floating promise; wait for it to reach its last step.
    await vi.waitFor(() => expect(mocks.isDbInitialized.mock.calls.length + vi.mocked(process.exit).mock.calls.length).toBeGreaterThan(0));
}

describe("server entry point", () => {
    beforeEach(() => {
        vi.clearAllMocks();
        mocks.initializeServerCore.mockResolvedValue(undefined);
        mocks.startTriliumServer.mockResolvedValue({});
        vi.spyOn(process, "exit").mockImplementation((() => undefined) as never);
        vi.spyOn(console, "error").mockImplementation(() => {});
    });

    afterEach(() => vi.restoreAllMocks());

    it("initializes core before starting the server, and stays quiet on an initialized database", async () => {
        mocks.isDbInitialized.mockReturnValue(true);

        await runMain();

        expect(mocks.initializeServerCore.mock.invocationCallOrder[0])
            .toBeLessThan(mocks.startTriliumServer.mock.invocationCallOrder[0]);
        expect(mocks.banner).not.toHaveBeenCalled();
        expect(process.exit).not.toHaveBeenCalled();
    });

    it("points a fresh install at the setup page on the server's port", async () => {
        mocks.isDbInitialized.mockReturnValue(false);

        await runMain();

        expect(mocks.t).toHaveBeenCalledWith("sql_init.db_not_initialized_server", { port: 8123 });
        expect(mocks.banner).toHaveBeenCalledWith("sql_init.db_not_initialized_server@8123");
    });

    it("exits with an error when startup fails", async () => {
        const error = new Error("database is locked");
        mocks.initializeServerCore.mockRejectedValue(error);

        await runMain();

        expect(console.error).toHaveBeenCalledWith("Fatal error during Trilium server startup:", error);
        expect(process.exit).toHaveBeenCalledExactlyOnceWith(1);
        expect(mocks.startTriliumServer).not.toHaveBeenCalled();
    });
});
