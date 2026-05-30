import { afterEach, describe, expect, it, vi } from "vitest";

import packageJson from "../../package.json" with { type: "json" };

describe("asset_path", () => {
    afterEach(() => {
        vi.resetModules();
        vi.doUnmock("./utils");
    });

    it("appends /src suffix in dev mode", async () => {
        vi.resetModules();
        vi.doMock("./utils", () => ({ isDev: true }));

        const mod = await import("./asset_path.js");
        expect(mod.assetUrlFragment).toBe(`assets/v${packageJson.version}`);
        expect(mod.default).toBe(`assets/v${packageJson.version}/src`);
    });

    it("omits /src suffix outside dev mode", async () => {
        vi.resetModules();
        vi.doMock("./utils", () => ({ isDev: false }));

        const mod = await import("./asset_path.js");
        expect(mod.default).toBe(`assets/v${packageJson.version}`);
    });
});
