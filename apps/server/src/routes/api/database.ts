import {
    BackupDatabaseNowResponse,
    CompactionEstimateResponse,
    ExistingAnonymizedDatabasesResponse,
    VacuumDatabaseResponse
} from "@triliumnext/commons";
import { becca_loader, checkIntegrity, consistency_checks as consistencyChecksService, getBackup, getDatabaseSizeBytes, getLog, getReclaimableBytes, utils, ValidationError } from "@triliumnext/core";
import type { Request, Response } from "express";
import fs, { readFileSync } from "fs";
import path from "path";

import anonymizationService from "../../services/anonymization.js";
import dataDir from "../../services/data_dir.js";
import sql from "../../services/sql.js";
import sql_init from "../../services/sql_init.js";

function getExistingBackups() {
    return getBackup().getExistingBackups();
}

async function backupDatabase() {
    return {
        backupFile: await getBackup().backupNow("now")
    } satisfies BackupDatabaseNowResponse;
}

function vacuumDatabase() {
    // Timed from here, the two readings included: they are a pragma query each, and what the log is
    // answering for is how long the whole thing held the database.
    const startedAt = Date.now();
    const sizeBefore = getDatabaseSizeBytes();

    // Announced before the rebuild starts, not only once it ends: this holds the process for minutes
    // on a large database, and if it is killed or the machine goes down in the meantime, this line
    // is the only record that one was ever under way.
    getLog().info(`Compacting the database (${utils.formatSize(sizeBefore)}). This may take several minutes.`);

    sql.execute("VACUUM");
    const sizeAfter = getDatabaseSizeBytes();

    getLog().info(`Compacted the database from ${utils.formatSize(sizeBefore)}`
        + ` to ${utils.formatSize(sizeAfter)} in ${Date.now() - startedAt} ms.`);

    return { sizeBefore, sizeAfter } satisfies VacuumDatabaseResponse;
}

/**
 * What a rebuild would hand back, read before running one. Erasing content does not shrink the file
 * — the pages it frees stay allocated in it, on the freelist — so this is where that space shows up
 * until a vacuum returns it.
 */
function getCompactionEstimate() {
    return {
        reclaimableBytes: getReclaimableBytes(),
        databaseBytes: getDatabaseSizeBytes()
    } satisfies CompactionEstimateResponse;
}

function findAndFixConsistencyIssues() {
    void consistencyChecksService.runOnDemandChecks(true);
}

async function rebuildIntegrationTestDatabase() {
    const fixtureBytes = readFileSync(dataDir.DOCUMENT_PATH);
    sql.rebuildFromBuffer(fixtureBytes);
    sql_init.initializeDb();
    becca_loader.load();
}

function getExistingAnonymizedDatabases() {
    return {
        anonymizedFolderPath: path.resolve(dataDir.ANONYMIZED_DB_DIR),
        databases: anonymizationService.getExistingAnonymizedDatabases()
    } satisfies ExistingAnonymizedDatabasesResponse;
}

async function anonymize(req: Request) {
    if (req.params.type !== "full" && req.params.type !== "light") {
        throw new ValidationError("Invalid type provided.");
    }
    return await anonymizationService.createAnonymizedCopy(req.params.type);
}

/**
 * Removes one anonymized copy, named by the path the listing gave out.
 *
 * Confined to the directory those copies are written to, exactly as the download of one is: the path
 * arrives from the client, and what follows it is an unguarded file deletion. A file already gone is
 * not an error — the listing is a moment old by the time it is acted on, and the caller asked for it
 * to be absent, which it is.
 */
function deleteAnonymizedDatabase(req: Request) {
    const filePath = resolveInsideDirectory(String(req.query.filePath ?? ""), dataDir.ANONYMIZED_DB_DIR);

    if (!filePath) {
        throw new ValidationError("Not an anonymized database.");
    }

    fs.rmSync(filePath, { force: true });
}

function downloadBackup(req: Request, res: Response) {
    downloadDatabaseFile(req, res, dataDir.BACKUP_DIR, "Backup file not found");
}

function downloadAnonymizedDatabase(req: Request, res: Response) {
    downloadDatabaseFile(req, res, dataDir.ANONYMIZED_DB_DIR, "Anonymized database file not found");
}

export default {
    getExistingBackups,
    backupDatabase,
    vacuumDatabase,
    getCompactionEstimate,
    findAndFixConsistencyIssues,
    rebuildIntegrationTestDatabase,
    getExistingAnonymizedDatabases,
    anonymize,
    deleteAnonymizedDatabase,
    checkIntegrity,
    downloadBackup,
    downloadAnonymizedDatabase
};

/**
 * The path resolved, or null where it does not land inside the directory it has to be in. Every
 * route acting on a file the client named goes through here: the paths come from a listing this
 * server gave out, but nothing about the request says so.
 */
function resolveInsideDirectory(filePath: string, allowedDir: string): string | null {
    const resolvedPath = path.resolve(filePath);

    return resolvedPath.startsWith(path.resolve(allowedDir) + path.sep) ? resolvedPath : null;
}

function downloadDatabaseFile(req: Request, res: Response, allowedDir: string, notFoundMessage: string) {
    const filePath = req.query.filePath as string;
    if (!filePath) {
        res.status(400).send("Missing filePath");
        return;
    }

    const resolvedPath = resolveInsideDirectory(filePath, allowedDir);
    if (!resolvedPath) {
        res.status(403).send("Access denied");
        return;
    }

    if (!fs.existsSync(resolvedPath)) {
        res.status(404).send(notFoundMessage);
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
