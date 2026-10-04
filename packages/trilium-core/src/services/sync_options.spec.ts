import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("syncOptions.getSyncTimeout", () => {
    let getSyncTimeout: () => number;
    let getOptionMock: ReturnType<typeof vi.fn>;
    let mockSyncConfig: Record<string, string | undefined>;

    beforeEach(async () => {
        // Reset the module cache so the dynamic import below gets a fresh
        // instance of sync_options.ts with the mocked dependencies rather than
        // the cached copy loaded by the test runner's setupFiles.
        vi.resetModules();
        mockSyncConfig = {};
        getOptionMock = vi.fn();

        vi.doMock("./config.js", () => ({ default: { Sync: mockSyncConfig } }));
        vi.doMock("./options.js", () => ({ default: { getOption: getOptionMock } }));

        const mod = await import("./sync_options.js");
        getSyncTimeout = mod.default.getSyncTimeout;
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    it("converts database value from seconds to milliseconds", () => {
        // TimeSelector stores value in seconds (displayed value × scale)
        // Scale is UI-only, not used in backend calculation
        getOptionMock.mockReturnValue("120"); // 120 seconds = 2 minutes
        expect(getSyncTimeout()).toBe(120000);

        getOptionMock.mockReturnValue("30"); // 30 seconds
        expect(getSyncTimeout()).toBe(30000);

        getOptionMock.mockReturnValue("3600"); // 3600 seconds = 1 hour
        expect(getSyncTimeout()).toBe(3600000);
    });

    it("treats config override as raw milliseconds for backward compatibility", () => {
        mockSyncConfig.syncServerTimeout = "60000"; // 60 seconds in ms
        // Config value takes precedence, db value is ignored
        getOptionMock.mockReturnValue("9999");
        expect(getSyncTimeout()).toBe(60000);
    });

    it("uses safe defaults for invalid values", () => {
        getOptionMock.mockReturnValue("");
        expect(getSyncTimeout()).toBe(120000); // default 120 seconds

        mockSyncConfig.syncServerTimeout = "invalid";
        expect(getSyncTimeout()).toBe(120000); // fallback for invalid config
    });
});

describe("syncOptions.isSyncSetup", () => {
    let isSyncSetup: () => boolean;
    let getOptionOrNullMock: ReturnType<typeof vi.fn>;
    let mockSyncConfig: Record<string, string | undefined>;

    beforeEach(async () => {
        vi.resetModules();
        mockSyncConfig = {};
        getOptionOrNullMock = vi.fn();

        vi.doMock("./config.js", () => ({ default: { Sync: mockSyncConfig } }));
        vi.doMock("./options.js", () => ({
            default: {
                getOption: () => { throw new Error("Option 'syncServerHost' doesn't exist"); },
                getOptionOrNull: getOptionOrNullMock
            }
        }));

        const mod = await import("./sync_options.js");
        isSyncSetup = mod.default.isSyncSetup;
    });

    afterEach(() => {
        vi.clearAllMocks();
    });

    it("reports sync as not set up when the option does not exist yet", () => {
        getOptionOrNullMock.mockReturnValue(null);
        expect(isSyncSetup()).toBe(false);
    });

    it("follows the stored host, and the config override ahead of it", () => {
        getOptionOrNullMock.mockReturnValue("https://sync.example.com");
        expect(isSyncSetup()).toBe(true);

        getOptionOrNullMock.mockReturnValue("");
        expect(isSyncSetup()).toBe(false);

        mockSyncConfig.syncServerHost = "disabled";
        getOptionOrNullMock.mockReturnValue("https://sync.example.com");
        expect(isSyncSetup()).toBe(false);
    });
});
