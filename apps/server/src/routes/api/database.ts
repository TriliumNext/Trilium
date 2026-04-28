import { BackupDatabaseNowResponse, DatabaseCheckIntegrityResponse } from "@triliumnext/commons";
import type { Request, Response } from "express";
import fs from "fs";
import path from "path";

import becca_loader from "../../becca/becca_loader.js";
import ValidationError from "../../errors/validation_error.js";
import anonymizationService from "../../services/anonymization.js";
import backupService from "../../services/backup.js";
import consistencyChecksService from "../../services/consistency_checks.js";
import dataDir from "../../services/data_dir.js";
import log from "../../services/log.js";
import sql from "../../services/sql.js";
import sql_init from "../../services/sql_init.js";

function getExistingBackups() {
    return backupService.getExistingBackups();
}

async function backupDatabase() {
    return {
        backupFile: await backupService.backupNow("now")
    } satisfies BackupDatabaseNowResponse;
}

function vacuumDatabase() {
    sql.execute("VACUUM");

    log.info("Database has been vacuumed.");
}

function findAndFixConsistencyIssues() {
    consistencyChecksService.runOnDemandChecks(true);
}

async function rebuildIntegrationTestDatabase() {
    sql.rebuildIntegrationTestDatabase();
    sql_init.initializeDb();
    becca_loader.load();
}

function getExistingAnonymizedDatabases() {
    return anonymizationService.getExistingAnonymizedDatabases();
}

async function anonymize(req: Request) {
    if (req.params.type !== "full" && req.params.type !== "light") {
        throw new ValidationError("Invalid type provided.");
    }
    return await anonymizationService.createAnonymizedCopy(req.params.type);
}

function checkIntegrity() {
    const results = sql.getRows<{ integrity_check: string }>("PRAGMA integrity_check");

    log.info(`Integrity check result: ${JSON.stringify(results)}`);

    return {
        results
    } satisfies DatabaseCheckIntegrityResponse;
}

function downloadBackup(req: Request, res: Response) {
    const filePath = req.query.filePath as string;
    if (!filePath) {
        res.status(400).send("Missing filePath");
        return;
    }

    const resolvedPath = path.resolve(filePath);
    if (!resolvedPath.startsWith(path.resolve(dataDir.BACKUP_DIR) + path.sep)) {
        res.status(403).send("Access denied");
        return;
    }

    if (!fs.existsSync(resolvedPath)) {
        res.status(404).send("Backup file not found");
        return;
    }

    const mtime = fs.statSync(resolvedPath).mtime;
    const dateStr = mtime.toISOString().slice(0, 19)
        .replaceAll(":", "-")
        .replace("T", "_");
    const ext = path.extname(resolvedPath);
    const baseName = path.basename(resolvedPath, ext);
    res.download(resolvedPath, `${baseName}_${dateStr}${ext}`);
}

export default {
    getExistingBackups,
    backupDatabase,
    vacuumDatabase,
    findAndFixConsistencyIssues,
    rebuildIntegrationTestDatabase,
    getExistingAnonymizedDatabases,
    anonymize,
    checkIntegrity,
    downloadBackup
};
