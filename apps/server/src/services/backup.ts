"use strict";

import dateUtils from "./date_utils.js";
import optionService from "./options.js";
import fs from "fs";
import dataDir from "./data_dir.js";
import log from "./log.js";
import syncMutexService from "./sync_mutex.js";
import cls from "./cls.js";
import sql from "./sql.js";
import path from "path";
import type { DatabaseBackup, OptionNames } from "@triliumnext/commons";

type BackupType = "daily" | "weekly" | "monthly";

function getExistingBackups(): DatabaseBackup[] {
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

function regularBackup() {
    cls.init(() => {
        periodBackup("lastDailyBackupDate", "daily", 24 * 3600);

        periodBackup("lastWeeklyBackupDate", "weekly", 7 * 24 * 3600);

        periodBackup("lastMonthlyBackupDate", "monthly", 30 * 24 * 3600);
    });
}

function isBackupEnabled(backupType: BackupType) {
    let optionName: OptionNames;
    switch (backupType) {
        case "daily":
            optionName = "dailyBackupEnabled";
            break;
        case "weekly":
            optionName = "weeklyBackupEnabled";
            break;
        case "monthly":
            optionName = "monthlyBackupEnabled";
            break;
    }

    return optionService.getOptionBool(optionName);
}

function periodBackup(optionName: "lastDailyBackupDate" | "lastWeeklyBackupDate" | "lastMonthlyBackupDate", backupType: BackupType, periodInSeconds: number) {
    if (!isBackupEnabled(backupType)) {
        return;
    }

    const now = new Date();
    const lastBackupDate = dateUtils.parseDateTime(optionService.getOption(optionName));

    if (now.getTime() - lastBackupDate.getTime() > periodInSeconds * 1000) {
        backupNow(backupType);

        optionService.setOption(optionName, dateUtils.utcNowDateTime());
    }
}

async function backupNow(name: string) {
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
export default {
    getExistingBackups,
    backupNow,
    regularBackup
};
