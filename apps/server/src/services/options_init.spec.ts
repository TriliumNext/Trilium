import { describe, expect, it } from "vitest";
import { migrateSyncTimeoutFromMilliseconds } from "./options_init.js";

describe("migrateSyncTimeoutFromMilliseconds", () => {
    it("returns null when no migration is needed (values < 1000 are already in seconds)", () => {
        expect(migrateSyncTimeoutFromMilliseconds(120)).toBeNull();
        expect(migrateSyncTimeoutFromMilliseconds(500)).toBeNull();
        expect(migrateSyncTimeoutFromMilliseconds(999)).toBeNull();
        expect(migrateSyncTimeoutFromMilliseconds(NaN)).toBeNull();
    });

    it("converts milliseconds to seconds and sets display scale", () => {
        // Value is always stored in seconds; scale is for display only
        // Divisible by 60 → display as minutes
        expect(migrateSyncTimeoutFromMilliseconds(60000)).toEqual({ value: 60, scale: 60 });    // 60s, display as 1 min
        expect(migrateSyncTimeoutFromMilliseconds(120000)).toEqual({ value: 120, scale: 60 });  // 120s, display as 2 min
        expect(migrateSyncTimeoutFromMilliseconds(3600000)).toEqual({ value: 3600, scale: 60 }); // 3600s, display as 60 min

        // Not divisible by 60 → display as seconds
        expect(migrateSyncTimeoutFromMilliseconds(1000)).toEqual({ value: 1, scale: 1 });
        expect(migrateSyncTimeoutFromMilliseconds(45000)).toEqual({ value: 45, scale: 1 });
        expect(migrateSyncTimeoutFromMilliseconds(90000)).toEqual({ value: 90, scale: 1 });

        // Rounds to nearest second
        expect(migrateSyncTimeoutFromMilliseconds(120500)).toEqual({ value: 121, scale: 1 });
    });
});
