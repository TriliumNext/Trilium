import { afterEach, describe, expect, it, vi } from "vitest";

describe("app_path", () => {
    afterEach(() => {
        vi.resetModules();
        vi.doUnmock("./utils.js");
        vi.doUnmock("./asset_path.js");
    });

    it("uses the asset path unchanged in dev mode", async () => {
        vi.resetModules();
        vi.doMock("./utils.js", () => ({ isDev: true }));
        vi.doMock("./asset_path.js", () => ({ default: "assets/vX" }));

        const mod = await import("./app_path.js");
        expect(mod.default).toBe("assets/vX");
    });

    it("appends /src to the asset path outside dev mode", async () => {
        vi.resetModules();
        vi.doMock("./utils.js", () => ({ isDev: false }));
        vi.doMock("./asset_path.js", () => ({ default: "assets/vX" }));

        const mod = await import("./app_path.js");
        expect(mod.default).toBe("assets/vX/src");
    });
});
