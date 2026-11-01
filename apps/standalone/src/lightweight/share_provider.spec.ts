import type { ShareProvider } from "@triliumnext/core/src/share/share_provider.js";
import { afterEach, describe, expect, it, vi } from "vitest";

describe("registerShareProvider", () => {
    afterEach(() => {
        vi.doUnmock("@triliumnext/core");
        vi.doUnmock("@triliumnext/core/src/share/index.js");
        vi.resetModules();
    });

    it("registers once, reading the worker's database and the bundled templates", async () => {
        const sql = {
            getRawRows: vi.fn(() => [ [ "row" ] ]),
            getRow: vi.fn(() => ({ id: "row" })),
            getColumn: vi.fn(() => [ "value" ])
        };
        const initShare = vi.fn<(provider: ShareProvider) => void>();
        vi.resetModules();
        vi.doMock("@triliumnext/core", () => ({ getSql: () => sql }));
        vi.doMock("@triliumnext/core/src/share/index.js", () => ({ initShare }));
        const { registerShareProvider } = await import("./share_provider.js");

        registerShareProvider();
        registerShareProvider();

        expect(initShare).toHaveBeenCalledOnce();
        const provider = initShare.mock.calls[0][0];
        expect(provider.sql.getRawRows("SELECT 1")).toStrictEqual([ [ "row" ] ]);
        expect(provider.sql.getRow("SELECT 2", [ "a" ])).toStrictEqual({ id: "row" });
        expect(provider.sql.getColumn("SELECT 3")).toStrictEqual([ "value" ]);
        provider.sql.getRawRows("SELECT 4", [ "b" ]);
        provider.sql.getColumn("SELECT 5", [ "c" ]);
        provider.sql.getRow("SELECT 6");
        const { getRawRows, getRow, getColumn } = sql;
        expect([ ...getRawRows.mock.calls, ...getRow.mock.calls, ...getColumn.mock.calls ])
            .toStrictEqual([
                [ "SELECT 1", [] ], [ "SELECT 4", [ "b" ] ],
                [ "SELECT 2", [ "a" ] ], [ "SELECT 6", [] ],
                [ "SELECT 3", [] ], [ "SELECT 5", [ "c" ] ]
            ]);
        expect(provider.readTemplate("page")).toContain("<html");
        expect(() => provider.readTemplate("missing")).toThrow("Unknown share template 'missing'.");
        expect(provider.isScriptingEnabled()).toBe(false);
        expect(provider.isReady()).toBe(true);
    });
});
