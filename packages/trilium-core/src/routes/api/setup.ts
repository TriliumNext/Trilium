import sqlInit from "../../services/sql_init.js";
import setupService from "../../services/setup.js";
import { getLog } from "../../services/log.js";
import appInfo from "../../services/app_info.js";
import optionService from "../../services/options.js";
import type { Request } from "express";
import { SetupSyncFromServerResponse } from "@triliumnext/commons";

function getStatus() {
    const isInitialized = sqlInit.isDbInitialized();
    const schemaExists = sqlInit.schemaExists();

    return {
        isInitialized,
        schemaExists,
        syncVersion: appInfo.syncVersion,
        // After a FAILED sync-from-server attempt the sync options are already stored in
        // the partial DB; expose them so the wizard can prefill the form when the user
        // goes back to correct it (#10548). Pre-initialization only: this endpoint is
        // unauthenticated, and once the instance is live the host must not leak here.
        ...(schemaExists && !isInitialized
            ? {
                syncServerHost: optionService.getOptionOrNull("syncServerHost") ?? "",
                syncProxy: optionService.getOptionOrNull("syncProxy") ?? ""
            }
            : {})
    };
}

async function setupNewDocument(req: Request) {
    const { skipDemoDb } = req.query;
    const locale = req.body?.locale;
    await sqlInit.createInitialDatabase(skipDemoDb !== undefined, locale);
}

function setupSyncFromServer(req: Request): Promise<SetupSyncFromServerResponse> {
    const { syncServerHost, syncProxy, password, syncMaxBlobContentSize } = req.body;

    const maxBlobContentSize = Number.isFinite(syncMaxBlobContentSize) && syncMaxBlobContentSize > 0 ? syncMaxBlobContentSize : 0;

    return setupService.setupSyncFromSyncServer(syncServerHost, syncProxy, password, maxBlobContentSize);
}

async function saveSyncSeed(req: Request) {
    const { options, syncVersion } = req.body;

    const log = getLog();
    if (appInfo.syncVersion !== syncVersion) {
        const message = `Could not setup sync since local sync protocol version is ${appInfo.syncVersion} while remote is ${syncVersion}. To fix this issue, use same Trilium version on all instances.`;

        log.error(message);

        return [
            400,
            {
                error: message
            }
        ];
    }

    log.info("Saved sync seed.");

    // Awaited so a failure surfaces as an error response to the pushing desktop
    // instead of an unhandled rejection with a 2xx already sent.
    await sqlInit.createDatabaseForSync(options);
}

/**
 * @swagger
 * /api/setup/sync-seed:
 *   get:
 *     tags:
 *       - auth
 *     summary: Sync documentSecret value
 *     description: First step to logging in.
 *     operationId: setup-sync-seed
 *     responses:
 *       '200':
 *         description: Successful operation
 *         content:
 *           application/json:
 *             schema:
 *               type: object
 *               properties:
 *                 syncVersion:
 *                   type: integer
 *                   example: 34
 *                 options:
 *                   type: object
 *                   properties:
 *                     documentSecret:
 *                       type: string
 *     security:
 *       - user-password: []
 */
function getSyncSeed() {
    getLog().info("Serving sync seed.");

    return {
        options: setupService.getSyncSeedOptions(),
        syncVersion: appInfo.syncVersion
    };
}

export default {
    getStatus,
    setupNewDocument,
    setupSyncFromServer,
    getSyncSeed,
    saveSyncSeed
};
