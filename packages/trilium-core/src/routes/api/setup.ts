import sqlInit from "../../services/sql_init.js";
import setupService from "../../services/setup.js";
import { getRunningSetupOperation, withSetupLock } from "../../services/setup_lock.js";
import {
    deleteExistingData,
    getExistingBackupStatus,
    keepExistingData,
    startBackUpExistingData
} from "../../services/setup_existing.js";
import { asSetupTargetScreen, getSetupPlatform } from "../../services/setup_mode.js";
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
        // What another tab, or this one after a reload, has already started. Lets the wizard say so
        // rather than only finding out by being refused.
        setupOperation: getRunningSetupOperation(),
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

/**
 * Asks the next start of this instance to come up in the setup wizard rather than in the app.
 *
 * Writes the marker and answers; restarting is the caller's half, since only the client knows how
 * this platform restarts. The language is filled in here from the instance's own option rather than
 * taken from the request: it has to be the language whose database is about to be left closed.
 */
async function bootToSetup(req: Request) {
    const targetScreen = asSetupTargetScreen(req.body?.targetScreen);

    await getSetupPlatform().writeMarker({
        lang: optionService.getOptionOrNull("locale") ?? "en",
        ...(targetScreen ? { targetScreen } : {})
    });

    getLog().info(`Boot to setup requested${targetScreen ? ` for "${targetScreen}"` : ""}.`);
}

/**
 * Starts backing up the database the wizard was booted away from.
 *
 * Answers as soon as the write is underway rather than once it is done: the write runs for minutes
 * on a large database, and on standalone a request rides the service worker, whose fetches the
 * browser reclaims after a few minutes no matter how patient the caller is. The screen follows the
 * write, and learns where it went, through {@link existingBackupStatus}.
 */
function backUpExisting() {
    startBackUpExistingData(new Date());
}

/**
 * Where the backup stands, for the screen waiting on it: how far along, and once it is over, what
 * was written or what stopped it.
 *
 * Polled rather than pushed: the screen is the only thing asking, and a push would need a channel
 * that setup does not otherwise have.
 */
function existingBackupStatus() {
    return getExistingBackupStatus();
}

/** Erases that database. Everything else in the data directory, backups included, stays. */
async function deleteExisting() {
    await deleteExistingData();
}

/** Abandons setup and opens the database that was there all along. */
async function keepExisting() {
    await keepExistingData();
}

async function setupNewDocument(req: Request) {
    const { skipDemoDb } = req.query;
    const locale = req.body?.locale;

    await withSetupLock("new-document", () => sqlInit.createInitialDatabase(skipDemoDb !== undefined, locale));
}

/**
 * The lock covers fetching the seed and creating the schema, not the sync that follows: an
 * interrupted sync is resumed and retried across later requests, and a failed one has to leave the
 * user free to take another path instead.
 */
function setupSyncFromServer(req: Request): Promise<SetupSyncFromServerResponse> {
    const { syncServerHost, syncProxy, password, syncMaxBlobContentSize } = req.body;

    const maxBlobContentSize = Number.isFinite(syncMaxBlobContentSize) && syncMaxBlobContentSize > 0 ? syncMaxBlobContentSize : 0;

    return withSetupLock("sync-from-server", () =>
        setupService.setupSyncFromSyncServer(syncServerHost, syncProxy, password, maxBlobContentSize));
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
    await withSetupLock("sync-seed", () => sqlInit.createDatabaseForSync(options));
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
    bootToSetup,
    backUpExisting,
    existingBackupStatus,
    deleteExisting,
    keepExisting,
    setupNewDocument,
    setupSyncFromServer,
    getSyncSeed,
    saveSyncSeed
};
