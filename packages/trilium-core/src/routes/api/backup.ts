import type { BackupDatabaseNowResponse, ExistingBackupsResponse } from "@triliumnext/commons";
import { getBackup } from "../../services/backup.js";
import { Request, Response } from "express";

async function getExistingBackups(): Promise<ExistingBackupsResponse> {
    const backup = getBackup();
    return {
        backupFolderPath: backup.getBackupFolderPath(),
        backups: await backup.getExistingBackups()
    };
}

async function backupDatabase(): Promise<BackupDatabaseNowResponse> {
    return {
        backupFile: await getBackup().backupNow("now")
    };
}

async function downloadBackup(req: Request, res: Response): Promise<void> {
    const filePath = req.query.filePath;
    if (!filePath || typeof filePath !== "string") {
        res.status(400).send("Missing or invalid filePath");
        return;
    }

    const backup = getBackup();
    // Sent a piece at a time wherever the platform can: reading it first means holding a whole
    // backup in memory, which Node refuses above 2 GiB and which any real one will exceed.
    if (backup.sendBackup?.(filePath, res)) {
        return;
    }

    const content = await backup.getBackupContent(filePath);
    if (!content) {
        res.status(404).send("Backup not found");
        return;
    }

    res.set("Content-Type", "application/x-sqlite3");
    res.set("Content-Disposition", `attachment; filename="${fileNameOf(filePath)}"`);
    res.send(content);
}

/** The last segment of a path, on either kind of separator: these are read off a Windows disk too. */
function fileNameOf(filePath: string): string {
    return filePath.split(/[\\/]/).pop() || "backup.db";
}

export default {
    getExistingBackups,
    backupDatabase,
    downloadBackup
};
