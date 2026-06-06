import { describe, expect, it } from "vitest";

import sqlProxy from "./sql.js";

describe("sql proxy", () => {
    it("forwards function and non-function properties through the lazy proxy", () => {
        // Function branch of the `typeof value === "function"` ternary: the
        // bound method runs a real query against the booted in-memory DB.
        expect(typeof (sqlProxy as { getValue: unknown }).getValue).toBe("function");
        const one = sqlProxy.getValue<number>("SELECT 1");
        expect(one).toBe(1);

        // Non-function branch: an instance data property (the statement cache)
        // is returned directly, not bound.
        const cache = (sqlProxy as unknown as { statementCache: unknown }).statementCache;
        expect(typeof cache).toBe("object");
    });
});
