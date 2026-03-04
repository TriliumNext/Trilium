

import type { Request } from "express";

import appInfo from "../../services/app_info.js";
import log from "../../services/log.js";
import setupService from "../../services/setup.js";
import sqlInit from "../../services/sql_init.js";
import totp from "../../services/totp.js";

function getStatus() {
    return {
        isInitialized: sqlInit.isDbInitialized(),
        schemaExists: sqlInit.schemaExists(),
        syncVersion: appInfo.syncVersion,
        totpEnabled: totp.isTotpEnabled()
    };
}

async function setupNewDocument() {
    await sqlInit.createInitialDatabase();
}

function setupSyncFromServer(req: Request) {
    const { syncServerHost, syncProxy, password, totpToken } = req.body;

    return setupService.setupSyncFromSyncServer(syncServerHost, syncProxy, password, totpToken);
}

function saveSyncSeed(req: Request) {
    const { options, syncVersion } = req.body;

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

    sqlInit.createDatabaseForSync(options);
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
    log.info("Serving sync seed.");

    return {
        options: setupService.getSyncSeedOptions(),
        syncVersion: appInfo.syncVersion
    };
}

async function checkServerTotpStatus(req: Request) {
    const { syncServerHost } = req.body;

    if (!syncServerHost) {
        return { totpEnabled: false };
    }

    try {
        const resp = await setupService.checkRemoteTotpStatus(syncServerHost);
        return { totpEnabled: !!resp.totpEnabled };
    } catch {
        return { totpEnabled: false };
    }
}

export default {
    getStatus,
    setupNewDocument,
    setupSyncFromServer,
    getSyncSeed,
    saveSyncSeed,
    checkServerTotpStatus
};
