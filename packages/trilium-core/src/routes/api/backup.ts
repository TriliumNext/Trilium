import type { BackupDatabaseNowResponse, DatabaseBackup } from "@triliumnext/commons";
import { getBackup } from "../../services/backup.js";
import { Request, Response } from "express";

async function getExistingBackups(): Promise<DatabaseBackup[]> {
    return getBackup().getExistingBackups();
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

    const content = await getBackup().getBackupContent(filePath);
    if (!content) {
        res.status(404).send("Backup not found");
        return;
    }

    const fileName = filePath.split("/").pop() || "backup.db";
    res.set("Content-Type", "application/x-sqlite3");
    res.set("Content-Disposition", `attachment; filename="${fileName}"`);
    res.send(content);
}

export default {
    getExistingBackups,
    backupDatabase,
    downloadBackup
};
