"use strict";

import sql from "../../services/sql.js";
import log from "../../services/log.js";
import backupService from "../../services/backup.js";
import anonymizationService from "../../services/anonymization.js";
import consistencyChecksService from "../../services/consistency_checks.js";
import type { Request } from "express";
import ValidationError from "../../errors/validation_error.js";
import sql_init from "../../services/sql_init.js";
import becca_loader from "../../becca/becca_loader.js";
import { BackupDatabaseNowResponse, DatabaseCheckIntegrityResponse } from "@triliumnext/commons";

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

export default {
    getExistingBackups,
    backupDatabase,
    vacuumDatabase,
    findAndFixConsistencyIssues,
    rebuildIntegrationTestDatabase,
    getExistingAnonymizedDatabases,
    anonymize,
    checkIntegrity
};
