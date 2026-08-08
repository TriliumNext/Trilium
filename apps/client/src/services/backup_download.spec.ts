import { describe, expect, it } from "vitest";

import { backupFileName } from "./backup_download";

// What the suggested name itself looks like is settled in commons, which every platform shares;
// this is about the file that name becomes.
describe("naming a backup file", () => {
    it("adds the container extension, and tidies what only fails at save time", () => {
        // Parentheses are legal everywhere, so the suggested name survives its own round trip.
        expect(backupFileName("Trilium data (2026-08-08 16-30-32)"))
            .toBe("Trilium data (2026-08-08 16-30-32).tnbackup");
        // What a name may contain at all is the field's business and has its own tests; this is
        // the last pass, for a name that never went through that field.
        expect(backupFileName('a<b>c:d"e/f\\g|h?i*j')).toBe("abcdefghij.tnbackup");
        // Legal to type, impossible to save on Windows, so it goes on the way out rather than
        // under the cursor.
        expect(backupFileName("My backup...")).toBe("My backup.tnbackup");
        expect(backupFileName("  spaced  ")).toBe("spaced.tnbackup");
    });

    it("falls back to the default name where nothing usable is left", () => {
        const dated = /^Trilium data \(\d{4}-\d{2}-\d{2} \d{2}-\d{2}-\d{2}\)\.tnbackup$/;

        expect(backupFileName("")).toMatch(dated);
        expect(backupFileName("///")).toMatch(dated);
        // A Windows device name is not a file there, whatever it is called afterwards.
        expect(backupFileName("NUL")).toMatch(dated);
        expect(backupFileName("com1")).toMatch(dated);
    });
});
