

import type { EntityChange, EntityChangeRecord, EntityRow } from "@triliumnext/commons";
import { becca_loader } from "@triliumnext/core";

import becca from "../becca/becca.js";
import entityConstructor from "../becca/entity_constructor.js";
import appInfo from "./app_info.js";
import cls from "./cls.js";
import consistency_checks from "./consistency_checks.js";
import contentHashService from "./content_hash.js";
import dateUtils from "./date_utils.js";
import entityChangesService from "./entity_changes.js";
import instanceId from "./instance_id.js";
import log from "./log.js";
import optionService from "./options.js";
import request from "./request.js";
import type { CookieJar, ExecOpts } from "./request_interface.js";
import setupService from "./setup.js";
import sql from "./sql.js";
import syncMutexService from "./sync_mutex.js";
import syncOptions from "./sync_options.js";
import syncUpdateService from "./sync_update.js";
import { hmac, randomString, timeLimit } from "./utils.js";
import ws from "./ws.js";

let proxyToggle = true;

let outstandingPullCount = 0;

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

            return {
                success: true
            };
        });
    } catch (e: any) {
        // we're dynamically switching whether we're using proxy or not based on whether we encountered error with the current method
        proxyToggle = !proxyToggle;

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
    const hash = hmac(documentSecret, timestamp);

    const syncContext: SyncContext = { cookieJar: {} };
    const resp = await syncRequest<SyncResponse>(syncContext, "POST", "/api/login/sync", {
        timestamp,
        syncVersion: appInfo.syncVersion,
        hash
    });

    if (!resp) {
        throw new Error("Got no response.");
    }

    if (resp.instanceId === instanceId) {
        throw new Error(
            `Sync server has instance ID '${resp.instanceId}' which is also local. This usually happens when the sync client is (mis)configured to sync with itself (URL points back to client) instead of the correct sync server.`
        );
    }

    syncContext.instanceId = resp.instanceId;

    const lastSyncedPull = getLastSyncedPull();

    // this is important in a scenario where we set up the sync by manually copying the document
    // lastSyncedPull then could be pretty off for the newly cloned client
    if (lastSyncedPull > resp.maxEntityChangeId) {
        log.info(`Lowering last synced pull from ${lastSyncedPull} to ${resp.maxEntityChangeId}`);

        setLastSyncedPull(resp.maxEntityChangeId);
    }

    return syncContext;
}

async function pullChanges(syncContext: SyncContext) {
    while (true) {
        const lastSyncedPull = getLastSyncedPull();
        const logMarkerId = randomString(10); // to easily pair sync events between client and server logs
        const changesUri = `/api/sync/changed?instanceId=${instanceId}&lastEntityChangeId=${lastSyncedPull}&logMarkerId=${logMarkerId}`;

        const startDate = Date.now();

        const resp = await syncRequest<ChangesResponse>(syncContext, "GET", changesUri);
        if (!resp) {
            throw new Error("Request failed.");
        }
        const { entityChanges, lastEntityChangeId } = resp;

        outstandingPullCount = resp.outstandingPullCount;

        const pulledDate = Date.now();

        sql.transactional(() => {
            if (syncContext.instanceId) {
                syncUpdateService.updateEntities(entityChanges, syncContext.instanceId);
            }

            if (lastSyncedPull !== lastEntityChangeId) {
                setLastSyncedPull(lastEntityChangeId);
            }
        });

        if (entityChanges.length === 0) {
            break;
        } else {
            try {
                // https://github.com/zadam/trilium/issues/4310
                const sizeInKb = Math.round(JSON.stringify(resp).length / 1024);

                log.info(
                    `Sync ${logMarkerId}: Pulled ${entityChanges.length} changes in ${sizeInKb} KB, starting at entityChangeId=${lastSyncedPull} in ${pulledDate - startDate}ms and applied them in ${Date.now() - pulledDate}ms, ${outstandingPullCount} outstanding pulls`
                );
            } catch (e: any) {
                log.error(`Error occurred ${e.message} ${e.stack}`);
            }
        }
    }

    log.info("Finished pull");
}

async function pushChanges(syncContext: SyncContext) {
    let lastSyncedPush: number | null | undefined = getLastSyncedPush();

    while (true) {
        const entityChanges = sql.getRows<EntityChange>("SELECT * FROM entity_changes WHERE isSynced = 1 AND id > ? LIMIT 1000", [lastSyncedPush]);

        if (entityChanges.length === 0) {
            log.info("Nothing to push");

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
            instanceId
        });

        ws.syncPushInProgress();

        log.info(`Sync ${logMarkerId}: Pushing ${entityChangesRecords.length} sync changes in ${Date.now() - startDate.getTime()}ms`);

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

    if (lastSyncedPullId < resp.maxEntityChangeId) {
        log.info(`There are some outstanding pulls (${lastSyncedPullId} vs. ${resp.maxEntityChangeId}), skipping content check.`);

        return true;
    }

    const notPushedSyncs = sql.getValue("SELECT EXISTS(SELECT 1 FROM entity_changes WHERE isSynced = 1 AND id > ?)", [getLastSyncedPush()]);

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
        return sql.getMap("SELECT branchId, notePosition FROM branches WHERE parentNoteId = ? AND isDeleted = 0", [entityId]);
    } 
    const primaryKey = entityConstructor.getEntityFromEntityName(entityName).primaryKeyName;

    if (!primaryKey) {
        throw new Error(`Unknown entity for entity change ${JSON.stringify(entityChange)}`);
    }

    const entityRow = sql.getRow<EntityRow>(/*sql*/`SELECT * FROM ${entityName} WHERE ${primaryKey} = ?`, [entityId]);

    if (!entityRow) {
        log.error(`Cannot find entity for entity change ${JSON.stringify(entityChange)}`);
        return null;
    }

    if (entityName === "blobs" && entityRow.content !== null) {
        if (typeof entityRow.content === "string") {
            entityRow.content = Buffer.from(entityRow.content, "utf-8");
        }

        if (entityRow.content) {
            entityRow.content = entityRow.content.toString("base64");
        }
    }


    return entityRow;
    
}

function getEntityChangeRecords(entityChanges: EntityChange[]) {
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

        length += JSON.stringify(record).length;

        if (length > 1_000_000) {
            // each sync request/response should have at most ~1 MB.
            break;
        }
    }

    return records;
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
    sql.execute("UPDATE options SET value = ? WHERE name = ?", [entityChangeId, "lastSyncedPull"]);
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
    sql.execute("UPDATE options SET value = ? WHERE name = ?", [entityChangeId, "lastSyncedPush"]);
}

function getMaxEntityChangeId() {
    return sql.getValue("SELECT COALESCE(MAX(id), 0) FROM entity_changes");
}

function getOutstandingPullCount() {
    return outstandingPullCount;
}

becca_loader.beccaLoaded.then(() => {
    setInterval(cls.wrap(sync), 60000);

    // kickoff initial sync immediately, but should happen after initial consistency checks
    setTimeout(cls.wrap(sync), 5000);

    // called just so ws.setLastSyncedPush() is called
    getLastSyncedPush();
});

export default {
    sync,
    login,
    getEntityChangeRecords,
    getOutstandingPullCount,
    getMaxEntityChangeId
};
