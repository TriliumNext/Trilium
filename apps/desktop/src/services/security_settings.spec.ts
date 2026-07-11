import type fs from "fs";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
    fileStore: new Map<string, string>(),
    handlers: new Map<string, (event: unknown, ...args: unknown[]) => unknown>(),
    showMessageBox: vi.fn()
}));

// In-memory shim for the security.json path only; every other fs path falls
// through to the real implementation so the server's already-initialised
// data_dir module is untouched.
vi.mock("fs", async (importOriginal) => {
    const actual = await importOriginal<typeof import("fs") & { default?: typeof import("fs") }>();
    const real = actual.default ?? actual;
    const existsSync = (p: fs.PathLike) =>
        h.fileStore.has(String(p)) ? true : real.existsSync(p);
    const readFileSync = ((p: fs.PathLike, enc?: unknown) =>
        h.fileStore.has(String(p)) ? h.fileStore.get(String(p)) : real.readFileSync(p, enc as never)) as typeof real.readFileSync;
    const writeFileSync = ((p: fs.PathLike, data: string) => {
        h.fileStore.set(String(p), String(data));
    }) as typeof real.writeFileSync;
    const patched = { ...real, existsSync, readFileSync, writeFileSync };
    return { ...actual, default: patched, existsSync, readFileSync, writeFileSync };
});

vi.mock("electron", () => ({
    default: {
        dialog: { showMessageBox: h.showMessageBox },
        ipcMain: {
            handle(channel: string, handler: (event: unknown, ...args: unknown[]) => unknown) {
                h.handlers.set(channel, handler);
            }
        }
    }
}));

vi.mock("i18next", () => ({ t: (key: string) => key }));

const securitySettings = await import("./security_settings.js");
const SETTINGS_PATH = await (async () => {
    const dataDirs = (await import("@triliumnext/server/src/services/data_dir.js")).default;
    const path = (await import("path")).default;
    return path.join(dataDirs.TRILIUM_DATA_DIR, "security.json");
})();

function invoke(channel: string, enabled: boolean) {
    const handler = h.handlers.get(channel);
    if (!handler) throw new Error(`no handler for ${channel}`);
    return handler({}, enabled);
}

describe("security_settings", () => {
    // Register the shared handlers once. The suppression test isolates its own
    // module instance, so it no longer needs to run last.
    beforeAll(() => {
        securitySettings.registerSecurityIpcHandlers();
    });

    beforeEach(() => {
        h.fileStore.clear();
        h.showMessageBox.mockReset();
    });

    describe("getSecuritySettings", () => {
        it("returns defaults when the file is missing", () => {
            expect(securitySettings.getSecuritySettings()).toEqual({});
        });

        it("parses existing settings", () => {
            h.fileStore.set(SETTINGS_PATH, JSON.stringify({ backendScriptingEnabled: true }));
            expect(securitySettings.getSecuritySettings()).toEqual({ backendScriptingEnabled: true });
        });

        it("treats corrupt JSON as defaults", () => {
            h.fileStore.set(SETTINGS_PATH, "{ not valid json");
            expect(securitySettings.getSecuritySettings()).toEqual({});
        });
    });

    describe("registerSecurityIpcHandlers — enabling", () => {
        it("persists when the user confirms an enable", async () => {
            h.showMessageBox.mockResolvedValue({ response: 1, checkboxChecked: false });

            const result = await invoke("security-set-backend-scripting", true);

            expect(result).toBe(true);
            expect(JSON.parse(h.fileStore.get(SETTINGS_PATH) ?? "{}")).toEqual({ backendScriptingEnabled: true });
            // Enable path uses the warning dialog.
            expect(h.showMessageBox.mock.calls[0][0]).toMatchObject({ type: "warning" });
        });

        it("does nothing when the user cancels", async () => {
            h.showMessageBox.mockResolvedValue({ response: 0, checkboxChecked: false });

            const result = await invoke("security-set-sql-console", true);

            expect(result).toBe(false);
            expect(h.fileStore.has(SETTINGS_PATH)).toBe(false);
        });

        it("registers and persists the LAN access toggle", async () => {
            h.showMessageBox.mockResolvedValue({ response: 1, checkboxChecked: false });

            const result = await invoke("security-set-lan-access", true);

            expect(result).toBe(true);
            expect(JSON.parse(h.fileStore.get(SETTINGS_PATH) ?? "{}")).toEqual({ allowLanAccess: true });
        });
    });

    describe("registerSecurityIpcHandlers — disabling", () => {
        it("persists a disable through the info dialog", async () => {
            h.fileStore.set(SETTINGS_PATH, JSON.stringify({ sqlConsoleEnabled: true }));
            h.showMessageBox.mockResolvedValue({ response: 1, checkboxChecked: false });

            const result = await invoke("security-set-sql-console", false);

            expect(result).toBe(true);
            expect(JSON.parse(h.fileStore.get(SETTINGS_PATH) ?? "{}")).toMatchObject({ sqlConsoleEnabled: false });
            expect(h.showMessageBox.mock.calls[0][0]).toMatchObject({ type: "info" });
        });
    });

    describe("don't-ask-again suppression", () => {
        it("suppresses all subsequent dialogs once the checkbox is ticked", async () => {
            // Ticking "don't ask again" latches a module-level flag that never clears.
            // Re-import a throwaway copy of the module so that latch lives only on this
            // isolated instance — it can't leak into other tests (or other spec files
            // sharing the Vitest worker), so this test no longer has to run last.
            vi.resetModules();
            const isolated = await import("./security_settings.js");
            isolated.registerSecurityIpcHandlers();

            h.showMessageBox.mockResolvedValue({ response: 1, checkboxChecked: true });
            expect(await invoke("security-set-backend-scripting", true)).toBe(true);

            h.showMessageBox.mockClear();
            expect(await invoke("security-set-sql-console", true)).toBe(false);
            expect(await invoke("security-set-backend-scripting", false)).toBe(false);
            expect(h.showMessageBox).not.toHaveBeenCalled();

            // Restore the shared, unlatched handlers so run order stays irrelevant.
            securitySettings.registerSecurityIpcHandlers();
        });
    });
});
