import {
    asFileName,
    defaultBackupName,
    type SetupBackupDefaults,
    type SetupBackupSettings,
    type SetupExistingBackup,
    type SetupExistingBackupStatus
} from "@triliumnext/commons";

import { getBackup } from "./backup.js";
import eventService from "./events.js";
import { getLog } from "./log.js";
import optionService from "./options.js";
import {
    getSetupPlatform,
    hasExistingData,
    isInitialSetup,
    leaveSetupMode,
    markExistingDataDiscarded
} from "./setup_mode.js";
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
 * @param settings what the user answered on the screen before this one; already resolved by
 *                 {@link resolveBackupSettings}, so nothing here has to guess at a missing answer.
 * @throws Error where the platform cannot write a backup, or the write itself failed.
 */
export async function backUpExistingData(
    settings: SetupBackupSettings
): Promise<SetupExistingBackup> {
    requireExistingData();

    const backup = getBackup();
    if (!backup.backupAs) {
        throw new Error("This platform cannot write a backup of the existing database.");
    }

    getLog().info("Setup: backing up the existing database before it is replaced.");
    progress = 0;

    try {
        const written = await backup.backupAs(settings, reportProgress);
        getLog().info(`Setup: the existing database was backed up (${written.fileSize} bytes).`);

        return written;
    } finally {
        progress = null;
    }
}

/**
 * What the instance is already set up to do, which is what the screen offers as its answers.
 *
 * The stored passphrase is reported as a yes or a no and never as itself: a screen that could read
 * it could be made to hand it over, and it is the one thing standing between a stolen backup and
 * the knowledge base inside it.
 */
export async function getExistingBackupDefaults(): Promise<SetupBackupDefaults> {
    const backup = getBackup();

    return {
        storedPassphrase: (await backup.hasStoredPassphrase?.()) ?? false,
        encrypt: isOptionEnabled("backupEnableEncryption"),
        compress: isOptionEnabled("backupEnableCompression")
    };
}

/**
 * Settles what a backup asked for over a request is actually written as.
 *
 * Every field is treated as something a caller may have got wrong or left out rather than as an
 * answer: what arrives here has crossed a request boundary, and the name in particular goes on to
 * become a path. Anything missing falls back to what the instance is configured for, so a caller
 * that asks for nothing at all still gets the backup it would have got before there was anything to
 * ask.
 *
 * @param now the moment to name the backup after, where the caller named nothing usable.
 */
export function resolveBackupSettings(now: Date, requested: unknown): SetupBackupSettings {
    const asked = (typeof requested === "object" && requested !== null
        ? requested
        : {}) as Partial<Record<keyof SetupBackupSettings, unknown>>;

    return {
        // Reduced to a single name that no directory can be escaped from, whatever was sent.
        name: asFileName(typeof asked.name === "string" ? asked.name : "")
            ?? defaultBackupName(now),
        passphrase: typeof asked.passphrase === "string" ? asked.passphrase : "",
        useStoredPassphrase: typeof asked.useStoredPassphrase === "boolean"
            ? asked.useStoredPassphrase
            : isOptionEnabled("backupEnableEncryption"),
        compress: typeof asked.compress === "boolean"
            ? asked.compress
            : isOptionEnabled("backupEnableCompression")
    };
}

/**
 * Reads leniently, the way the backup itself does: setup runs against a database that has not been
 * migrated, so an option added by a newer version may not be there to read at all.
 */
function isOptionEnabled(name: "backupEnableCompression" | "backupEnableEncryption"): boolean {
    return optionService.getOptionOrNull(name) === "true";
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
 *
 * @param now the moment to name the backup after, where `requested` named nothing usable.
 * @param requested what the user answered on the screen before this one, as it arrived.
 */
export function startBackUpExistingData(now: Date, requested?: unknown): void {
    if (status.state === "running") {
        return;
    }

    requireExistingData();
    if (!getBackup().backupAs) {
        throw new Error("This platform cannot write a backup of the existing database.");
    }

    status = { state: "running", fraction: null };
    backUpExistingData(resolveBackupSettings(now, requested))
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
 * Deliberately late: the user answers for a backup on the way into the wizard, but nothing is
 * touched until they pick a path that replaces the database, and this is what those paths call
 * first. Up to here every screen can still be left through Cancel with the knowledge base intact.
 *
 * The one path that does not call it is restoring a backup, and for a reason worth keeping: a
 * restore validates the file and only then swaps the database, so a backup that turns out to be
 * unusable leaves the user with what they already had. Erasing first would throw that away.
 */
export async function deleteExistingData(): Promise<void> {
    requireExistingData();

    getLog().info("Setup: erasing the existing database at the user's request.");
    await getSetupPlatform().removeDatabase();
    markExistingDataDiscarded();
    getLog().info("Setup: the existing database is gone.");
}

/**
 * The same, for callers that do not know whether there is anything to erase.
 *
 * Which is every path that creates a database: it runs identically on a first run, where there
 * never was one, and on an instance the app sent here, where there is one right up until this call.
 */
export async function discardExistingData(): Promise<void> {
    if (hasExistingData()) {
        await deleteExistingData();
    }
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
 *
 * The second case is the same thing later on: once the user has picked a path and the database has
 * gone, a screen still offering to back it up or to go back to it is a screen acting on something
 * that is no longer there.
 */
function requireExistingData(): void {
    if (isInitialSetup()) {
        throw new Error("There is no existing database: this instance is being set up for the first time.");
    }
    if (!hasExistingData()) {
        throw new Error("The existing database has already been discarded during this setup.");
    }
}

function messageOf(e: unknown): string {
    return e instanceof Error ? e.message : String(e);
}
