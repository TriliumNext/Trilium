import { describe, expect, it, vi } from "vitest";

import { getPlatform } from "./platform.js";

describe("platform provider registration", () => {
    it("refuses to be read before a provider is registered", async () => {
        vi.resetModules();
        const fresh = await import("./platform.js");
        const provider = getPlatform();

        expect(() => fresh.getPlatform()).toThrow("Platform provider not initialized");
        fresh.initPlatform(provider);
        expect(fresh.getPlatform()).toBe(provider);
    });
});
