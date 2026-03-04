import becca from "../becca/becca.js";
import type { SetupStatusResponse, SetupSyncSeedResponse } from "./api-interface.js";
import appInfo from "./app_info.js";
import log from "./log.js";
import optionService from "./options.js";
import request from "./request.js";
import sqlInit from "./sql_init.js";
import syncService from "./sync.js";
import syncOptions from "./sync_options.js";
import { timeLimit } from "./utils.js";

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
    log.info("Triggering sync.");

    // it's ok to not wait for it here
    syncService.sync().then((res) => {
        if (res.success) {
            sqlInit.setDbAsInitialized();
        }
    });
}

async function sendSeedToSyncServer() {
    log.info("Initiating sync to server");

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
            timeout
        }),
        timeout
    )) as T;
}

async function setupSyncFromSyncServer(syncServerHost: string, syncProxy: string, password: string, totpToken?: string) {
    if (sqlInit.isDbInitialized()) {
        return {
            result: "failure",
            error: "DB is already initialized."
        };
    }

    try {
        log.info("Getting document options FROM sync server.");

        // the response is expected to contain documentId and documentSecret options
        const resp = await request.exec<SetupSyncSeedResponse>({
            method: "get",
            url: `${syncServerHost}/api/setup/sync-seed`,
            auth: { password, totpToken },
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

async function checkRemoteTotpStatus(syncServerHost: string): Promise<{ totpEnabled: boolean }> {
    try {
        const resp = await request.exec<{ totpEnabled?: boolean }>({
            method: "get",
            url: `${syncServerHost}/api/setup/status`,
            proxy: null,
            timeout: 10000
        });
        return { totpEnabled: !!resp?.totpEnabled };
    } catch {
        return { totpEnabled: false };
    }
}

export default {
    hasSyncServerSchemaAndSeed,
    triggerSync,
    sendSeedToSyncServer,
    setupSyncFromSyncServer,
    getSyncSeedOptions,
    checkRemoteTotpStatus
};
