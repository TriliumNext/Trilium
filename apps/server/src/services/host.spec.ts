import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("host", () => {
    let originalEnv: NodeJS.ProcessEnv;

    beforeEach(() => {
        originalEnv = { ...process.env };
        delete process.env.TRILIUM_HOST;
    });

    afterEach(() => {
        process.env = originalEnv;
        vi.resetModules();
        vi.doUnmock("./config.js");
        vi.doUnmock("./utils.js");
    });

    async function loadHost(opts: { isElectron: boolean; configHost: string }) {
        vi.resetModules();
        vi.doMock("./utils.js", () => ({ isElectron: opts.isElectron }));
        vi.doMock("./config.js", () => ({ default: { Network: { host: opts.configHost } } }));
        return (await import("./host.js")).default;
    }

    it("prefers TRILIUM_HOST env var when not running under Electron", async () => {
        process.env.TRILIUM_HOST = "env-host";
        expect(await loadHost({ isElectron: false, configHost: "config-host" })).toBe("env-host");
    });

    it("ignores TRILIUM_HOST under Electron and falls back to config host", async () => {
        process.env.TRILIUM_HOST = "env-host";
        expect(await loadHost({ isElectron: true, configHost: "config-host" })).toBe("config-host");
    });

    it("uses the config host when no env var is set", async () => {
        expect(await loadHost({ isElectron: false, configHost: "config-host" })).toBe("config-host");
    });

    it("defaults to loopback under Electron when nothing else is set", async () => {
        expect(await loadHost({ isElectron: true, configHost: "" })).toBe("127.0.0.1");
    });

    it("defaults to all interfaces on the server when nothing else is set", async () => {
        expect(await loadHost({ isElectron: false, configHost: "" })).toBe("0.0.0.0");
    });
});
