import { getLog } from "@triliumnext/core";
import { afterEach, describe, expect, it, vi } from "vitest";

// platform_provider is loaded during boot (setup.ts), so vi.mock can't intercept
// its deps — spy on the real (singleton) getLog and process.exit instead.
import ServerPlatformProvider from "./platform_provider.js";

afterEach(() => vi.restoreAllMocks());

describe("ServerPlatformProvider", () => {
    it("reflects the runtime platform flags", () => {
        const provider = new ServerPlatformProvider();
        expect(provider.isElectron).toBe(!!process.versions["electron"]);
        expect(provider.isMac).toBe(process.platform === "darwin");
        expect(provider.isWindows).toBe(process.platform === "win32");
        expect(provider.isLinux).toBe(process.platform === "linux");
    });

    it("reads environment variables via getEnv", () => {
        const provider = new ServerPlatformProvider();
        process.env.__PP_TEST__ = "yes";
        expect(provider.getEnv("__PP_TEST__")).toBe("yes");
        expect(provider.getEnv("__PP_ABSENT__")).toBeUndefined();
        delete process.env.__PP_TEST__;
    });

    it("crash() banners the message and exits with code 1", () => {
        const bannerSpy = vi.spyOn(getLog(), "banner").mockImplementation(() => {});
        const exitSpy = vi.spyOn(process, "exit").mockImplementation((() => {
            throw new Error("exit");
        }) as never);

        const provider = new ServerPlatformProvider();
        expect(() => provider.crash("fatal boom")).toThrow("exit");
        expect(bannerSpy).toHaveBeenCalledWith("fatal boom");
        expect(exitSpy).toHaveBeenCalledWith(1);
    });
});
