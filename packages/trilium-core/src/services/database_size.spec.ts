import { describe, expect, it } from "vitest";

import { getDatabaseSizeBytes, getReclaimableBytes } from "./database_size.js";

describe("database size", () => {
    it("measures the database through pragmas, on every engine the core runs on", () => {
        const size = getDatabaseSizeBytes();
        const reclaimable = getReclaimableBytes();

        // Runs against better-sqlite3 under the server suite and against sql.js under the standalone
        // one: pragma functions are the part of this worth pinning down, since only one of the two
        // engines is the one these figures were first written for.
        expect(size).toBeGreaterThan(0);
        expect(reclaimable).toBeGreaterThanOrEqual(0);
        expect(reclaimable).toBeLessThan(size);
    });
});
