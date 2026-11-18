import { describe, expect, it, vi } from "vitest";

import {
    getPlatform, initPlatform, type PlatformProvider, whenDatabaseFree
} from "./platform.js";

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

describe("whenDatabaseFree", () => {
    it("runs the write through the provider's whenDatabaseFree, else at once", async () => {
        const provider = getPlatform();
        const queue = vi.fn();
        try {
            initPlatform(withQueue(provider, undefined));
            expect(await whenDatabaseFree(() => "at once")).toBe("at once");
            initPlatform(withQueue(provider, (fn) => {
                queue();
                return fn();
            }));
            expect(await whenDatabaseFree(() => "queued")).toBe("queued");
            expect(queue).toHaveBeenCalledOnce();
        } finally {
            initPlatform(provider);
        }
    });
});

/** `provider` with `whenDatabaseFree` replaced and every other member kept. */
function withQueue(
    provider: PlatformProvider, whenDatabaseFree: PlatformProvider["whenDatabaseFree"]
): PlatformProvider {
    return Object.assign(Object.create(provider) as PlatformProvider, { whenDatabaseFree });
}
