import { vi, describe, it, expect, beforeEach } from "vitest";

// Mutable mock state that can be changed between tests
const mockState = {
    scriptingEnabled: false,
    sqlConsoleEnabled: false
};

// Mock config module so Security section can be controlled per test
vi.mock("./config.js", () => ({
    default: {
        Security: {
            get backendScriptingEnabled() {
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
        mockState.scriptingEnabled = false;
        mockState.sqlConsoleEnabled = false;
        vi.resetModules();
    });

    describe("assertScriptingEnabled", () => {
        it("should throw when scripting is disabled", async () => {
            mockState.scriptingEnabled = false;

            const { assertScriptingEnabled } = await import("./scripting_guard.js");
            expect(() => assertScriptingEnabled()).toThrow(
                /Backend script execution is disabled/
            );
        });

        it("should not throw when scripting is enabled", async () => {
            mockState.scriptingEnabled = true;

            const { assertScriptingEnabled } = await import("./scripting_guard.js");
            expect(() => assertScriptingEnabled()).not.toThrow();
        });
    });

    describe("assertSqlConsoleEnabled", () => {
        it("should throw when SQL console is disabled", async () => {
            mockState.sqlConsoleEnabled = false;

            const { assertSqlConsoleEnabled } = await import("./scripting_guard.js");
            expect(() => assertSqlConsoleEnabled()).toThrow(
                /SQL console is disabled/
            );
        });

        it("should not throw when SQL console is enabled", async () => {
            mockState.sqlConsoleEnabled = true;

            const { assertSqlConsoleEnabled } = await import("./scripting_guard.js");
            expect(() => assertSqlConsoleEnabled()).not.toThrow();
        });
    });

    describe("isScriptingEnabled", () => {
        it("should return false when disabled", async () => {
            mockState.scriptingEnabled = false;

            const { isScriptingEnabled } = await import("./scripting_guard.js");
            expect(isScriptingEnabled()).toBe(false);
        });

        it("should return true when enabled", async () => {
            mockState.scriptingEnabled = true;

            const { isScriptingEnabled } = await import("./scripting_guard.js");
            expect(isScriptingEnabled()).toBe(true);
        });
    });
});
