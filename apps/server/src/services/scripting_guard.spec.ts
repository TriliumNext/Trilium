import { vi, describe, it, expect, beforeEach } from "vitest";

// Mutable mock state that can be changed between tests
const mockState = {
    isElectron: false,
    scriptingEnabled: false,
    sqlConsoleEnabled: false
};

// Mock utils module so isElectron can be controlled per test
vi.mock("./utils.js", () => ({
    isElectron: false,
    default: {
        isElectron: false
    }
}));

// Mock config module so Scripting section can be controlled per test
vi.mock("./config.js", () => ({
    default: {
        Scripting: {
            get enabled() {
                return mockState.scriptingEnabled;
            },
            get sqlConsoleEnabled() {
                return mockState.sqlConsoleEnabled;
            }
        }
    }
}));

describe("scripting_guard", () => {
    beforeEach(() => {
        // Reset to defaults
        mockState.isElectron = false;
        mockState.scriptingEnabled = false;
        mockState.sqlConsoleEnabled = false;
        vi.resetModules();
    });

    describe("assertScriptingEnabled", () => {
        it("should throw when scripting is disabled and not Electron", async () => {
            mockState.isElectron = false;
            mockState.scriptingEnabled = false;

            // Re-mock utils with isElectron = false
            vi.doMock("./utils.js", () => ({
                isElectron: false,
                default: { isElectron: false }
            }));

            const { assertScriptingEnabled } = await import("./scripting_guard.js");
            expect(() => assertScriptingEnabled()).toThrowError(
                /Script execution is disabled/
            );
        });

        it("should not throw when scripting is enabled", async () => {
            mockState.scriptingEnabled = true;

            vi.doMock("./utils.js", () => ({
                isElectron: false,
                default: { isElectron: false }
            }));

            const { assertScriptingEnabled } = await import("./scripting_guard.js");
            expect(() => assertScriptingEnabled()).not.toThrow();
        });

        it("should not throw when isElectron is true even if config is false", async () => {
            mockState.scriptingEnabled = false;

            vi.doMock("./utils.js", () => ({
                isElectron: true,
                default: { isElectron: true }
            }));

            const { assertScriptingEnabled } = await import("./scripting_guard.js");
            expect(() => assertScriptingEnabled()).not.toThrow();
        });
    });

    describe("assertSqlConsoleEnabled", () => {
        it("should throw when SQL console is disabled and not Electron", async () => {
            mockState.sqlConsoleEnabled = false;

            vi.doMock("./utils.js", () => ({
                isElectron: false,
                default: { isElectron: false }
            }));

            const { assertSqlConsoleEnabled } = await import("./scripting_guard.js");
            expect(() => assertSqlConsoleEnabled()).toThrowError(
                /SQL console is disabled/
            );
        });

        it("should not throw when SQL console is enabled", async () => {
            mockState.sqlConsoleEnabled = true;

            vi.doMock("./utils.js", () => ({
                isElectron: false,
                default: { isElectron: false }
            }));

            const { assertSqlConsoleEnabled } = await import("./scripting_guard.js");
            expect(() => assertSqlConsoleEnabled()).not.toThrow();
        });
    });

    describe("isScriptingEnabled", () => {
        it("should return false when disabled and not Electron", async () => {
            mockState.scriptingEnabled = false;

            vi.doMock("./utils.js", () => ({
                isElectron: false,
                default: { isElectron: false }
            }));

            const { isScriptingEnabled } = await import("./scripting_guard.js");
            expect(isScriptingEnabled()).toBe(false);
        });

        it("should return true when enabled", async () => {
            mockState.scriptingEnabled = true;

            vi.doMock("./utils.js", () => ({
                isElectron: false,
                default: { isElectron: false }
            }));

            const { isScriptingEnabled } = await import("./scripting_guard.js");
            expect(isScriptingEnabled()).toBe(true);
        });

        it("should return true when isElectron is true", async () => {
            mockState.scriptingEnabled = false;

            vi.doMock("./utils.js", () => ({
                isElectron: true,
                default: { isElectron: true }
            }));

            const { isScriptingEnabled } = await import("./scripting_guard.js");
            expect(isScriptingEnabled()).toBe(true);
        });
    });
});
