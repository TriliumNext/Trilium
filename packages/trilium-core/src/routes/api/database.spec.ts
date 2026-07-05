import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import sqlInit from "../../services/sql_init";
import { getSql } from "../../services/sql/index";
import { CoreApiTester } from "../../test/api_tester";
import { WIPE_DATABASE_CONFIRMATION } from "./database";

/**
 * Drives the shared core database routes through {@link CoreApiTester} (no Express), so this spec
 * runs under both the node (better-sqlite3) and standalone (WASM) suites. The actual wiping is
 * covered by sql_init.spec.ts; here we only exercise the route's confirmation guard, mocking
 * {@link sqlInit.wipeDatabase} so the shared fixture DB is left intact.
 */
let api: CoreApiTester;

describe("Database API (core)", () => {
    beforeAll(() => {
        api = CoreApiTester.build();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("rejects a wipe with an incorrect confirmation (400) and does not touch the database", async () => {
        const wipe = vi.spyOn(sqlInit, "wipeDatabase").mockResolvedValue(undefined);

        const res = await api.post("/api/database/wipe", { query: { really: "nope" } });

        expect(res.status).toBe(400);
        expect(wipe).not.toHaveBeenCalled();
        // The fixture DB is still initialized and populated.
        expect(sqlInit.isDbInitialized()).toBe(true);
        expect(getSql().getValue<number>("SELECT COUNT(*) FROM notes")).toBeGreaterThan(0);
    });

    it("wipes the database when the correct confirmation magic string is provided", async () => {
        const wipe = vi.spyOn(sqlInit, "wipeDatabase").mockResolvedValue(undefined);

        const res = await api.post<{ success: boolean }>("/api/database/wipe", {
            query: { really: WIPE_DATABASE_CONFIRMATION }
        });

        expect(res.status).toBe(200);
        expect(res.body.success).toBe(true);
        expect(wipe).toHaveBeenCalledOnce();
    });
});
