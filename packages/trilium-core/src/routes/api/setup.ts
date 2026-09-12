import sqlInit from "../../services/sql_init.js";
import setupService from "../../services/setup.js";
import { getRunningSetupOperation, withSetupLock } from "../../services/setup_lock.js";
import {
    deleteExistingData,
    discardExistingData,
    getExistingBackupDefaults,
    getExistingBackupStatus,
    keepExistingData,
    startBackUpExistingData
} from "../../services/setup_existing.js";
import { authenticateSetup, isSetupAuthRequired, isSetupSecondFactorRequired } from "../../services/setup_auth.js";
import { asSetupTargetScreen, getSetupPlatform, hasExistingData } from "../../services/setup_mode.js";
import { getLog } from "../../services/log.js";
import appInfo from "../../services/app_info.js";
import optionService from "../../services/options.js";
import type { Request } from "express";
import { SetupSyncFromServerResponse } from "@triliumnext/commons";

function getStatus() {
    const isInitialized = sqlInit.isDbInitialized();
    const schemaExists = sqlInit.schemaExists();
    // Whether the wizard has to be unlocked before it will do anything, which the screen has to know
    // before it can ask. Says only that a password is wanted, never anything about the password.
    const authRequired = isSetupAuthRequired();

    return {
        isInitialized,
        schemaExists,
        authRequired,
        // Says a second factor is wanted, never which kind nor anything about the answer.
        secondFactorRequired: isSetupSecondFactorRequired(),
        // Asked again rather than taken from the page's own start: the paths that replace a
        // knowledge base erase it here, and a wizard that failed after one of them did would go on
        // offering a way back to something that no longer exists.
        hasExistingData: hasExistingData(),
        syncVersion: appInfo.syncVersion,
        // What another tab, or this one after a reload, has already started. Lets the wizard say so
        // rather than only finding out by being refused.
        setupOperation: getRunningSetupOperation(),
        // After a FAILED sync-from-server attempt the sync options are already stored in
        // the partial DB; expose them so the wizard can prefill the form when the user
        // goes back to correct it (#10548). Pre-initialization only: this endpoint is
        // unauthenticated, and once the instance is live the host must not leak here. Withheld
        // too while the wizard is locked, since that is a live instance's own database sitting
        // behind it, and its sync server is not for anyone who can reach the port to read.
        ...(schemaExists && !isInitialized && !authRequired
            ? {
                syncServerHost: optionService.getOptionOrNull("syncServerHost") ?? "",
                syncProxy: optionService.getOptionOrNull("syncProxy") ?? ""
            }
            : {})
    };
}

/**
 * Unlocks the wizard with the password of the knowledge base sitting behind it.
 *
 * Rate limited from the outside like every other password check. Answers with the token the rest of
 * the setup routes want, or with a plain no: which of the two is the only thing it ever says about
 * the password.
 */
async function authenticate(req: Request) {
    const password = typeof req.body?.password === "string" ? req.body.password : "";
    const totpToken = typeof req.body?.totpToken === "string" ? req.body.totpToken : "";
    const token = await authenticateSetup(password, totpToken);

    return token ? { authenticated: true, token } : { authenticated: false };
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
 * Whether a request made earlier is still waiting to be acted on.
 *
 * Of interest only where the instance cannot restart itself: an owner who asked their server to
 * start over restarts it by hand, and until they do, this is the difference between a request that
 * was made and one that was not.
 */
async function isBootToSetupRequested() {
    return { requested: await getSetupPlatform().hasMarker() };
}

/** Calls it off, for a request made and then thought better of before the restart. */
async function cancelBootToSetup() {
    await getSetupPlatform().removeMarker();

    getLog().info("Boot to setup cancelled.");
}

/**
 * Starts backing up the database the wizard was booted away from.
 *
 * Answers as soon as the write is underway rather than once it is done: the write runs for minutes
 * on a large database, and on standalone a request rides the service worker, whose fetches the
 * browser reclaims after a few minutes no matter how patient the caller is. The screen follows the
 * write, and learns where it went, through {@link existingBackupStatus}.
 *
 * What the user chose on the way in arrives in the body, and is treated as a request rather than as
 * an instruction: nothing in it is trusted, and anything missing falls back to what the instance is
 * already configured for.
 */
function backUpExisting(req: Request) {
    startBackUpExistingData(new Date(), req.body);
}

/**
 * What the screen asking those questions offers as its answers: how this instance already backs up.
 *
 * Says whether a passphrase is stored rather than what it is. The passphrase is kept where the
 * interface cannot read it, which is exactly why the screen has to offer using it as a choice
 * instead of filling it into a box.
 */
function existingBackupDefaults() {
    return getExistingBackupDefaults();
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

/**
 * The knowledge base the wizard was booted away from, where there is one, is erased here rather
 * than on the way into the wizard: this is the first moment the user has committed to replacing it.
 * Inside the lock, so the erasure and what replaces it are one operation as far as any other
 * request is concerned.
 */
async function setupNewDocument(req: Request) {
    const { skipDemoDb } = req.query;
    const locale = req.body?.locale;

    await withSetupLock("new-document", async () => {
        await discardExistingData();
        await sqlInit.createInitialDatabase(skipDemoDb !== undefined, locale);
    });
}

/**
 * The lock covers erasing what was there, fetching the seed and creating the schema, not the sync
 * that follows: an interrupted sync is resumed and retried across later requests, and a failed one
 * has to leave the user free to take another path instead.
 *
 * The erasure is not done here, unlike the path above it. Reaching a sync server can fail on a
 * mistyped host, a refused password or a version mismatch, and each of those has to leave the
 * knowledge base where it was — so it is done inside, once the server has answered and the next
 * step is the one that cannot be taken back.
 */
function setupSyncFromServer(req: Request): Promise<SetupSyncFromServerResponse> {
    const { syncServerHost, syncProxy, password, syncMaxBlobContentSize } = req.body;

    const maxBlobContentSize = Number.isFinite(syncMaxBlobContentSize) && syncMaxBlobContentSize > 0 ? syncMaxBlobContentSize : 0;

    return withSetupLock("sync-from-server", () =>
        setupService.setupSyncFromSyncServer(syncServerHost, syncProxy, password, maxBlobContentSize));
}

/**
 * Takes a database pushed by another desktop, which is how the sync-from-desktop path is fed.
 *
 * The push arrives from the other device and carries nothing this instance issued, so it cannot be
 * held to the wizard's own password. What holds it instead is the state it is allowed to arrive in:
 * a schema is created here by wiping whatever is in the way, so this is refused outright while there
 * is still a knowledge base behind the wizard. The local user clears that themselves, on the screen
 * that starts waiting for the push, and that screen is behind the password.
 *
 * A first run has nothing behind the wizard and is unaffected, which is the case this route exists
 * for.
 */
async function saveSyncSeed(req: Request) {
    const { options, syncVersion } = req.body;

    const log = getLog();
    if (hasExistingData()) {
        const message = "This instance still holds a knowledge base of its own. Choose \"Connect a desktop app\" on its setup screen first.";

        log.error(`Refused a pushed sync seed: ${message}`);

        return [ 400, { error: message } ];
    }

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
    authenticate,
    bootToSetup,
    isBootToSetupRequested,
    cancelBootToSetup,
    backUpExisting,
    existingBackupDefaults,
    existingBackupStatus,
    deleteExisting,
    keepExisting,
    setupNewDocument,
    setupSyncFromServer,
    getSyncSeed,
    saveSyncSeed
};
