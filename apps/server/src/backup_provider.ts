import type { DatabaseBackup } from "@triliumnext/commons";
import { BackupOptionsService, BackupService, sync_mutex as syncMutexService } from "@triliumnext/core";
import fs from "fs";
import path from "path";

import dataDir from "./services/data_dir.js";
import log from "./services/log.js";
import sql from "./services/sql.js";

export default class ServerBackupService extends BackupService {
    constructor(options: BackupOptionsService) {
        super(options);
    }

    override async getExistingBackups(): Promise<DatabaseBackup[]> {
        if (!fs.existsSync(dataDir.BACKUP_DIR)) {
            return [];
        }

        return fs
            .readdirSync(dataDir.BACKUP_DIR)
            .filter((fileName) => fileName.includes("backup"))
            .map((fileName) => {
                const filePath = path.resolve(dataDir.BACKUP_DIR, fileName);
                const stat = fs.statSync(filePath);

                return { fileName, filePath, mtime: stat.mtime };
            });
    }

    override scheduleBackups(): void {
        // Run regular backups every 4 hours
        setInterval(() => this.regularBackup(), 4 * 60 * 60 * 1000);

        // Kickoff first backup soon after startup
        setTimeout(() => this.regularBackup(), 5 * 60 * 1000);
    }

    override async backupNow(name: string): Promise<string> {
        // we don't want to back up DB in the middle of sync with potentially inconsistent DB state
        return await syncMutexService.doExclusively(async () => {
            const backupFile = path.resolve(`${dataDir.BACKUP_DIR}/backup-${name}.db`);

            if (!fs.existsSync(dataDir.BACKUP_DIR)) {
                fs.mkdirSync(dataDir.BACKUP_DIR, 0o700);
            }

            log.info("Creating backup...");
            await sql.copyDatabase(backupFile);
            log.info(`Created backup at ${backupFile}`);

            return backupFile;
        });
    }

    override async getBackupContent(filePath: string): Promise<Uint8Array | null> {
        const resolvedPath = path.resolve(filePath);
        const backupDir = path.resolve(dataDir.BACKUP_DIR);

        // Security check: ensure the path is within the backup directory
        if (!resolvedPath.startsWith(backupDir + path.sep)) {
            return null;
        }

        if (!fs.existsSync(resolvedPath)) {
            return null;
        }

        return fs.readFileSync(resolvedPath);
    }
}
