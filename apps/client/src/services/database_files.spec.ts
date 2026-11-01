import { describe, expect, it, vi } from "vitest";

// i18next is never initialised in these tests, so t() would return nothing at all. Echoing the key
// keeps the assertions about which sentence is chosen rather than about its English.
vi.mock("./i18n.js", () => ({
    t: (key: string, values?: Record<string, unknown>) =>
        [ key, ...Object.values(values ?? {}) ].join(" ")
}));

import { describeDatabaseFile } from "./database_files.js";

const FILE = {
    fileName: "backup-daily.tnbackup",
    filePath: "/data/backup/backup-daily.tnbackup",
    mtime: new Date("2026-02-03T04:05:06Z"),
    fileSize: 2 * 1024 * 1024
};

describe("the line under a backup's name", () => {
    it("states when it was taken and how big it is", () => {
        expect(describeDatabaseFile(FILE)).toContain("2 MiB");
        expect(describeDatabaseFile(FILE)).not.toContain("database_file_list");
    });

    it("states both sizes for a backup smaller than the database it was made from", () => {
        const described = describeDatabaseFile({ ...FILE, plaintextSize: 8 * 1024 * 1024 });

        expect(described).toContain("8 MiB");
        expect(described).toContain("database_file_list.size_on_disk 2 MiB");
    });

    it.each([
        [ "invalid" as const, "database_file_list.invalid_backup" ],
        [ "unsupported-version" as const, "database_file_list.unsupported_version" ]
    ])("says a %s backup cannot be restored from, without dropping what it is", (
        unreadable,
        expected
    ) => {
        const described = describeDatabaseFile({ ...FILE, unreadable });

        expect(described.endsWith(expected)).toBe(true);
        // The date and the size stay: a backup that stopped halfway is the size of how far it got,
        // which is what tells the user why this one is no good.
        expect(described).toContain("2 MiB");
    });
});
