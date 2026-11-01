import { afterEach, describe, expect, it, vi } from "vitest";

import StandalonePlatformProvider from "./platform_provider.js";

describe("StandalonePlatformProvider", () => {
    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("exposes the standalone platform flags", () => {
        const provider = new StandalonePlatformProvider("");
        expect(provider.isElectron).toBe(false);
        expect(provider.isStandalone).toBe(true);
    });

    it.each([
        ["MacIntel", "Mozilla/5.0 (Macintosh)", { isMac: true, isWindows: false, isLinux: false }],
        ["Win32", "Mozilla/5.0 (Windows NT 10.0)", { isMac: false, isWindows: true, isLinux: false }],
        ["Linux x86_64", "Mozilla/5.0 (X11; Linux x86_64)", { isMac: false, isWindows: false, isLinux: true }],
        // Android reports a Linux platform, but is not desktop Linux.
        ["Linux armv8l", "Mozilla/5.0 (Linux; Android 14)", { isMac: false, isWindows: false, isLinux: false }],
        ["iPhone", "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0)", { isMac: false, isWindows: false, isLinux: false }]
    ])("reads the host OS from navigator.platform %s", (platform, userAgent, expected) => {
        vi.spyOn(navigator, "platform", "get").mockReturnValue(platform);
        vi.spyOn(navigator, "userAgent", "get").mockReturnValue(userAgent);

        const provider = new StandalonePlatformProvider("");
        expect({ isMac: provider.isMac, isWindows: provider.isWindows, isLinux: provider.isLinux }).toEqual(expected);
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
