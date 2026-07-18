import { describe, expect, it, vi } from "vitest";

import type { ImageProvider, ProcessedImage } from "./image_provider.js";

describe("image provider (core)", () => {
    // The core bootstrap installs a real image provider, so to exercise the
    // uninitialized guard we load a pristine copy of the module via resetModules.
    it("throws before initialization and returns the installed provider afterwards", async () => {
        vi.resetModules();
        const mod = await import("./image_provider.js");

        expect(() => mod.getImageProvider()).toThrow(/not initialized/);

        const fake: ImageProvider = {
            getImageType: vi.fn(() => ({ ext: "png", mime: "image/png" })),
            processImage: vi.fn(async (): Promise<ProcessedImage> => ({
                buffer: new Uint8Array(),
                format: { ext: "png", mime: "image/png" }
            }))
        };
        mod.initImageProvider(fake);
        expect(mod.getImageProvider()).toBe(fake);
    });
});
