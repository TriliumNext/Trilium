import { describe, expect, it } from "vitest";
import cls from "./cls.js";

describe("Migration", () => {
    it("migrates from v214", async () => {
        await new Promise<void>((resolve) => {
            cls.init(async () => {
                await import("../app.js");

                const sql = (await (import("./sql.js"))).default;
                sql.rebuildIntegrationTestDatabase("spec/db/document_v214.db");

                const migration = (await import("./migration.js")).default;
                await migration.migrateIfNecessary();
                expect(sql.getValue("SELECT count(*) FROM blobs")).toBe(118);
                resolve();
            });
        });
    }, 60_000);
});
