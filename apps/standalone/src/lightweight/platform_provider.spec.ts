import { afterEach, describe, expect, it, vi } from "vitest";

import StandalonePlatformProvider from "./platform_provider.js";

describe("StandalonePlatformProvider", () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("exposes the standalone platform flags", () => {
        const provider = new StandalonePlatformProvider("");
        expect(provider.isElectron).toBe(false);
        expect(provider.isMac).toBe(false);
        expect(provider.isWindows).toBe(false);
    });

    it("maps known query parameters to TRILIUM_ env vars", () => {
        const provider = new StandalonePlatformProvider("?safeMode=1&startNoteId=abc123");
        expect(provider.getEnv("TRILIUM_SAFE_MODE")).toBe("1");
        expect(provider.getEnv("TRILIUM_START_NOTE_ID")).toBe("abc123");
    });

    it("defaults a valueless query flag to \"true\"", () => {
        const provider = new StandalonePlatformProvider("?safeMode");
        expect(provider.getEnv("TRILIUM_SAFE_MODE")).toBe("true");
    });

    it("ignores unknown query parameters and returns undefined for unset env", () => {
        const provider = new StandalonePlatformProvider("?unknown=x");
        expect(provider.getEnv("TRILIUM_SAFE_MODE")).toBeUndefined();
        expect(provider.getEnv("TRILIUM_START_NOTE_ID")).toBeUndefined();
    });

    it("crash() logs and posts a FATAL_ERROR message", () => {
        const consoleSpy = vi.spyOn(console, "error").mockImplementation(() => {});
        const postSpy = vi.spyOn(self, "postMessage").mockImplementation(() => {});

        const provider = new StandalonePlatformProvider("");
        provider.crash("boom");

        expect(consoleSpy).toHaveBeenCalledWith("[Standalone] FATAL:", "boom");
        expect(postSpy).toHaveBeenCalledWith({ type: "FATAL_ERROR", message: "boom" });
    });
});
