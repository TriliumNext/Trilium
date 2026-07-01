import type { EntityChange, EntityChangeRecord, EntityRow } from "@triliumnext/commons";

import becca from "../becca/becca.js";
import appInfo from "./app_info.js";
import * as cls from "./context.js";
import consistency_checks from "./consistency_checks.js";
import contentHashService from "./content_hash.js";
import dateUtils from "./utils/date.js";
import entityChangesService from "./entity_changes.js";
import { getLog } from "./log.js";
import optionService from "./options.js";
import setupService from "./setup.js";
import { getSql } from "./sql/index.js";
import syncMutexService from "./sync_mutex.js";
import syncOptions from "./sync_options.js";
import syncUpdateService from "./sync_update.js";
import { isLinux, isMac, isWindows, randomString, timeLimit } from "./utils/index.js";
import ws from "./ws.js";
import getInstanceId from "./instance_id.js";
import request, { CookieJar, ExecOpts } from "./request.js";
import entity_constructor from "../../src/becca/entity_constructor.js";
import becca_loader from "../becca/becca_loader.js";
import * as binary_utils from "./utils/binary.js";
import { getCrypto } from "./encryption/crypto.js";

let proxyToggle = true;

let outstandingPullCount = 0;
let totalPullCount: number | null = null;

interface CheckResponse {
    maxEntityChangeId: number;
    entityHashes: Record<string, Record<string, string>>;
}

interface SyncResponse {
    instanceId: string;
    maxEntityChangeId: number;
}

interface ChangesResponse {
    entityChanges: EntityChangeRecord[];
    lastEntityChangeId: number;
    outstandingPullCount: number;
}

interface SyncContext {
    cookieJar: CookieJar;
    instanceId?: string;
}

async function sync() {
    try {
        return await syncMutexService.doExclusively(async () => {
            if (!syncOptions.isSyncSetup()) {
                return { success: false, errorCode: "NOT_CONFIGURED", message: "Sync not configured" };
            }

            let continueSync = false;

            do {
                const syncContext = await login();

                await pushChanges(syncContext);

                await pullChanges(syncContext);

                await pushChanges(syncContext);

                await syncFinished(syncContext);

                continueSync = await checkContentHash(syncContext);
            } while (continueSync);

            ws.syncFinished();

            if (optionService.getOptionOrNull("syncIncomplete") === "true") {
                optionService.setOption("syncIncomplete", "false");

                getLog().info("Sync complete — consistency checks will run on next scheduled check.");
            }

            return {
                success: true
            };
        });
    } catch (e: any) {
        // we're dynamically switching whether we're using proxy or not based on whether we encountered error with the current method
        proxyToggle = !proxyToggle;

        const log = getLog();
        if (
            e.message?.includes("ECONNREFUSED") ||
            e.message?.includes("ERR_") || // node network errors
            e.message?.includes("Bad Gateway")
        ) {
            ws.syncFailed();

            log.info("No connection to sync server.");

            return {
                success: false,
                message: "No connection to sync server."
            };
        }
        log.info(`Sync failed: '${e.message}', stack: ${e.stack}`);

        ws.syncFailed();

        return {
            success: false,
            message: e.message
        };

    }
}

async function login() {
    if (!(await setupService.hasSyncServerSchemaAndSeed())) {
        await setupService.sendSeedToSyncServer();
    }

    return await doLogin();
}

async function doLogin(): Promise<SyncContext> {
    const timestamp = dateUtils.utcNowDateTime();

    const documentSecret = optionService.getOption("documentSecret");
    const hash = getCrypto().hmac(documentSecret, timestamp);

    const syncContext: SyncContext = { cookieJar: {} };
    const resp = await syncRequest<SyncResponse>(syncContext, "POST", "/api/login/sync", {
        timestamp,
        syncVersion: appInfo.syncVersion,
        hash
    });

    if (!resp) {
        throw new Error("Got no response.");
    }

    if (resp.instanceId === getInstanceId()) {
        throw new Error(
            `Sync server has instance ID '${resp.instanceId}' which is also local. This usually happens when the sync client is (mis)configured to sync with itself (URL points back to client) instead of the correct sync server.`
        );
    }

    syncContext.instanceId = resp.instanceId;

    const lastSyncedPull = getLastSyncedPull();

    // this is important in a scenario where we set up the sync by manually copying the document
    // lastSyncedPull then could be pretty off for the newly cloned client
    if (lastSyncedPull > resp.maxEntityChangeId) {
        getLog().info(`Lowering last synced pull from ${lastSyncedPull} to ${resp.maxEntityChangeId}`);

        setLastSyncedPull(resp.maxEntityChangeId);
    }

    return syncContext;
}

async function pullChanges(syncContext: SyncContext) {
    const log = getLog();
    const maxBatchBytes = getMaxPullBatchBytes();

    while (true) {
        // Fetch phase: pull consecutive chunks (each needs its own HTTP round-trip) until we've
        // accumulated ~maxBatchBytes worth of content, then apply them all in a single transaction.
        // The commit itself carries a large fixed per-transaction overhead, so committing once per
        // pulled chunk dominates initial-sync time; batching amortizes it across many chunks. The
        // batch is bounded by bytes (not chunk count) to keep peak memory in check, since a single
        // chunk may already carry a large blob.
        const batch: ChangesResponse[] = [];
        let batchBytes = 0;
        let cursor = getLastSyncedPull();
        let noMoreChanges = false;
        const fetchStart = Date.now();

        do {
            const logMarkerId = randomString(10); // to easily pair sync events between client and server logs
            const changesUri = `/api/sync/changed?instanceId=${getInstanceId()}&lastEntityChangeId=${cursor}&logMarkerId=${logMarkerId}`;

            const resp = await syncRequest<ChangesResponse>(syncContext, "GET", changesUri);
            if (!resp) {
                throw new Error("Request failed.");
            }

            outstandingPullCount = resp.outstandingPullCount;

            // Advance the cursor to whatever the server has processed — even when it returns no entity
            // changes, since it may have skipped past changes owned by this instance. Capturing it here
            // (before the empty-response break) lets the apply phase persist the advance, so we don't
            // re-request the skipped range on every subsequent sync.
            cursor = resp.lastEntityChangeId;

            const hasPendingChanges = resp.entityChanges.length > 0 || outstandingPullCount > 0;
            if (hasPendingChanges && optionService.getOptionOrNull("syncIncomplete") !== "true") {
                optionService.setOption("syncIncomplete", "true");

                getLog().info("Marking sync as incomplete — consistency checks will be deferred until sync converges.");
            }

            if (totalPullCount === null) {
                totalPullCount = resp.entityChanges.length + outstandingPullCount;
            }

            if (resp.entityChanges.length === 0) {
                noMoreChanges = true;
                break;
            }

            batch.push(resp);
            batchBytes += estimatePullResponseBytes(resp);
        } while (batchBytes < maxBatchBytes);

        // Nothing to apply and the cursor didn't move → fully caught up. If the cursor DID advance (the
        // server skipped this instance's own changes and returned nothing), fall through so the apply
        // phase persists the advance.
        if (batch.length === 0 && getLastSyncedPull() === cursor) {
            break;
        }

        // Apply phase: all fetched chunks in a single transaction.
        const applyStart = Date.now();
        let batchChanges = 0;

        getSql().transactional(() => {
            for (const resp of batch) {
                if (syncContext.instanceId) {
                    syncUpdateService.updateEntities(resp.entityChanges, syncContext.instanceId);
                }

                batchChanges += resp.entityChanges.length;
            }

            if (getLastSyncedPull() !== cursor) {
                setLastSyncedPull(cursor);
            }
        });

        if (batch.length > 0) {
            log.info(
                `Sync: pulled ${batch.length} chunk(s) (${batchChanges} changes, ~${Math.round(batchBytes / 1_048_576)} MB) in ${applyStart - fetchStart}ms and applied them in ${Date.now() - applyStart}ms, ${outstandingPullCount} outstanding pulls`
            );
        }

        if (noMoreChanges) {
            break;
        }
    }

    log.info("Finished pull");

    totalPullCount = null;
}

/**
 * Maximum accumulated content size (in bytes) to buffer across pulled chunks before applying them
 * in a single transaction during {@link pullChanges}. Larger batches mean fewer commits (each of
 * which carries a large fixed overhead) at the cost of higher peak memory while the batch is held
 * in memory. The standalone/browser build runs SQLite (sql.js) fully in memory, so it uses a much
 * smaller budget than native desktop/server builds.
 */
function getMaxPullBatchBytes() {
    // Standalone/browser is the only platform reporting none of mac/windows/linux.
    const isBrowser = !isMac() && !isWindows() && !isLinux();

    return isBrowser ? 16 * 1024 * 1024 : 32 * 1024 * 1024;
}

/** Rough in-memory size of a pulled changes response, dominated by (base64-encoded) blob content. */
function estimatePullResponseBytes(resp: ChangesResponse) {
    let bytes = 0;

    for (const { entity } of resp.entityChanges) {
        const content = entity?.content;

        if (typeof content === "string") {
            bytes += content.length;
        } else if (content) {
            bytes += content.length; // Uint8Array
        }

        bytes += 128; // rough per-record metadata overhead
    }

    return bytes;
}

async function pushChanges(syncContext: SyncContext) {
    let lastSyncedPush: number | null | undefined = getLastSyncedPush();

    while (true) {
        const entityChanges = getSql().getRows<EntityChange>("SELECT * FROM entity_changes WHERE isSynced = 1 AND id > ? LIMIT 1000", [lastSyncedPush]);

        if (entityChanges.length === 0) {
            getLog().info("Nothing to push");

            break;
        }

        const filteredEntityChanges = entityChanges.filter((entityChange) => {
            if (entityChange.instanceId === syncContext.instanceId) {
                // this may set lastSyncedPush beyond what's actually sent (because of size limit)
                // so this is applied to the database only if there's no actual update
                lastSyncedPush = entityChange.id;

                return false;
            }
            return true;

        });

        if (filteredEntityChanges.length === 0 && lastSyncedPush) {
            // there still might be more sync changes (because of batch limit), just all the current batch
            // has been filtered out
            setLastSyncedPush(lastSyncedPush);

            continue;
        }

        const entityChangesRecords = getEntityChangeRecords(filteredEntityChanges);
        const startDate = new Date();

        const logMarkerId = randomString(10); // to easily pair sync events between client and server logs

        await syncRequest(syncContext, "PUT", `/api/sync/update?logMarkerId=${logMarkerId}`, {
            entities: entityChangesRecords,
            instanceId: getInstanceId()
        });

        ws.syncPushInProgress();

        getLog().info(`Sync ${logMarkerId}: Pushing ${entityChangesRecords.length} sync changes in ${Date.now() - startDate.getTime()}ms`);

        lastSyncedPush = entityChangesRecords[entityChangesRecords.length - 1].entityChange.id;

        if (lastSyncedPush) {
            setLastSyncedPush(lastSyncedPush);
        }
    }
}

async function syncFinished(syncContext: SyncContext) {
    await syncRequest(syncContext, "POST", "/api/sync/finished");
}

async function checkContentHash(syncContext: SyncContext) {
    const resp = await syncRequest<CheckResponse>(syncContext, "GET", "/api/sync/check");
    if (!resp) {
        throw new Error("Got no response.");
    }

    const lastSyncedPullId = getLastSyncedPull();
    const log = getLog();

    if (lastSyncedPullId < resp.maxEntityChangeId) {
        log.info(`There are some outstanding pulls (${lastSyncedPullId} vs. ${resp.maxEntityChangeId}), skipping content check.`);

        return true;
    }

    const notPushedSyncs = getSql().getValue("SELECT EXISTS(SELECT 1 FROM entity_changes WHERE isSynced = 1 AND id > ?)", [getLastSyncedPush()]);

    if (notPushedSyncs) {
        log.info(`There's ${notPushedSyncs} outstanding pushes, skipping content check.`);

        return true;
    }

    const failedChecks = contentHashService.checkContentHashes(resp.entityHashes);

    if (failedChecks.length > 0) {
        // before re-queuing sectors, make sure the entity changes are correct
        consistency_checks.runEntityChangesChecks();

        await syncRequest(syncContext, "POST", `/api/sync/check-entity-changes`);
    }

    for (const { entityName, sector } of failedChecks) {
        entityChangesService.addEntityChangesForSector(entityName, sector);

        await syncRequest(syncContext, "POST", `/api/sync/queue-sector/${entityName}/${sector}`);
    }

    return failedChecks.length > 0;
}

const PAGE_SIZE = 1000000;

interface SyncContext {
    cookieJar: CookieJar;
}

async function syncRequest<T extends {}>(syncContext: SyncContext, method: string, requestPath: string, _body?: {}) {
    const body = _body ? JSON.stringify(_body) : "";

    const timeout = syncOptions.getSyncTimeout();

    let response;

    const requestId = randomString(10);
    const pageCount = Math.max(1, Math.ceil(body.length / PAGE_SIZE));

    for (let pageIndex = 0; pageIndex < pageCount; pageIndex++) {
        const opts: ExecOpts = {
            method,
            url: syncOptions.getSyncServerHost() + requestPath,
            cookieJar: syncContext.cookieJar,
            timeout,
            paging: {
                pageIndex,
                pageCount,
                requestId
            },
            body: body.substr(pageIndex * PAGE_SIZE, Math.min(PAGE_SIZE, body.length - pageIndex * PAGE_SIZE)),
            proxy: proxyToggle ? syncOptions.getSyncProxy() : null
        };

        response = (await timeLimit(request.exec(opts), timeout)) as T;
    }

    return response;
}

function getEntityChangeRow(entityChange: EntityChange) {
    const { entityName, entityId } = entityChange;

    if (entityName === "note_reordering") {
        return getSql().getMap("SELECT branchId, notePosition FROM branches WHERE parentNoteId = ? AND isDeleted = 0", [entityId]);
    }
    const primaryKey = entity_constructor.getEntityFromEntityName(entityName).primaryKeyName;

    if (!primaryKey) {
        throw new Error(`Unknown entity for entity change ${JSON.stringify(entityChange)}`);
    }

    const entityRow = getSql().getRow<EntityRow>(/*sql*/`SELECT * FROM ${entityName} WHERE ${primaryKey} = ?`, [entityId]);

    if (!entityRow) {
        getLog().error(`Cannot find entity for entity change ${JSON.stringify(entityChange)}`);
        return null;
    }

    if (entityName === "blobs" && entityRow.content !== null) {
        if (typeof entityRow.content === "string") {
            entityRow.content = binary_utils.encodeUtf8(entityRow.content);
        }

        if (entityRow.content) {
            entityRow.content = binary_utils.encodeBase64(entityRow.content);
        }
    }


    return entityRow;

}

/**
 * Soft upper bound on the (estimated) size of a single pull response. Larger responses mean fewer
 * HTTP round-trips, which is the dominant cost of an initial sync over a high-latency link; on a 2 GB
 * benchmark, going from 1 MB to 8 MB cut the request count ~3x (1030 -> 333). It stays well under the
 * tens-of-MB responses a single large blob already produces (so it is within what existing reverse
 * proxies tolerate), and below the client's pull-batch memory budget, so it does not raise the
 * receiver's peak memory. It is a soft cap: a response is at least one record, and the record that
 * crosses the threshold is still included.
 */
const MAX_PULL_RESPONSE_BYTES = 8 * 1024 * 1024;

function getEntityChangeRecords(entityChanges: EntityChange[], maxResponseBytes = MAX_PULL_RESPONSE_BYTES) {
    const records: EntityChangeRecord[] = [];
    let length = 0;

    for (const entityChange of entityChanges) {
        if (entityChange.isErased) {
            records.push({ entityChange });

            continue;
        }

        const entity = getEntityChangeRow(entityChange);
        if (!entity) {
            continue;
        }

        const record: EntityChangeRecord = { entityChange, entity };

        records.push(record);

        length += estimateEntityChangeRecordSize(record);

        if (length > maxResponseBytes) {
            break;
        }
    }

    return records;
}

/**
 * Rough serialized byte size of an entity-change record, used only to bound a sync response to
 * ~1 MB. Avoids a full `JSON.stringify(record)` here — the record's (base64-encoded) blob content
 * would otherwise be serialized just to be measured, then serialized again when the response is
 * sent. Blob content dominates the payload; a fixed allowance covers the entityChange plus the
 * record's other (small) entity fields, which is precise enough for a size threshold.
 */
export function estimateEntityChangeRecordSize(record: EntityChangeRecord): number {
    const content = record.entity?.content;
    const contentLength = typeof content === "string" ? content.length : content?.length ?? 0;

    return contentLength + 300;
}

function getLastSyncedPull() {
    return parseInt(optionService.getOption("lastSyncedPull"));
}

function setLastSyncedPull(entityChangeId: number) {
    const lastSyncedPullOption = becca.getOption("lastSyncedPull");

    if (lastSyncedPullOption) {
        // might be null in initial sync when becca is not loaded
        lastSyncedPullOption.value = `${entityChangeId}`;
    }

    // this way we avoid updating entity_changes which otherwise means that we've never pushed all entity_changes
    getSql().execute("UPDATE options SET value = ? WHERE name = ?", [entityChangeId, "lastSyncedPull"]);
}

function getLastSyncedPush() {
    const lastSyncedPush = parseInt(optionService.getOption("lastSyncedPush"));

    ws.setLastSyncedPush(lastSyncedPush);

    return lastSyncedPush;
}

function setLastSyncedPush(entityChangeId: number) {
    ws.setLastSyncedPush(entityChangeId);

    const lastSyncedPushOption = becca.getOption("lastSyncedPush");

    if (lastSyncedPushOption) {
        // might be null in initial sync when becca is not loaded
        lastSyncedPushOption.value = `${entityChangeId}`;
    }

    // this way we avoid updating entity_changes which otherwise means that we've never pushed all entity_changes
    getSql().execute("UPDATE options SET value = ? WHERE name = ?", [entityChangeId, "lastSyncedPush"]);
}

function getMaxEntityChangeId() {
    return getSql().getValue("SELECT COALESCE(MAX(id), 0) FROM entity_changes");
}

function getOutstandingPullCount() {
    return outstandingPullCount;
}

function getTotalPullCount() {
    return totalPullCount;
}

function startSyncTimer() {
    becca_loader.beccaLoaded.then(() => {
        setInterval(cls.wrap(sync), 60000);

        // kickoff initial sync immediately
        setTimeout(cls.wrap(sync), 5000);

        // called just so ws.setLastSyncedPush() is called
        getLastSyncedPush();
    });
}

export default {
    sync,
    login,
    getEntityChangeRecords,
    getOutstandingPullCount,
    getTotalPullCount,
    getMaxEntityChangeId,
    startSyncTimer
};
