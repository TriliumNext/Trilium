import fs from "fs";
import path from "path";
import { afterAll, describe, expect, it } from "vitest";

import ServerBackupService from "./backup_provider.js";
import dataDir from "./services/data_dir.js";

const service = new ServerBackupService({
    getOption: () => "",
    getOptionBool: () => false,
    setOption: () => {}
});

const dbFile = path.join(dataDir.BACKUP_DIR, "backup-spec-list.db");
const journalFile = path.join(dataDir.BACKUP_DIR, "backup-spec-list.db-journal");

describe("ServerBackupService", () => {
    afterAll(() => {
        fs.rmSync(dbFile, { force: true });
        fs.rmSync(journalFile, { force: true });
    });

    it("lists .db backups with their size, excluding intermediate SQLite files", async () => {
        fs.mkdirSync(dataDir.BACKUP_DIR, { recursive: true });
        fs.writeFileSync(dbFile, "backup-bytes");
        fs.writeFileSync(journalFile, "journal-bytes");

        const backups = await service.getExistingBackups();
        const names = backups.map((b) => b.fileName);
        expect(names).toContain("backup-spec-list.db");
        expect(names).not.toContain("backup-spec-list.db-journal");

        const entry = backups.find((b) => b.fileName === "backup-spec-list.db");
        expect(entry?.fileSize).toBe("backup-bytes".length);
        expect(entry?.filePath).toBe(path.resolve(dataDir.BACKUP_DIR, "backup-spec-list.db"));
        expect(entry?.mtime).toBeInstanceOf(Date);
    });

    it("reports the backup folder path", () => {
        expect(service.getBackupFolderPath()).toBe(path.resolve(dataDir.BACKUP_DIR));
    });
});
