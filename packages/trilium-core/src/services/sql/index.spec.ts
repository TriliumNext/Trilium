import { describe, expect, it } from "vitest";

import { getSql, initSql } from "./index.js";

describe("initSql", () => {
    it("refuses to replace an already initialized service", async () => {
        await expect(initSql(getSql())).rejects.toThrow("SQL already initialized");
    });
});
