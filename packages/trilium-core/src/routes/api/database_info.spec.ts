import { describe, expect, it } from "vitest";

import becca from "../../becca/becca.js";
import { getDatabaseSizeBytes } from "../../services/database_size.js";
import { getPlatform } from "../../services/platform.js";
import databaseInfoRoute from "./database_info.js";

describe("database info", () => {
    it("describes the database: where it is, when it began, what it holds and how large it is", () => {
        const info = databaseInfoRoute.getDatabaseInfo();

        // Whatever the platform answers, including nothing at all: the browser build keeps the
        // database in storage that has no path, and the page names the storage instead.
        expect(info.filePath).toBe(getPlatform().getDatabasePath?.() ?? null);

        // SQLite records nothing about when a file was made, so the root note answers for it.
        expect(info.utcDateCreated).toBe(becca.getNoteOrThrow("root").utcDateCreated);

        // Measured through the same pragmas everything else measures the database with.
        expect(info.sizeBytes).toBe(getDatabaseSizeBytes());

        // Counted, and the hidden subtree — launchers, options, templates — left out of the count.
        expect(info.noteCount).toBeGreaterThan(0);
        expect(info.noteCount).toBeLessThan(Object.keys(becca.notes).length);
        expect(info.attachmentCount).toBeGreaterThanOrEqual(0);
    });
});
