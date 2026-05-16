import syncService from "./sync.js";
import { getLog } from "./log.js";
import sqlInit from "./sql_init.js";
import optionService from "./options.js";
import syncOptions from "./sync_options.js";
import appInfo from "./app_info.js";
import { timeLimit } from "./utils/index.js";
import becca from "../becca/becca.js";
import type { SetupStatusResponse, SetupSyncFromServerResponse, SetupSyncSeedResponse } from "@triliumnext/commons";
import request from "./request.js";

async function hasSyncServerSchemaAndSeed() {
    const response = await requestToSyncServer<SetupStatusResponse>("GET", "/api/setup/status");

    if (response.syncVersion !== appInfo.syncVersion) {
        throw new Error(
            `Could not setup sync since local sync protocol version is ${appInfo.syncVersion} while remote is ${response.syncVersion}. To fix this issue, use same Trilium version on all instances.`
        );
    }

    return response.schemaExists;
}

function triggerSync() {
    getLog().info("Triggering sync.");

    // it's ok to not wait for it here
    syncService.sync().then((res) => {
        if (res.success) {
            sqlInit.setDbAsInitialized();
        }
    });
}

async function sendSeedToSyncServer() {
    getLog().info("Initiating sync to server");

    await requestToSyncServer<void>("POST", "/api/setup/sync-seed", {
        options: getSyncSeedOptions(),
        syncVersion: appInfo.syncVersion
    });

    // this is a completely new sync, need to reset counters. If this was not a new sync,
    // the previous request would have failed.
    optionService.setOption("lastSyncedPush", 0);
    optionService.setOption("lastSyncedPull", 0);
}

async function requestToSyncServer<T>(method: string, path: string, body?: string | {}): Promise<T> {
    const timeout = syncOptions.getSyncTimeout();

    return (await timeLimit(
        request.exec({
            method,
            url: syncOptions.getSyncServerHost() + path,
            body,
            proxy: syncOptions.getSyncProxy(),
            timeout: timeout
        }),
        timeout
    )) as T;
}

async function setupSyncFromSyncServer(syncServerHost: string, syncProxy: string, password: string): Promise<SetupSyncFromServerResponse> {
    if (sqlInit.isDbInitialized()) {
        return {
            result: "failure",
            error: "DB is already initialized."
        };
    }

    const log = getLog();
    try {
        log.info("Getting document options FROM sync server.");

        // the response is expected to contain documentId and documentSecret options
        const resp = await request.exec<SetupSyncSeedResponse>({
            method: "get",
            url: `${syncServerHost}/api/setup/sync-seed`,
            auth: { password },
            proxy: syncProxy,
            timeout: 30000 // seed request should not take long
        });

        if (resp.syncVersion !== appInfo.syncVersion) {
            const message = `Could not setup sync since local sync protocol version is ${appInfo.syncVersion} while remote is ${resp.syncVersion}. To fix this issue, use same Trilium version on all instances.`;

            log.error(message);

            return {
                result: "failure",
                error: message
            };
        }

        await sqlInit.createDatabaseForSync(resp.options, syncServerHost, syncProxy);

        triggerSync();

        return { result: "success" };
    } catch (e: any) {
        log.error(`Sync failed: '${e.message}', stack: ${e.stack}`);

        return {
            result: "failure",
            error: e.message
        };
    }
}

function getSyncSeedOptions() {
    return [becca.getOption("documentId"), becca.getOption("documentSecret")];
}

export default {
    hasSyncServerSchemaAndSeed,
    triggerSync,
    sendSeedToSyncServer,
    setupSyncFromSyncServer,
    getSyncSeedOptions
};
