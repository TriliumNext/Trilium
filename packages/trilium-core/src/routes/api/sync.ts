import { type EntityChange, type EntityChangeRecord, SyncTestResponse } from "@triliumnext/commons";
import type { Request } from "express";
import { t } from "i18next";

import consistencyChecksService from "../../services/consistency_checks.js";
import contentHashService from "../../services/content_hash.js";
import entityChangesService from "../../services/entity_changes.js";
import { getLog } from "../../services/log.js";
import optionService from "../../services/options.js";
import { getSql } from "../../services/sql/index.js";
import sqlInit from "../../services/sql_init.js";
import syncService, { estimateEntityChangeRecordSize, MAX_PULL_RESPONSE_BYTES } from "../../services/sync.js";
import syncOptions from "../../services/sync_options.js";
import syncUpdateService from "../../services/sync_update.js";
import * as utils from "../../services/utils/index.js";
import ws from "../../services/ws.js";
import { ValidationError } from "../../errors.js";

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
        const [errMessage] = utils.safeExtractMessageAndStackFromError(e);
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
        initialized: getSql().getValue("SELECT value FROM options WHERE name = 'initialized'") === "true",
        outstandingPullCount: syncService.getOutstandingPullCount(),
        totalPullCount: syncService.getTotalPullCount()
    };

    getLog().info(`Returning sync stats: ${JSON.stringify(stats)}`);

    return stats;
}

function checkSync() {
    return {
        entityHashes: contentHashService.getEntityHashes(),
        maxEntityChangeId: getSql().getValue("SELECT COALESCE(MAX(id), 0) FROM entity_changes WHERE isSynced = 1")
    };
}

function syncNow() {
    getLog().info("Received request to trigger sync now.");

    // when explicitly asked for set in progress status immediately for faster user feedback
    ws.syncPullInProgress();

    return syncService.sync();
}

function fillEntityChanges() {
    entityChangesService.fillAllEntityChanges();

    getLog().info("Sync rows have been filled.");
}

function forceFullSync() {
    optionService.setOption("lastSyncedPull", 0);
    optionService.setOption("lastSyncedPush", 0);

    getLog().info("Forcing full sync.");

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
 *       - in: query
 *         name: maxBlobContentSize
 *         required: false
 *         schema:
 *           type: integer
 *         description: If set, blob rows whose content exceeds this many bytes are returned with empty content; the entity_change metadata (including its hash) is unaffected.
 *     responses:
 *       '200':
 *         description: Sync changes, limited to approximately eight megabytes.
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

    let lastEntityChangeId = parseInt(req.query.lastEntityChangeId);
    const clientInstanceId = req.query.instanceId;

    // Optional per-client limit: blob rows whose content exceeds this many bytes are served with
    // empty content (a stub). Only clients that opt in (currently mobile) send it; the entity_change
    // metadata is unaffected, so content-hash checks still pass. Invalid or non-positive values
    // disable the limit.
    const maxBlobContentSizeRaw = typeof req.query.maxBlobContentSize === "string" ? parseInt(req.query.maxBlobContentSize) : NaN;
    const maxBlobContentSize = Number.isFinite(maxBlobContentSizeRaw) && maxBlobContentSizeRaw > 0 ? maxBlobContentSizeRaw : undefined;

    const sql = getSql();
    const entityChangeRecords: EntityChangeRecord[] = [];
    let estimatedResponseBytes = 0;
    // Where the next row fetch starts. Advances over every fetched row, unlike
    // `lastEntityChangeId` (the cursor returned to the client), which only advances over rows the
    // client can safely skip: records included in the response and batches consisting entirely of
    // the client's own changes.
    let fetchCursor = lastEntityChangeId;

    // Accumulate rows across LIMIT-1000 fetches until the response byte estimate crosses the cap
    // (or the table is exhausted). Metadata-only records are ~300 bytes, so a single 1000-row fetch
    // fills only ~4% of the byte budget — without this loop the row limit binds long before the
    // byte cap on metadata-dense ranges, costing many extra round-trips.
    while (estimatedResponseBytes < MAX_PULL_RESPONSE_BYTES) {
        const entityChanges: EntityChange[] = sql.getRows<EntityChange>(
            `
            SELECT *
            FROM entity_changes
            WHERE isSynced = 1
            AND id > ?
            ORDER BY id
            LIMIT 1000`,
            [fetchCursor]
        );

        if (entityChanges.length === 0) {
            break;
        }

        // rows fetched from entity_changes always carry an id
        fetchCursor = entityChanges[entityChanges.length - 1].id ?? fetchCursor;

        const foreignEntityChanges = entityChanges.filter((ec) => ec.instanceId !== clientInstanceId);

        if (foreignEntityChanges.length === 0) {
            // the whole batch is the client's own changes — skip the client's cursor past it
            lastEntityChangeId = fetchCursor;
            continue;
        }

        const records = syncService.getEntityChangeRecords(foreignEntityChanges, MAX_PULL_RESPONSE_BYTES - estimatedResponseBytes, maxBlobContentSize);

        for (const record of records) {
            estimatedResponseBytes += estimateEntityChangeRecordSize(record);
        }

        entityChangeRecords.push(...records);

        if (records.length > 0) {
            // rows fetched from entity_changes always carry an id
            lastEntityChangeId = records[records.length - 1].entityChange.id ?? lastEntityChangeId;
        }

        if (records.length < foreignEntityChanges.length) {
            // the byte budget was reached mid-batch (or trailing records were skipped) — anything
            // not included must be re-served next request, so stop without advancing further
            break;
        }
    }

    if (entityChangeRecords.length > 0) {
        getLog().info(`Returning ${entityChangeRecords.length} entity changes in ${Date.now() - startTime}ms`);
    }

    // `outstandingPullCount` is a progress estimate returned on every pull request. Counting with
    // only `isSynced` + `id` is an index-only range scan on IDX_entity_changes_isSynced_id; adding
    // an `instanceId != ?` filter (instanceId is not in the index) forces a table lookup per row,
    // which made this query the single most expensive part of serving a large initial sync.
    //
    // Dropping the instanceId filter can transiently count the client's own pushed changes (which
    // are then skipped when returned), so the estimate may over-count slightly mid-sync but always
    // converges to 0 as `lastEntityChangeId` advances. During an initial sync the client has no rows
    // on the server, so the count is exact.
    const outstandingPullCount = sql.getValue(
        `
            SELECT COUNT(id)
            FROM entity_changes
            WHERE isSynced = 1
            AND id > ?`,
        [lastEntityChangeId]
    );

    return {
        entityChanges: entityChangeRecords,
        lastEntityChangeId,
        outstandingPullCount
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

        getLog().info(`Receiving a partial request ${requestId}, page ${pageIndex + 1} out of ${pageCount} pages.`);

        if (pageIndex !== pageCount - 1) {
            return;
        }
        body = JSON.parse(partialRequests[requestId].payload);
        delete partialRequests[requestId];
    }

    const { entities, instanceId } = body;

    getSql().transactional(() => syncUpdateService.updateEntities(entities, instanceId));
}

/* v8 ignore start -- module-level timer, not invoked in tests */
setInterval(() => {
    for (const key in partialRequests) {
        if (Date.now() - partialRequests[key].createdAt > 20 * 60 * 1000) {
            getLog().info(`Cleaning up unfinished partial requests for ${key}`);

            delete partialRequests[key];
        }
    }
}, 60 * 1000);
/* v8 ignore stop */

function syncFinished() {
    // after the first sync finishes, the application is ready to be used
    // this is meaningless but at the same time harmless (idempotent) for further syncs
    sqlInit.setDbAsInitialized();
}

function queueSector(req: Request<{ entityName: string; sector: string }>) {
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
