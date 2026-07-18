import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

describe("port", () => {
    let originalEnv: NodeJS.ProcessEnv;

    beforeEach(() => {
        originalEnv = { ...process.env };
        delete process.env.TRILIUM_PORT;
    });

    afterEach(() => {
        process.env = originalEnv;
        vi.resetModules();
        vi.doUnmock("./config.js");
        vi.doUnmock("./utils.js");
        vi.doUnmock("./data_dir.js");
        vi.restoreAllMocks();
    });

    async function loadPort(opts: { isElectron: boolean; isDev: boolean; configPort: string }) {
        vi.resetModules();
        vi.doMock("./utils.js", () => ({ isDev: opts.isDev, isElectron: opts.isElectron }));
        vi.doMock("./config.js", () => ({ default: { Network: { port: opts.configPort } } }));
        vi.doMock("./data_dir.js", () => ({ default: { CONFIG_INI_PATH: "/test/config.ini" } }));
        return (await import("./port.js")).default;
    }

    it("uses TRILIUM_PORT env var when valid", async () => {
        process.env.TRILIUM_PORT = "8123";
        expect(await loadPort({ isElectron: false, isDev: false, configPort: "3000" })).toBe(8123);
    });

    it("exits on an invalid TRILIUM_PORT env var", async () => {
        process.env.TRILIUM_PORT = "not-a-number";
        const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {
            throw new Error("exit");
        }) as never);
        vi.spyOn(console, "log").mockImplementation(() => {});

        await expect(loadPort({ isElectron: false, isDev: false, configPort: "3000" })).rejects.toThrow("exit");
        expect(exitSpy).toHaveBeenCalledWith(-1);
    });

    it("uses the Electron dev default port", async () => {
        expect(await loadPort({ isElectron: true, isDev: true, configPort: "3000" })).toBe(37740);
    });

    it("uses the Electron prod default port", async () => {
        expect(await loadPort({ isElectron: true, isDev: false, configPort: "3000" })).toBe(37840);
    });

    it("falls back to the config port", async () => {
        expect(await loadPort({ isElectron: false, isDev: false, configPort: "9000" })).toBe(9000);
    });

    it("defaults to 3000 when the config port is empty", async () => {
        expect(await loadPort({ isElectron: false, isDev: false, configPort: "" })).toBe(3000);
    });

    it("exits on an out-of-range config port", async () => {
        const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {
            throw new Error("exit");
        }) as never);
        vi.spyOn(console, "log").mockImplementation(() => {});

        await expect(loadPort({ isElectron: false, isDev: false, configPort: "70000" })).rejects.toThrow("exit");
        expect(exitSpy).toHaveBeenCalledWith(-1);
    });
});
