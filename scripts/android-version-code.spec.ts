import { describe, expect, it } from "vitest";

import { androidVersionCode } from "./android-version-code.mjs";

describe("androidVersionCode", () => {
    it("packs major, minor and patch, with a release above its pre-releases", () => {
        expect(androidVersionCode("0.108.0")).toBe(10_800_099);
        expect(androidVersionCode("0.108.3")).toBe(10_800_399);
        expect(androidVersionCode("1.0.0")).toBe(100_000_099);
        expect(androidVersionCode("20.999.999")).toBe(2_099_999_999);
    });

    it("orders betas below release candidates below the release", () => {
        const codes = [ "0.108.0-beta", "0.108.0-beta.2", "0.108.0-rc", "0.108.0-rc1", "0.108.0-rc.2", "0.108.0" ]
            .map(androidVersionCode);
        expect(codes).toEqual([ 10_800_010, 10_800_012, 10_800_050, 10_800_051, 10_800_052, 10_800_099 ]);
        expect(androidVersionCode("0.107.9")).toBeLessThan(androidVersionCode("0.108.0-beta"));
    });

    it("rejects versions that do not fit a code", () => {
        expect(() => androidVersionCode("0.108")).toThrow();
        expect(() => androidVersionCode("0.108.0-alpha")).toThrow();
        expect(() => androidVersionCode("0.108.0-rc49")).toThrow();
        expect(() => androidVersionCode("0.1000.0")).toThrow();
        expect(() => androidVersionCode("21.0.0")).toThrow();
    });
});
