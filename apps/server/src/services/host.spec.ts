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

    async function loadHost(opts: { isElectron: boolean; configHost?: string; allowLanAccess?: boolean }) {
        vi.resetModules();
        vi.doMock("./utils.js", () => ({ isElectron: opts.isElectron }));
        vi.doMock("./config.js", () => ({
            default: {
                Network: { host: opts.configHost ?? "" },
                Security: { allowLanAccess: opts.allowLanAccess ?? false }
            }
        }));
        return (await import("./host.js")).default;
    }

    // Desktop: the [Network] host config (and TRILIUM_HOST) are for web
    // deployments — the listener binds loopback unless LAN access is allowed.
    it("binds loopback under Electron, ignoring the config host and TRILIUM_HOST", async () => {
        process.env.TRILIUM_HOST = "env-host";
        expect(await loadHost({ isElectron: true, configHost: "config-host" })).toBe("127.0.0.1");
    });

    it("binds all interfaces under Electron when LAN access is allowed", async () => {
        expect(await loadHost({ isElectron: true, allowLanAccess: true })).toBe("0.0.0.0");
    });

    // Server: TRILIUM_HOST > config host > all-interfaces default.
    it("prefers TRILIUM_HOST env var on the server", async () => {
        process.env.TRILIUM_HOST = "env-host";
        expect(await loadHost({ isElectron: false, configHost: "config-host" })).toBe("env-host");
    });

    it("uses the config host on the server when no env var is set", async () => {
        expect(await loadHost({ isElectron: false, configHost: "config-host" })).toBe("config-host");
    });

    // The all-interfaces default lives in the config layer (configMapping.Network.host),
    // so host.ts just returns whatever config resolves — here, that default.
    it("returns the all-interfaces config default on the server", async () => {
        expect(await loadHost({ isElectron: false, configHost: "0.0.0.0" })).toBe("0.0.0.0");
    });
});
