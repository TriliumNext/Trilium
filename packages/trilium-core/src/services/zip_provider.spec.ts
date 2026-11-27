import { describe, expect, it, vi } from "vitest";

import { getZipProvider } from "./zip_provider.js";

describe("zip provider registration", () => {
    it("refuses to be read before a provider is registered", async () => {
        vi.resetModules();
        const fresh = await import("./zip_provider.js");
        const provider = getZipProvider();

        expect(() => fresh.getZipProvider()).toThrow("ZipProvider not initialized.");
        fresh.initZipProvider(provider);
        expect(fresh.getZipProvider()).toBe(provider);
    });
});
