import type { ExistingBackupsResponse } from "@triliumnext/commons";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { getBackup } from "../../services/backup";
import { CoreApiTester } from "../../test/api_tester";

/**
 * Drives the shared core backup routes through {@link CoreApiTester} (no Express).
 *
 * `getExistingBackups` and the download 400/404 paths run against the REAL
 * backup service on both runtimes. The two filesystem-touching service calls
 * are stubbed because the underlying platform I/O cannot run against the
 * ephemeral in-memory fixture: on node, better-sqlite3's `.backup()` rejects
 * with `SQLITE_NOTADB` against the in-memory DB; on standalone (happy-dom)
 * there is no OPFS. So `backupNow` and `getBackupContent` are isolated — the
 * route's own logic (mapping, filename extraction, headers) is what we assert.
 */
let api: CoreApiTester;

describe("Backup API (core)", () => {
    beforeAll(() => {
        api = CoreApiTester.build();
    });

    afterEach(() => {
        vi.restoreAllMocks();
    });

    it("lists existing backups with their folder path (real service)", async () => {
        const res = await api.get<ExistingBackupsResponse>(`/api/database/backups`);
        expect(res.status).toBe(200);
        expect(Array.isArray(res.body.backups)).toBe(true);
        expect(res.body).toHaveProperty("backupFolderPath");
    });

    it("creates a backup and returns the resulting file", async () => {
        vi.spyOn(getBackup(), "backupNow").mockResolvedValue("/backups/backup-now.db");

        const res = await api.post<{ backupFile: string }>(`/api/database/backup-database`);
        expect(res.status).toBe(200);
        expect(res.body).toEqual({ backupFile: "/backups/backup-now.db" });
    });

    describe("downloadBackup", () => {
        it("returns 400 when the filePath query is missing (real)", async () => {
            const res = await api.get<string>(`/api/database/backup/download`);
            expect(res.status).toBe(400);
        });

        it("returns 404 when the backup does not exist (real)", async () => {
            // A path outside the backup dir / non-existent file makes the real
            // service return null on both runtimes.
            const res = await api.get<string>(`/api/database/backup/download`, {
                query: { filePath: "/backups/does-not-exist.db" }
            });
            expect(res.status).toBe(404);
        });

        it("streams the backup content with download headers", async () => {
            vi.spyOn(getBackup(), "getBackupContent").mockResolvedValue(Buffer.from("SQLite format 3 ") as never);

            const res = await api.get(`/api/database/backup/download`, {
                query: { filePath: "/backups/backup-now.db" }
            });
            expect(res.status).toBe(200);
            expect(res.headers["Content-Type"]).toBe("application/x-sqlite3");
            expect(res.headers["Content-Disposition"]).toBe('attachment; filename="backup-now.db"');
        });
    });
});
