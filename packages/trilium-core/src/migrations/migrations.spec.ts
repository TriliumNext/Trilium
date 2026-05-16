import { describe, expect, it } from "vitest";

import MIGRATIONS from "./migrations.js";

describe("migrations", () => {
    it("should have unique version numbers", () => {
        const versions = MIGRATIONS.map((m) => m.version);
        const uniqueVersions = new Set(versions);
        expect(versions.length).toBe(uniqueVersions.size);
    });

    it("should be sorted in descending order by version", () => {
        for (let i = 1; i < MIGRATIONS.length; i++) {
            expect(MIGRATIONS[i - 1].version, `migration at index ${i - 1} (v${MIGRATIONS[i - 1].version}) should be greater than migration at index ${i} (v${MIGRATIONS[i].version})`).toBeGreaterThan(MIGRATIONS[i].version);
        }
    });
});
