import { describe, expect, it } from "vitest";

import { defaultBackupName } from "./backup_name.js";

describe("naming a backup", () => {
    it("says what it is and when it was taken", () => {
        expect(defaultBackupName(new Date(2026, 7, 8, 16, 30, 32)))
            .toBe("Trilium data (2026-08-08 16-30-32)");
    });

    it("pads every part, so a directory listing sorts chronologically", () => {
        expect(defaultBackupName(new Date(2026, 0, 2, 3, 4, 5)))
            .toBe("Trilium data (2026-01-02 03-04-05)");
    });

    it("holds nothing a filename cannot, on any platform", () => {
        // A colon is the obvious one: legal on Unix, refused by Windows, and the reason the time
        // is dashed rather than written the way a clock is.
        expect(defaultBackupName(new Date())).not.toMatch(/[<>:"/\\|?*]/);
    });
});
