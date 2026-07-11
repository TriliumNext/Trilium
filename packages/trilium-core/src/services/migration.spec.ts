import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { getContext } from "./context.js";
import { getSql } from "./sql/index.js";

// Resolve fixture path relative to this spec file. Spec files only ever run
// under vitest (which uses ESM via Vite), so import.meta.url is available;
// the CLAUDE.md restriction against import.meta.url applies to production
// code that gets bundled to CJS, not to test files.
const __dirname = dirname(fileURLToPath(import.meta.url));

describe("Migration", () => {
    it("migrates from v214", async () => {
        await new Promise<void>((resolve) => {
            getContext().init(async () => {
                const dbBytes = readFileSync(join(__dirname, "../test/fixtures/document_v214.db"));
                getSql().rebuildFromBuffer(dbBytes);

                const migration = (await import("./migration.js")).default;
                await migration.migrateIfNecessary();
                expect(getSql().getValue("SELECT count(*) FROM blobs")).toBe(118);
                resolve();
            });
        });
    }, 60_000);
});
