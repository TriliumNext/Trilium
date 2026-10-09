import { describe, expect, it, vi } from "vitest";

import { stubShareSql } from "../test/shaca_mocking.js";
import sql from "./sql.js";

describe("share provider", () => {
    it("refuses to be read before a platform registers it, then answers through it", async () => {
        // A fresh module instance holds no provider, unlike the one the test setup registered.
        vi.resetModules();
        const { getShareProvider, initShare, isShareReady } = await import("./share_provider.js");

        expect(() => getShareProvider()).toThrow("Share provider has not been initialized");
        expect(isShareReady()).toBe(false);

        let ready = false;
        const provider = {
            sql: { getRawRows: vi.fn(), getRow: vi.fn(), getColumn: vi.fn() },
            readTemplate: vi.fn(),
            isScriptingEnabled: () => false,
            isReady: () => ready
        };
        initShare(provider);

        expect(getShareProvider()).toBe(provider);
        expect(isShareReady()).toBe(false);
        ready = true;
        expect(isShareReady()).toBe(true);
    });

    it("forwards the share cache's queries to the provider, with no parameters by default", () => {
        const getRawRows = vi.fn(() => [ [ "a" ] ]);
        const getRow = vi.fn(() => ({ content: "x" }));
        const getColumn = vi.fn(() => [ "b" ]);
        const restore = stubShareSql({ getRawRows, getRow, getColumn });

        try {
            expect(sql.getRawRows("rows")).toEqual([ [ "a" ] ]);
            expect(sql.getRow("row", [ "1" ])).toEqual({ content: "x" });
            expect(sql.getColumn("column")).toEqual([ "b" ]);
            expect(getRawRows).toHaveBeenCalledWith("rows", []);
            expect(getRow).toHaveBeenCalledWith("row", [ "1" ]);
            expect(getColumn).toHaveBeenCalledWith("column", []);
        } finally {
            restore();
        }
    });
});
