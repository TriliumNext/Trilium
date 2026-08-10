import {
    BackupDatabaseNowResponse,
    CompactionEstimateResponse,
    DatabaseCheckIntegrityResponse,
    ExistingAnonymizedDatabasesResponse,
    VacuumDatabaseResponse
} from "@triliumnext/commons";
import { becca_loader, consistency_checks as consistencyChecksService, getBackup, getLog, utils, ValidationError } from "@triliumnext/core";
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
    const sizeBefore = databaseBytes();

    // Announced before the rebuild starts, not only once it ends: this holds the process for minutes
    // on a large database, and if it is killed or the machine goes down in the meantime, this line
    // is the only record that one was ever under way.
    getLog().info(`Compacting the database (${utils.formatSize(sizeBefore)}). This may take several minutes.`);

    sql.execute("VACUUM");
    const sizeAfter = databaseBytes();

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
        reclaimableBytes: reclaimableBytes(),
        databaseBytes: databaseBytes()
    } satisfies CompactionEstimateResponse;
}

/**
 * The database's own view of its size: every page it has allocated, the free ones included. Read
 * through pragma functions rather than the file itself, so there is no path to resolve and no race
 * with the filesystem — and it is exactly the figure a vacuum moves.
 *
 * Covers the main database alone; in WAL mode the `-wal` sidecar is not part of it.
 */
function databaseBytes(): number {
    return sql.getValue<number>("SELECT page_count * page_size FROM pragma_page_count(), pragma_page_size()");
}

/** Pages already free inside the file. A floor, not a promise: a rebuild also recovers the slack
 *  left inside pages that are still in use, which no count of whole pages can see. */
function reclaimableBytes(): number {
    return sql.getValue<number>("SELECT freelist_count * page_size FROM pragma_freelist_count(), pragma_page_size()");
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

function checkIntegrity() {
    const results = sql.getRows<{ integrity_check: string }>("PRAGMA integrity_check");

    getLog().info(`Integrity check result: ${JSON.stringify(results)}`);

    return {
        results
    } satisfies DatabaseCheckIntegrityResponse;
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
    checkIntegrity,
    downloadBackup,
    downloadAnonymizedDatabase
};

function downloadDatabaseFile(req: Request, res: Response, allowedDir: string, notFoundMessage: string) {
    const filePath = req.query.filePath as string;
    if (!filePath) {
        res.status(400).send("Missing filePath");
        return;
    }

    const resolvedPath = path.resolve(filePath);
    if (!resolvedPath.startsWith(path.resolve(allowedDir) + path.sep)) {
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
