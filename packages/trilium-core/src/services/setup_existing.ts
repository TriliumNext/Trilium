import { defaultBackupName, type SetupExistingBackup, type SetupExistingBackupStatus } from "@triliumnext/commons";

import { getBackup } from "./backup.js";
import eventService from "./events.js";
import { getLog } from "./log.js";
import { getSetupPlatform, isInitialSetup, leaveSetupMode } from "./setup_mode.js";
import sqlInit from "./sql_init.js";

/**
 * What becomes of the database an instance was booted away from.
 *
 * Setup normally runs where there is nothing to lose. When the app itself asks for setup there is a
 * whole knowledge base sitting behind the wizard, and the user is asked, before anything else, what
 * should happen to it. That question has exactly three answers, and they are the three functions
 * here: keep it and go back, back it up, or erase it.
 *
 * All three run against a database that is attached but not initialized, which is what setup mode
 * means. That is enough for a backup: options are read straight from the table when becca is not
 * loaded, and the backup itself copies a file. It is deliberately not enough for anything to be
 * written to the database, which nothing here does.
 *
 * @module
 */

/**
 * Backs the existing database up, and says where it went.
 *
 * The format is the one the instance is already configured for: compressed or not, encrypted or not,
 * in the chosen directory or the default one. Nothing is asked again here, because the answer is in
 * the options the user already gave, and this is not the moment to be asking about formats.
 *
 * @param now the moment to name the backup after; passed in so the name is the caller's to decide.
 * @throws Error where the platform cannot write a backup, or the write itself failed.
 */
export async function backUpExistingData(now: Date): Promise<SetupExistingBackup> {
    requireExistingData();

    const backup = getBackup();
    if (!backup.backupAs) {
        throw new Error("This platform cannot write a backup of the existing database.");
    }

    getLog().info("Setup: backing up the existing database before it is replaced.");
    progress = 0;

    try {
        const written = await backup.backupAs(defaultBackupName(now), reportProgress);
        getLog().info(`Setup: the existing database was backed up (${written.fileSize} bytes).`);

        return written;
    } finally {
        progress = null;
    }
}

/**
 * Starts the backup and answers at once, leaving the outcome to be polled for.
 *
 * The write itself runs for minutes on a large knowledge base, and a request held open that long
 * does not survive every platform: on standalone it rides the service worker, whose fetches the
 * browser reclaims after a few minutes however patient the caller is. So the caller that would have
 * waited on {@link backUpExistingData} starts it here and follows it through
 * {@link getExistingBackupStatus} instead.
 *
 * A backup already running is joined rather than doubled. What can be refused outright (no
 * existing database, a platform with nowhere to write) still throws from here, so the starting
 * request carries the reason.
 */
export function startBackUpExistingData(now: Date): void {
    if (status.state === "running") {
        return;
    }

    requireExistingData();
    if (!getBackup().backupAs) {
        throw new Error("This platform cannot write a backup of the existing database.");
    }

    status = { state: "running", fraction: null };
    backUpExistingData(now)
        .then((written) => {
            status = { state: "done", fraction: 1, result: written };
        })
        .catch((e) => {
            status = { state: "failed", fraction: null, error: messageOf(e) };
        });
}

/** Where the latest backup stands, for the screen polling its way through it. */
export function getExistingBackupStatus(): SetupExistingBackupStatus {
    return status.state === "running" ? { ...status, fraction: progress } : status;
}

let status: SetupExistingBackupStatus = { state: "idle", fraction: null };

/**
 * How far through the backup is, from 0 to 1, or `null` when none is running.
 *
 * Read by the screen that is waiting on it. A backup of a large knowledge base runs for minutes,
 * most of it inside one write that says nothing, and a screen with nothing to show for that long is
 * indistinguishable from one that has stopped.
 */
export function getExistingBackupProgress(): number | null {
    return progress;
}

let progress: number | null = null;
/** The last tenth that was logged, so a long write leaves a trail without flooding the log. */
let loggedTenth = -1;

function reportProgress(fraction: number): void {
    progress = fraction;

    const tenth = Math.floor(fraction * 10);
    if (tenth > loggedTenth) {
        loggedTenth = tenth;
        getLog().info(`Setup: backing up the existing database [${Math.round(fraction * 100)}%]`);
    }
    if (fraction >= 1) {
        loggedTenth = -1;
    }
}

/**
 * Erases the existing database, which is the point of no return.
 *
 * Only ever reached from a screen that has said as much, and only after the user has either taken a
 * backup or refused one. What follows is the rest of the wizard, on an instance that now genuinely
 * has nothing.
 */
export async function deleteExistingData(): Promise<void> {
    requireExistingData();

    getLog().info("Setup: erasing the existing database at the user's request.");
    await getSetupPlatform().removeDatabase();
    getLog().info("Setup: the existing database is gone.");
}

/**
 * Abandons setup and opens the database that was there all along.
 *
 * The way out of every screen in this part of the wizard, including the one that warns about
 * erasure. Nothing has been touched up to this point, so there is nothing to undo: the instance
 * stops answering as uninitialized and comes up as it would have.
 */
export async function keepExistingData(): Promise<void> {
    requireExistingData();

    getLog().info("Setup: leaving the existing database as it was.");
    await getSetupPlatform().removeMarker();
    leaveSetupMode();

    await sqlInit.initDbConnection();
    eventService.emit(eventService.DB_INITIALIZED);
}

/**
 * Refuses everything here on an instance that has nothing to lose.
 *
 * These operations only make sense between an app asking for setup and the wizard getting past the
 * question, and each of them is destructive or irreversible in its own way. A first run reaching
 * them means something is wrong, not that there is an empty database to erase.
 */
function requireExistingData(): void {
    if (isInitialSetup()) {
        throw new Error("There is no existing database: this instance is being set up for the first time.");
    }
}

function messageOf(e: unknown): string {
    return e instanceof Error ? e.message : String(e);
}
