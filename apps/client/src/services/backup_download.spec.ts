import { afterEach, describe, expect, it, vi } from "vitest";

import { backupFileName, isBackupDownloadSupported, startBackupDownload } from "./backup_download";

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

describe("taking the backup", () => {
    const realWindow = window as unknown as { standaloneApi?: unknown };

    afterEach(() => {
        delete realWindow.standaloneApi;
    });

    it("hands the backup to the device where one saves it, and to the browser otherwise", async () => {
        const downloadDatabase = vi.fn(async () => ({ status: "done" as const }));
        const saveDatabase = vi.fn(async () => ({
            status: "done" as const,
            location: "/documents/Trilium/b.tnbackup"
        }));
        const onProgress = vi.fn();

        realWindow.standaloneApi = { backup: { downloadDatabase } };
        expect(await startBackupDownload("b.tnbackup", "pw", onProgress)).toEqual({ status: "done" });
        expect(downloadDatabase).toHaveBeenCalledWith("b.tnbackup", "pw", onProgress);

        // The mobile shell has no download manager, so it writes the file itself and says where.
        realWindow.standaloneApi = { backup: { downloadDatabase, saveDatabase } };
        expect(await startBackupDownload("b.tnbackup", "pw", onProgress)).toEqual({
            status: "done",
            location: "/documents/Trilium/b.tnbackup"
        });
        expect(saveDatabase).toHaveBeenCalledWith("b.tnbackup", "pw", onProgress);
        expect(downloadDatabase).toHaveBeenCalledTimes(1);
    });

    it("passes no passphrase at all for an empty one, and fails where nothing backs up this way", async () => {
        const downloadDatabase = vi.fn(async () => ({ status: "done" as const }));
        realWindow.standaloneApi = { backup: { downloadDatabase } };

        await startBackupDownload("b.tnbackup", "");
        // An empty string would be a passphrase, and would lock the container with it.
        expect(downloadDatabase).toHaveBeenCalledWith("b.tnbackup", undefined, undefined);

        delete realWindow.standaloneApi;
        expect(isBackupDownloadSupported()).toBe(false);
        expect(await startBackupDownload("b.tnbackup")).toMatchObject({ status: "failed" });
    });
});
