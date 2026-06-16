import { afterEach, describe, expect, it } from "vitest";
import { type CoreConfig, getConfig, initConfig } from "./config.js";
import {
    assertScriptingEnabled,
    assertSqlConsoleEnabled,
    isScriptingEnabled
} from "./scripting_guard.js";

const original = getConfig();

/** Restore whatever config the test harness injected so sibling specs are unaffected. */
afterEach(() => initConfig(original));

function withSecurity(security: Partial<CoreConfig["Security"]>) {
    initConfig({
        ...original,
        Security: {
            backendScriptingEnabled: false,
            sqlConsoleEnabled: false,
            ...security
        }
    });
}

describe("scripting_guard", () => {
    it("assertScriptingEnabled passes when backend scripting is enabled", () => {
        withSecurity({ backendScriptingEnabled: true });
        expect(() => assertScriptingEnabled()).not.toThrow();
        expect(isScriptingEnabled()).toBe(true);
    });

    it("assertScriptingEnabled throws when backend scripting is disabled", () => {
        withSecurity({ backendScriptingEnabled: false });
        expect(() => assertScriptingEnabled()).toThrow(
            /Backend script execution is disabled/
        );
        expect(isScriptingEnabled()).toBe(false);
    });

    it("assertSqlConsoleEnabled passes when the SQL console is enabled", () => {
        withSecurity({ sqlConsoleEnabled: true });
        expect(() => assertSqlConsoleEnabled()).not.toThrow();
    });

    it("assertSqlConsoleEnabled throws when the SQL console is disabled", () => {
        withSecurity({ sqlConsoleEnabled: false });
        expect(() => assertSqlConsoleEnabled()).toThrow(
            /SQL console is disabled/
        );
    });
});
