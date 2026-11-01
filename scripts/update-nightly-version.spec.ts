import { describe, expect, it } from "vitest";

import { processVersion } from "./update-nightly-version";

const DATE = new Date("2026-10-25T14:03:09Z");

describe("processVersion", () => {
    it("bumps the patch of a released version so the nightly sorts above it", () => {
        expect(processVersion("0.106.1", DATE)).toBe("0.106.2-test-261025-140309");
        expect(processVersion("0.106.9", DATE)).toBe("0.106.10-test-261025-140309");
    });

    it("keeps the base of a pre-release and of an existing nightly", () => {
        expect(processVersion("0.107.0-beta", DATE)).toBe("0.107.0-test-261025-140309");
        expect(processVersion("0.107.0-rc1", DATE)).toBe("0.107.0-rc1-test-261025-140309");
        expect(processVersion("0.106.2-test-261024-000000", DATE)).toBe("0.106.2-test-261025-140309");
    });
});
