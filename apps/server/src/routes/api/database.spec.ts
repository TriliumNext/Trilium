import { getBackup, ValidationError } from "@triliumnext/core";
import type { Request, Response } from "express";
import fs from "fs";
import path from "path";
import { describe, expect, it, vi } from "vitest";

import anonymizationService from "../../services/anonymization.js";
import dataDir from "../../services/data_dir.js";
import databaseRoute from "./database.js";

function fakeRes() {
    const calls: { status?: number; body?: unknown; download?: unknown[] } = {};
    const res = {
        status(code: number) { calls.status = code; return this; },
        send(body: unknown) { calls.body = body; return this; },
        download(...args: unknown[]) { calls.download = args; return this; }
    } as unknown as Response;
    return { res, calls };
}

describe("Database API", () => {
    it("returns existing backups and anonymized databases", async () => {
        expect(Array.isArray(await databaseRoute.getExistingBackups())).toBe(true);

        const { anonymizedFolderPath, databases } = databaseRoute.getExistingAnonymizedDatabases();
        expect(anonymizedFolderPath).toBe(path.resolve(dataDir.ANONYMIZED_DB_DIR));
        expect(Array.isArray(databases)).toBe(true);
    });

    it("runs an integrity check that reports 'ok'", () => {
        const result = databaseRoute.checkIntegrity();
        expect(result.results[0].integrity_check).toBe("ok");
    });

    it("vacuums the database without throwing", () => {
        expect(() => databaseRoute.vacuumDatabase()).not.toThrow();
    });

    it("kicks off on-demand consistency checks", () => {
        expect(() => databaseRoute.findAndFixConsistencyIssues()).not.toThrow();
    });

    it("backs up the database (provider mocked — fixture isn't a real file DB)", async () => {
        const spy = vi.spyOn(getBackup(), "backupNow").mockResolvedValue("now-backup");
        const result = await databaseRoute.backupDatabase();
        expect(result).toEqual({ backupFile: "now-backup" });
        spy.mockRestore();
    });

    it("rejects an unknown anonymization type", async () => {
        const req = { params: { type: "bogus" } } as unknown as Request;
        await expect(databaseRoute.anonymize(req)).rejects.toBeInstanceOf(ValidationError);
    });

    it("anonymizes with a valid type (service mocked)", async () => {
        const spy = vi.spyOn(anonymizationService, "createAnonymizedCopy")
            .mockResolvedValue({ success: true, anonymizedFilePath: "/tmp/x.db" });
        const req = { params: { type: "light" } } as unknown as Request;
        const result = await databaseRoute.anonymize(req);
        expect(result).toEqual({ success: true, anonymizedFilePath: "/tmp/x.db" });
        spy.mockRestore();
    });

    describe("downloadBackup error handling", () => {
        it("returns 400 when filePath is missing", () => {
            const { res, calls } = fakeRes();
            databaseRoute.downloadBackup({ query: {} } as unknown as Request, res);
            expect(calls.status).toBe(400);
        });

        it("returns 403 for a path outside the backup directory", () => {
            const { res, calls } = fakeRes();
            databaseRoute.downloadBackup({ query: { filePath: "/etc/passwd" } } as unknown as Request, res);
            expect(calls.status).toBe(403);
        });

        it("returns 404 for a non-existent file inside the backup directory", () => {
            const { res, calls } = fakeRes();
            const filePath = path.join(dataDir.BACKUP_DIR, "missing-backup.db");
            databaseRoute.downloadBackup({ query: { filePath } } as unknown as Request, res);
            expect(calls.status).toBe(404);
        });

        it("streams an existing backup file via res.download", () => {
            const filePath = path.join(dataDir.BACKUP_DIR, "spec-backup.db");
            fs.mkdirSync(dataDir.BACKUP_DIR, { recursive: true });
            fs.writeFileSync(filePath, "backup-bytes");
            try {
                const { res, calls } = fakeRes();
                databaseRoute.downloadBackup({ query: { filePath } } as unknown as Request, res);
                const downloadArgs = calls.download ?? [];
                expect(downloadArgs[0]).toBe(path.resolve(filePath));
                // A timestamped download filename is generated from the file mtime.
                expect(String(downloadArgs[1])).toMatch(/spec-backup_.*\.db/);
            } finally {
                fs.rmSync(filePath, { force: true });
            }
        });
    });

    describe("downloadAnonymizedDatabase", () => {
        it("is restricted to the anonymized-db directory", () => {
            // A backup file path is valid for downloadBackup but must be rejected here.
            const { res, calls } = fakeRes();
            const filePath = path.join(dataDir.BACKUP_DIR, "backup-now.db");
            databaseRoute.downloadAnonymizedDatabase({ query: { filePath } } as unknown as Request, res);
            expect(calls.status).toBe(403);
        });

        it("streams an existing anonymized database via res.download", () => {
            const filePath = path.join(dataDir.ANONYMIZED_DB_DIR, "anonymized-light-spec.db");
            fs.mkdirSync(dataDir.ANONYMIZED_DB_DIR, { recursive: true });
            fs.writeFileSync(filePath, "anonymized-bytes");
            try {
                const { res, calls } = fakeRes();
                databaseRoute.downloadAnonymizedDatabase({ query: { filePath } } as unknown as Request, res);
                const downloadArgs = calls.download ?? [];
                expect(downloadArgs[0]).toBe(path.resolve(filePath));
                expect(String(downloadArgs[1])).toMatch(/anonymized-light-spec_.*\.db/);
            } finally {
                fs.rmSync(filePath, { force: true });
            }
        });
    });
});
