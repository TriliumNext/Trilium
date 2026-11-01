import { afterEach, describe, expect, it, vi } from "vitest";

/**
 * The polyfill installs the npm `buffer` implementation as the global Buffer, but only
 * when the environment doesn't already provide one (in the browser it must; under the
 * node-driven test runner a native Buffer already exists). The module runs its check at
 * import time, so each case re-imports it with a fresh module registry.
 */
describe("buffer_polyfill", () => {
    const globalWithBuffer = globalThis as { Buffer?: unknown };
    const nativeBuffer = globalWithBuffer.Buffer;

    afterEach(() => {
        globalWithBuffer.Buffer = nativeBuffer;
        vi.resetModules();
    });

    it("installs the npm buffer polyfill when the global is missing", async () => {
        delete globalWithBuffer.Buffer;

        await import("./buffer_polyfill.js");

        expect(globalWithBuffer.Buffer).toBeDefined();
        expect(globalWithBuffer.Buffer).not.toBe(nativeBuffer);
        // It behaves like Buffer: officeparser round-trips content through from().
        const polyfill = globalWithBuffer.Buffer as { from(s: string): { toString(): string } };
        expect(polyfill.from("office").toString()).toBe("office");
    });

    it("leaves an existing global Buffer untouched", async () => {
        const sentinel = { marker: true };
        globalWithBuffer.Buffer = sentinel;

        await import("./buffer_polyfill.js");

        expect(globalWithBuffer.Buffer).toBe(sentinel);
    });
});
