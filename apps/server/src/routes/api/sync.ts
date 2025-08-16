"use strict";

import syncService from "../../services/sync.js";
import syncUpdateService from "../../services/sync_update.js";
import entityChangesService from "../../services/entity_changes.js";
import sql from "../../services/sql.js";
import sqlInit from "../../services/sql_init.js";
import optionService from "../../services/options.js";
import contentHashService from "../../services/content_hash.js";
import log from "../../services/log.js";
import syncOptions from "../../services/sync_options.js";
import utils, { safeExtractMessageAndStackFromError } from "../../services/utils.js";
import ws from "../../services/ws.js";
import type { Request } from "express";
import type { EntityChange } from "../../services/entity_changes_interface.js";
import ValidationError from "../../errors/validation_error.js";
import consistencyChecksService from "../../services/consistency_checks.js";
import { t } from "i18next";
import { SyncTestResponse } from "@triliumnext/commons";

async function testSync(): Promise<SyncTestResponse> {
    try {
        if (!syncOptions.isSyncSetup()) {
            return { success: false, message: t("test_sync.not-configured") };
        }

        await syncService.login();

        // login was successful, so we'll kick off sync now
        // this is important in case when sync server has been just initialized
        syncService.sync();

        return { success: true, message: t("test_sync.successful") };
    } catch (e: unknown) {
        const [errMessage] = safeExtractMessageAndStackFromError(e);
        return {
            success: false,
            message: errMessage
        };
    }
}

function getStats() {
    if (!sqlInit.schemaExists()) {
        // fail silently but prevent errors from not existing options table
        return {};
    }

    const stats = {
        initialized: sql.getValue("SELECT value FROM options WHERE name = 'initialized'") === "true",
        outstandingPullCount: syncService.getOutstandingPullCount()
    };

    log.info(`Returning sync stats: ${JSON.stringify(stats)}`);

    return stats;
}

function checkSync() {
    return {
        entityHashes: contentHashService.getEntityHashes(),
        maxEntityChangeId: sql.getValue("SELECT COALESCE(MAX(id), 0) FROM entity_changes WHERE isSynced = 1")
    };
}

function syncNow() {
    log.info("Received request to trigger sync now.");

    // when explicitly asked for set in progress status immediately for faster user feedback
    ws.syncPullInProgress();

    return syncService.sync();
}

function fillEntityChanges() {
    entityChangesService.fillAllEntityChanges();

    log.info("Sync rows have been filled.");
}

function forceFullSync() {
    optionService.setOption("lastSyncedPull", 0);
    optionService.setOption("lastSyncedPush", 0);

    log.info("Forcing full sync.");

    // not awaiting for the job to finish (will probably take a long time)
    syncService.sync();
}

/**
 * @swagger
 * /api/sync/changed:
 *   get:
 *     summary: Pull sync changes
 *     operationId: sync-changed
 *     externalDocs:
 *       description: Server implementation
 *       url: https://github.com/TriliumNext/Trilium/blob/v0.91.6/src/routes/api/sync.ts
 *     parameters:
 *       - in: query
 *         name: instanceId
 *         required: true
 *         schema:
 *           type: string
 *         description: Local instance ID
 *       - in: query
 *         name: lastEntityChangeId
 *         required: true
 *         schema:
 *           type: integer
 *         description: Last locally present change ID
 *       - in: query
 *         name: logMarkerId
 *         required: true
 *         schema:
 *           type: string
 *         description: Marker to identify this request in server log
 *     responses:
 *       '200':
 *         description: Sync changes, limited to approximately one megabyte.
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 entityChanges:
 *                   type: array
 *                   items:
 *                     $ref: '#/components/schemas/EntityChange'
 *                 lastEntityChangeId:
 *                   type: integer
 *                   description: If `outstandingPullCount > 0`, pass this as parameter in your next request to continue.
 *                 outstandingPullCount:
 *                   type: integer
 *                   example: 42
 *                   description: Number of changes not yet returned by the remote.
 *     security:
 *       - session: []
 *     tags:
 *       - sync
 */
function getChanged(req: Request) {
    const startTime = Date.now();

    if (typeof req.query.lastEntityChangeId !== "string") {
        throw new ValidationError("Missing or invalid last entity change ID.");
    }

    let lastEntityChangeId: number | null | undefined = parseInt(req.query.lastEntityChangeId);
    const clientInstanceId = req.query.instanceId;
    let filteredEntityChanges: EntityChange[] = [];

    do {
        const entityChanges: EntityChange[] = sql.getRows<EntityChange>(
            `
            SELECT *
            FROM entity_changes
            WHERE isSynced = 1
            AND id > ?
            ORDER BY id
            LIMIT 1000`,
            [lastEntityChangeId]
        );

        if (entityChanges.length === 0) {
            break;
        }

        filteredEntityChanges = entityChanges.filter((ec) => ec.instanceId !== clientInstanceId);

        if (filteredEntityChanges.length === 0) {
            lastEntityChangeId = entityChanges[entityChanges.length - 1].id;
        }
    } while (filteredEntityChanges.length === 0);

    const entityChangeRecords = syncService.getEntityChangeRecords(filteredEntityChanges);

    if (entityChangeRecords.length > 0) {
        lastEntityChangeId = entityChangeRecords[entityChangeRecords.length - 1].entityChange.id;

        log.info(`Returning ${entityChangeRecords.length} entity changes in ${Date.now() - startTime}ms`);
    }

    return {
        entityChanges: entityChangeRecords,
        lastEntityChangeId,
        outstandingPullCount: sql.getValue(
            `
            SELECT COUNT(id)
            FROM entity_changes
            WHERE isSynced = 1
            AND instanceId != ?
            AND id > ?`,
            [clientInstanceId, lastEntityChangeId]
        )
    };
}

const partialRequests: Record<
    string,
    {
        createdAt: number;
        payload: string;
    }
> = {};

/**
 * @swagger
 * /api/sync/update:
 *   put:
 *     summary: Push sync changes
 *     description:
 *       "Basic usage: set `pageCount = 1`, `pageIndex = 0`, and omit `requestId`. Supply your entity changes in the request body."
 *     operationId: sync-update
 *     externalDocs:
 *       description: Server implementation
 *       url: https://github.com/TriliumNext/Trilium/blob/v0.91.6/src/routes/api/sync.ts
 *     parameters:
 *       - in: header
 *         name: pageCount
 *         required: true
 *         schema:
 *           type: integer
 *       - in: header
 *         name: pageIndex
 *         required: true
 *         schema:
 *           type: integer
 *       - in: header
 *         name: requestId
 *         schema:
 *           type: string
 *           description: ID to identify paginated requests
 *       - in: query
 *         name: logMarkerId
 *         required: true
 *         schema:
 *           type: string
 *         description: Marker to identify this request in server log
 *     requestBody:
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             properties:
 *               instanceId:
 *                 type: string
 *                 description: Local instance ID
 *               entities:
 *                 type: array
 *                 items:
 *                   $ref: '#/components/schemas/EntityChange'
 *     responses:
 *       '200':
 *         description: Changes processed successfully
 *     security:
 *       - session: []
 *     tags:
 *       - sync
 */
function update(req: Request) {
    let { body } = req;

    const pageCount = parseInt(req.get("pageCount") as string);
    const pageIndex = parseInt(req.get("pageIndex") as string);

    if (pageCount !== 1) {
        const requestId = req.get("requestId");
        if (!requestId) {
            throw new Error("Missing request ID.");
        }

        if (pageIndex === 0) {
            partialRequests[requestId] = {
                createdAt: Date.now(),
                payload: ""
            };
        }

        if (!partialRequests[requestId]) {
            throw new Error(`Partial request ${requestId}, page ${pageIndex + 1} of ${pageCount} of pages does not have expected record.`);
        }

        partialRequests[requestId].payload += req.body;

        log.info(`Receiving a partial request ${requestId}, page ${pageIndex + 1} out of ${pageCount} pages.`);

        if (pageIndex !== pageCount - 1) {
            return;
        } else {
            body = JSON.parse(partialRequests[requestId].payload);
            delete partialRequests[requestId];
        }
    }

    const { entities, instanceId } = body;

    sql.transactional(() => syncUpdateService.updateEntities(entities, instanceId));
}

setInterval(() => {
    for (const key in partialRequests) {
        if (Date.now() - partialRequests[key].createdAt > 20 * 60 * 1000) {
            log.info(`Cleaning up unfinished partial requests for ${key}`);

            delete partialRequests[key];
        }
    }
}, 60 * 1000);

function syncFinished() {
    // after the first sync finishes, the application is ready to be used
    // this is meaningless but at the same time harmless (idempotent) for further syncs
    sqlInit.setDbAsInitialized();
}

function queueSector(req: Request) {
    const entityName = utils.sanitizeSqlIdentifier(req.params.entityName);
    const sector = utils.sanitizeSqlIdentifier(req.params.sector);

    entityChangesService.addEntityChangesForSector(entityName, sector);
}

function checkEntityChanges() {
    consistencyChecksService.runEntityChangesChecks();
}

export default {
    testSync,
    checkSync,
    syncNow,
    fillEntityChanges,
    forceFullSync,
    getChanged,
    update,
    getStats,
    syncFinished,
    queueSector,
    checkEntityChanges
};
