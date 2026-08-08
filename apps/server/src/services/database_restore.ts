import {
    type BackupContainerErrorReason,
    FIXED_HEADER_BYTES,
    isBackupContainerError,
    peekBackupContainer,
    type ProgressCallback,
    readBackupContainer
} from "@triliumnext/backup-container";
import {
    cls,
    type DatabaseRejection,
    events as eventService,
    getLog,
    getSql,
    leaveSetupMode,
    sql_init as sqlInit,
    utils as coreUtils
} from "@triliumnext/core";
import fs from "fs";
import path from "path";

import config from "./config.js";
import dataDir from "./data_dir.js";
import { validateDatabaseFile } from "./database_validation.js";

/**
 * Puts a backup in place of this instance's database.
 *
 * The database is open before the restore starts and has to be open after it, so the file cannot
 * simply be written over: the connection is detached, the file is exchanged, and a new connection is
 * attached to what is now there. On Windows that order is not a preference — an open handle prevents
 * the file from being renamed at all.
 *
 * Everything that can be checked is checked before the exchange, on a copy nothing is attached to,
 * because the alternative is finding out afterwards: the migration is what would otherwise notice an
 * unusable database, and a migration that cannot proceed ends the process outright.
 *
 * The database being replaced is kept aside until the restored one has migrated and opened. Until
 * then a marker sits next to it, so an interruption in the middle — a power cut, a killed process —
 * is recognised at the next start and undone, rather than leaving an instance that cannot open its
 * own document.
 *
 * Only ever run during setup, where nothing else holds the database: the share connection is opened
 * on `dbReady`, which has not resolved, and sessions are not persisted until the database is
 * initialized.
 *
 * @module
 */

/**
 * Prefix every line of a restore carries, so the whole of one can be picked out of a log by
 * searching for it.
 */
const LOG_PREFIX = "Backup restore: ";

/** Notes something that happened, for a log a user can be asked for and can hand over unread. */
export function logRestore(message: string): void {
    getLog().info(`${LOG_PREFIX}${withoutPaths(message)}`);
}

/** Notes something that went wrong. Reserved for actual failures; oddities that are handled use {@link logRestore}. */
export function logRestoreError(message: string): void {
    getLog().error(`${LOG_PREFIX}${withoutPaths(message)}`);
}

/**
 * Takes the filesystem out of anything on its way to the log.
 *
 * The backend log is meant to be postable for diagnostics without being censored first, and the data
 * directory carries the user's name on most platforms. Our own lines never name a file, but the
 * errors we quote back are not ours: a filesystem error states the full path it failed on. This is
 * the same treatment the backup service gives its own failures.
 */
function withoutPaths(text: string): string {
    let scrubbed = text;

    // Longest first, so a path inside the data directory is not reduced to the data directory and a
    // leftover fragment of itself. Each is scrubbed both as configured and as resolved, since an
    // error quotes back whichever form the call that failed was given.
    for (const [ directory, name ] of [
        [ dataDir.DOCUMENT_PATH, "<database>" ],
        [ dataDir.TMP_DIR, "<temporary files>" ],
        [ dataDir.BACKUP_DIR, "<backup location>" ],
        [ dataDir.TRILIUM_DATA_DIR, "<data directory>" ]
    ] as const) {
        for (const form of pathForms(directory)) {
            scrubbed = coreUtils.replaceAll(scrubbed, form, name);
        }
    }

    return scrubbed;
}

/**
 * The spellings of a configured location that could turn up in an error, longest first.
 *
 * A data directory may be configured relatively — `TRILIUM_DATA_DIR=data` is what the development
 * scripts use — so the resolved form is what a filesystem error names, while our own calls pass the
 * configured one. A bare word is dropped: replacing "data" as a substring turns every "database" in
 * a sentence into "<data directory>base".
 */
function pathForms(directory: string): string[] {
    const resolved = path.resolve(directory);
    const looksLikePath = directory.includes(path.sep) || directory.includes("/");

    return resolved === directory || !looksLikePath
        ? [ resolved ]
        : [ resolved, directory ].sort((a, b) => b.length - a.length);
}

/**
 * How much of the way through a step has to pass before it is worth another line.
 *
 * A log is read after the fact, so what it needs from a step that runs for minutes is a trail
 * proving it was moving, not a running total. Every tenth is ten or eleven lines however long the
 * step takes, which is enough to tell a slow unwrap from a stalled one.
 */
const PROGRESS_LOG_STEP = 10;

/**
 * How often the container module is asked to report.
 *
 * Half the rate the screen polls at, so what it is shown is never much older than it is, and far
 * below the rate the module would report at left alone.
 */
const PROGRESS_INTERVAL_MS = 500;

/**
 * Passes the container module's progress on to both places that want it, each at its own rate.
 *
 * The screen is polled about once a second and wants the latest position every time, so every report
 * reaches it. The log wants the opposite: its reader comes to it afterwards and needs a trail, not a
 * running total, so a line is written only when the position has actually moved on a tenth. Writing
 * every report to both would make a stall indistinguishable from progress in the one place where
 * that distinction is all there is.
 */
export function reportStepProgress(activity: string): ProgressCallback {
    let lastLogged = -1;

    return (fraction) => {
        if (progress) {
            progress = { ...progress, fraction };
        }

        const percent = Math.floor(fraction * 100);
        const step = Math.floor(percent / PROGRESS_LOG_STEP);

        if (step > lastLogged) {
            lastLogged = step;
            logRestore(`${activity} [${percent}%]`);
        }
    };
}

/** How big a file is, counting one that cannot be measured as nothing rather than failing over it. */
export function sizeOf(filePath: string): number {
    return fs.statSync(filePath, { throwIfNoEntry: false })?.size ?? 0;
}

/** What a size is worth saying in a log line: the number, in units a person reads at a glance. */
export function describeSize(bytes: number): string {
    const units = [ "bytes", "KiB", "MiB", "GiB" ];
    let size = bytes;
    let unit = 0;

    while (size >= 1024 && unit < units.length - 1) {
        size /= 1024;
        unit++;
    }

    return `${unit === 0 ? size : size.toFixed(1)} ${units[unit]}`;
}

/** How long something took, for the steps that can take long enough to be worth asking about. */
function describeElapsed(since: number): string {
    return `${((Date.now() - since) / 1000).toFixed(1)}s`;
}

/** What the restore is doing, in the order it does it. */
export type RestoreStage =
    /** Getting the backup into a plain database file: unwrapping a container, or taking the upload. */
    | "staging"
    /** Reading that file to see whether it can be this instance's database. */
    | "validating"
    /** Detaching, exchanging the files, and attaching again. Over in moments. */
    | "swapping"
    /** Opening the restored database, which for an older one includes migrating it. */
    | "migrating"
    | "done"
    | "failed";

/** Why a restore stopped, in terms the setup screen turns into something the user can act on. */
export type RestoreFailureReason =
    | DatabaseRejection
    | BackupContainerErrorReason
    /** The files could not be exchanged; the original database is back in place. */
    | "swap-failed"
    /** The restored database is in place but would not open. */
    | "migration-failed"
    /** The restore never started, e.g. setup was busy with something else. */
    | "restore-refused";

export interface RestoreProgress {
    stage: RestoreStage;
    /** The name of the backup being restored, so a reloaded page can say what is going on. */
    fileName: string;
    /**
     * How far through the current step, from 0 to 1.
     *
     * Absent for the steps that cannot say — checking a database reads it from beginning to end with
     * nothing to report along the way, and exchanging the files is over in moments. It belongs to the
     * step rather than to the restore, and starts again with each one.
     */
    fraction?: number;
    /** Set when `stage` is `failed`. */
    error?: string;
    /** Set when `stage` is `failed`. */
    reason?: RestoreFailureReason;
}

export interface RestoreRequest {
    /** Where the backup is now. */
    path: string;
    /** What to call it when reporting on it. */
    fileName: string;
    /**
     * Whether the restore may take the file rather than copy it. True for an upload's temporary file,
     * whose only purpose is this; false for a backup in the backup directory, which must survive.
     */
    consumable: boolean;
    /** Required for an encrypted backup. */
    passphrase?: string;
}

let progress: RestoreProgress | null = null;

/** How the running or last restore is getting on, or `null` if none has been started. */
export function getRestoreProgress(): RestoreProgress | null {
    return progress;
}

/**
 * Restores `request` over this instance's database, reporting its way through
 * {@link getRestoreProgress}.
 *
 * Callers hold the setup lock for the whole call: a second setup operation starting midway through
 * would build a database over the one being restored, and neither would report anything wrong.
 *
 * @throws RestoreFailure carrying the reason, which is also left in the progress for the client that
 *         is polling rather than waiting.
 */
export async function restoreDatabase(request: RestoreRequest): Promise<void> {
    const startedAt = Date.now();

    // The name is left out on purpose: it is the user's, and everything worth knowing about the file
    // is stated below in terms that are not.
    logRestore(`starting, from ${request.consumable ? "a backup this instance was given" : "a backup already on this device"}`);

    // Announced through `report` like every other step, so that a log can be read by looking for the
    // steps alone and the first one is not the exception that is missing.
    progress = { stage: "staging", fileName: request.fileName };
    report("staging");

    try {
        // The whole restore runs in one execution context: what follows the swap writes to the
        // database, and the request that started this is long since answered.
        await cls.init(async () => {
            const candidate = await stageBackup(request);

            report("validating");
            const validatedAt = Date.now();
            const validation = validateDatabaseFile(candidate);
            if (!validation.valid) {
                throw new RestoreFailure(validation.rejection, validation.message);
            }
            logRestore(`checked in ${describeElapsed(validatedAt)}: database version ${validation.dbVersion}`
                + `, ${validation.needsMigration ? "needs migrating" : "already current"}`);

            report("swapping");
            swapInDatabase(candidate);

            report("migrating");
            await openRestoredDatabase(validation.needsMigration);
        });

        report("done");
        logRestore(`finished in ${describeElapsed(startedAt)}`);
    } catch (e) {
        // Read before the progress is overwritten with the failure, which would otherwise report
        // every failure as having happened at the 'failed' step.
        const failedAt = progressStage();
        const failure = asFailure(e);

        progress = {
            stage: "failed",
            fileName: request.fileName,
            error: failure.message,
            reason: failure.reason
        };
        logRestoreError(`failed at the '${failedAt}' step after ${describeElapsed(startedAt)}`
            + ` (${failure.reason}): ${failure.message}`);

        throw failure;
    } finally {
        // Whatever happened, the temporary files are of no further use. Tidying up is never allowed
        // to throw from here: an exception raised in a `finally` replaces the one on its way out, so
        // a directory that would not delete used to bury the reason the restore actually failed —
        // and with it the client's only way of telling a wrong passphrase from a broken backup.
        removeQuietly(stagingDirectory(), { recursive: true });
    }
}

/**
 * Records a failure that happened *instead of* a restore rather than during one, e.g. one that was
 * refused before it could start.
 *
 * Without this such a failure is reported nowhere: {@link restoreDatabase} never ran, so it left no
 * progress behind, and a client polling for one waits on a run that is never going to begin.
 */
export function reportRestoreFailure(fileName: string, error: unknown): void {
    progress = {
        stage: "failed",
        fileName,
        error: messageOf(error),
        reason: error instanceof RestoreFailure ? error.reason : "restore-refused"
    };
}

/**
 * Undoes a restore that was interrupted between the database being moved aside and the restored one
 * opening.
 *
 * Runs at startup, before the database is opened, and before core is initialized — so it says what it
 * did through the console rather than the log, which does not exist yet.
 */
export function recoverInterruptedRestore(document: string = dataDir.DOCUMENT_PATH): void {
    if (!fs.existsSync(markerFor(document))) {
        return;
    }

    const setAside = setAsideFor(document);
    if (fs.existsSync(setAside)) {
        console.info(`${LOG_PREFIX}a restore was interrupted partway; putting the previous database back.`);
        removeDatabaseFiles(document);
        fs.renameSync(setAside, document);
        console.info(`${LOG_PREFIX}the previous database is back in place.`);
    } else {
        // Nothing was set aside, so either the exchange had not started or it had finished: the
        // database in place is the one to open either way.
        console.info(`${LOG_PREFIX}a restore was interrupted; the database in place is intact.`);
    }

    fs.rmSync(markerFor(document), { force: true });
}

/**
 * Moves `document` aside and puts `candidate` in its place, which is the whole of the exchange as far
 * as the filesystem is concerned.
 *
 * Separate from the detaching and attaching around it so that what happens to the files can be
 * exercised on its own, and so the order is stated in one place: aside first, sidecars after it,
 * candidate last.
 */
export function exchangeDatabaseFiles(candidate: string, document: string): void {
    const setAside = setAsideFor(document);

    fs.rmSync(setAside, { force: true });
    if (fs.existsSync(document)) {
        fs.renameSync(document, setAside);
    }

    // The sidecars belong to the database that was just moved away; left behind, SQLite would read
    // them as this one's.
    removeSidecars(document);

    moveInto(candidate, document);
}

/** A failure with a reason attached, so the setup screen can tell the cases apart. */
export class RestoreFailure extends Error {
    constructor(readonly reason: RestoreFailureReason, message: string) {
        super(message);
        this.name = "RestoreFailure";
    }
}

/** What a backup file is, read from its header rather than from what it is called. */
export interface BackupFormat {
    /** Whether it is a container rather than a plain copy of a database. */
    container: boolean;
    /** Whether a passphrase is needed to unwrap it. */
    encrypted: boolean;
}

/**
 * Identifies a backup file from its first few dozen bytes, which is where a container states what it
 * is, in the clear and without the passphrase.
 *
 * Goes by the header rather than the extension: a container renamed to `.db` is still a container,
 * and a database renamed to `.tnbackup` is still a database.
 *
 * @returns what the file is, or `null` when it cannot be read at all.
 */
export function readBackupFormat(filePath: string): BackupFormat | null {
    const head = Buffer.alloc(FIXED_HEADER_BYTES);
    let descriptor: number | undefined;

    try {
        descriptor = fs.openSync(filePath, "r");
        fs.readSync(descriptor, head, 0, head.length, 0);
    } catch {
        return null;
    } finally {
        if (descriptor !== undefined) {
            fs.closeSync(descriptor);
        }
    }

    const container = peekBackupContainer(head);

    return { container: !!container, encrypted: container?.encrypted ?? false };
}

/**
 * Produces the plain database file the rest of the restore works on.
 *
 * An uploaded database is used where it lies: it exists only to be restored, and copying it would
 * mean writing gigabytes a second time to no purpose. A container is unwrapped, and a backup from the
 * backup directory is copied, since that one has to stay where it is.
 */
export async function stageBackup(request: RestoreRequest): Promise<string> {
    const format = readBackupFormat(request.path);
    if (!format) {
        throw new RestoreFailure("not-a-database", "The backup could not be read.");
    }

    const sourceBytes = sizeOf(request.path);
    logRestore(`the backup is ${format.container ? "a container" : "a plain database"}`
        + `${format.encrypted ? ", encrypted" : ""}, ${describeSize(sourceBytes)}`);

    if (!format.container) {
        if (request.consumable) {
            logRestore("using the backup where it lies, since it is ours to spend");
            return request.path;
        }

        const candidate = freshCandidatePath();
        const copiedAt = Date.now();
        await fs.promises.copyFile(request.path, candidate);
        logRestore(`copied the backup aside in ${describeElapsed(copiedAt)}, since the original has to survive`);

        return candidate;
    }

    // Asked before the file is read rather than after: an encrypted container without a passphrase
    // fails the same way either way, but only one of them takes minutes to get there.
    if (format.encrypted && !request.passphrase) {
        throw new RestoreFailure("passphrase-required", "The backup is encrypted.");
    }

    const candidate = freshCandidatePath();
    const source = fs.createReadStream(request.path);
    const destination = fs.createWriteStream(candidate);
    const unwrappedAt = Date.now();

    try {
        const unwrapped = await readBackupContainer(source, destination, {
            passphrase: request.passphrase,
            // The step that runs for minutes on a large backup, and the only one that can say how far
            // through it is. Without this the log jumps from the format to the finished size, which
            // reads the same whether it took a moment or is still going.
            onProgress: reportStepProgress("unwrapping the backup"),
            progressIntervalMs: PROGRESS_INTERVAL_MS
        });
        logRestore(`unwrapped a version ${unwrapped.version} container in ${describeElapsed(unwrappedAt)}`
            + `: ${describeSize(unwrapped.bytesWritten)} of database`
            + `${unwrapped.compressed ? `, from ${describeSize(sourceBytes)} compressed` : ""}`);
    } finally {
        // Both streams are closed here rather than left to the reader, which only ends them once it
        // gets as far as its pipeline: a wrong passphrase is refused before that, from the header, so
        // on a failure the two handles are still open. Windows will not let an open file be deleted
        // or replaced, which turns one wrong password into a staging directory that cannot be
        // cleared and an uploaded backup that cannot be overwritten by the next attempt.
        await closeStream(source);
        await closeStream(destination);
    }

    if (request.consumable) {
        await fs.promises.rm(request.path, { force: true });
    }

    return candidate;
}

/**
 * Exchanges the database file for `candidate`, leaving the old one aside under a marker until the
 * restored one has opened.
 *
 * Detaching, moving and attaching are one step as far as anything outside is concerned: either the
 * instance ends up on the restored database or back on the one it had.
 */
function swapInDatabase(candidate: string): void {
    const document = dataDir.DOCUMENT_PATH;

    // States nobody put the instance in on purpose. None of them stops the restore, and each one
    // explains a shape the files could otherwise only be found in afterwards.
    if (fs.existsSync(markerFor(document))) {
        logRestore("a marker from an earlier restore was still in place; it is being replaced");
    }
    if (fs.existsSync(setAsideFor(document))) {
        logRestore("a database set aside by an earlier restore was still there; it is being replaced");
    }
    if (fs.existsSync(`${document}-wal`) || fs.existsSync(`${document}-shm`)) {
        logRestore("the database has sidecar files, so it was not closed cleanly; they go with it");
    }

    // Written before anything moves: from here until the restored database opens, an interruption
    // leaves files that only this marker explains.
    fs.writeFileSync(markerFor(document), "");

    logRestore(`detaching the database being replaced (${describeSize(sizeOf(document))})`);
    getSql().detachConnection();

    try {
        exchangeDatabaseFiles(candidate, document);
        logRestore(`exchanged the files; the restored database is ${describeSize(sizeOf(document))}`);

        getSql().attachFromFile(document, config.General.readOnly);
        logRestore("attached to the restored database");
    } catch (e) {
        logRestoreError(`the exchange failed, putting the previous database back: ${messageOf(e)}`);
        putBack(setAsideFor(document), document);
        attachQuietly(document);

        throw new RestoreFailure("swap-failed", messageOf(e));
    }
}

/**
 * Brings the restored database up: migrates it where it is older than this version, opens it, and
 * announces it, which is what starts everything that waits on a database being there.
 *
 * Announced here rather than through `setDbAsInitialized`, which does nothing when the database says
 * it is already initialized — and a restored one does, since it was initialized before it was backed
 * up. Mirrors what the "create new document" path does for the same reason.
 */
async function openRestoredDatabase(needsMigration: boolean): Promise<void> {
    const document = dataDir.DOCUMENT_PATH;
    const openedAt = Date.now();

    // The one step that can run for minutes without anything to show for it, since migrating takes a
    // backup of its own first. Said in advance so a log that stops here is not read as a hang.
    logRestore(needsMigration
        ? "opening the restored database, which is being migrated first and may take a while"
        : "opening the restored database");

    // Whatever asked this instance into setup has had its answer, and until this is said the
    // instance keeps reporting that it has nothing to open, which is what `initDbConnection` checks.
    leaveSetupMode();

    try {
        await sqlInit.initDbConnection();
    } catch (e) {
        logRestoreError(`the restored database would not open, putting the previous one back: ${messageOf(e)}`);
        putBack(setAsideFor(document), document);
        attachQuietly(document);

        throw new RestoreFailure("migration-failed", messageOf(e));
    }

    logRestore(`the restored database is open after ${describeElapsed(openedAt)}`);
    eventService.emit(eventService.DB_INITIALIZED);

    // The restore is over, so neither the previous database nor the marker has anything left to say.
    removeQuietly(setAsideFor(document));
    removeQuietly(markerFor(document));
}

/** Where the database being replaced waits until the restored one has opened. */
function setAsideFor(document: string): string {
    return `${document}.pre-restore`;
}

/** Says that an exchange is under way, for a start that finds the pieces of an interrupted one. */
function markerFor(document: string): string {
    return `${document}.restore-in-progress`;
}

/**
 * Moves the restore on to its next step, and says so.
 *
 * Every step is logged as it is entered, so a restore that stops says where it stopped even when
 * nothing threw — a process killed mid-swap leaves its last step as the last thing in the log.
 */
function report(stage: RestoreStage): void {
    if (progress) {
        // The position belonged to the step that has just ended, and would otherwise be read as this
        // one's — a step with nothing to report showing the last one's bar, frozen where it stopped.
        progress = { ...progress, stage, fraction: undefined };
    }

    logRestore(`step '${stage}'`);
}

/** The step the restore had reached, for saying where it was when something went wrong. */
function progressStage(): RestoreStage | "unknown" {
    return progress?.stage ?? "unknown";
}

/**
 * Deletes something that is no longer wanted, and carries on if it will not go.
 *
 * Every use of this is cleaning up after something else, on a path that is already reporting its own
 * outcome. A leftover temporary file is worth a line in the log; it is not worth replacing the answer
 * the caller was about to give, and on Windows a file another process has briefly opened — a virus
 * scanner, an indexer — is a failure that says nothing about the operation at hand.
 */
export function removeQuietly(target: string, options: { recursive?: boolean } = {}): void {
    try {
        // `recursive` is spelled out rather than passed through: `fs.rmSync` merges the options over
        // its defaults, so a property that is present and undefined replaces the default rather than
        // leaving it alone, and every call that omitted it failed its own type check.
        fs.rmSync(target, { force: true, recursive: options.recursive === true });
    } catch (e) {
        logRestoreError(`a temporary file would not go away: ${messageOf(e)}`);
    }
}

/**
 * Releases a stream's file handle and waits for the operating system to agree that it is released.
 *
 * Waiting is the point: `destroy()` only asks, and the handle is still open until `close` fires.
 * Anything that then tries to delete or replace the file on Windows fails until it does.
 */
function closeStream(stream: NodeJS.EventEmitter & { closed: boolean; destroy(): void }): Promise<void> {
    if (stream.closed) {
        return Promise.resolve();
    }

    return new Promise((resolve) => {
        stream.once("close", () => resolve());
        stream.destroy();
    });
}

function stagingDirectory(): string {
    return path.join(dataDir.TMP_DIR, "restore");
}

function freshCandidatePath(): string {
    const directory = stagingDirectory();
    fs.mkdirSync(directory, { recursive: true });

    return path.join(directory, "candidate.db");
}

/**
 * Moves a file to where it is wanted, falling back to a copy across filesystem boundaries — which is
 * where a relocated temporary directory can put it.
 */
function moveInto(source: string, destination: string): void {
    try {
        fs.renameSync(source, destination);
    } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "EXDEV") {
            throw e;
        }

        // Worth saying: it turns the last step from instant into another full write of the database,
        // which is otherwise a mysteriously slow finish on an instance with a relocated temp
        // directory.
        logRestore("the temporary files are on another filesystem, so the last step is a copy rather than a rename");
        const copiedAt = Date.now();

        fs.copyFileSync(source, destination);
        fs.rmSync(source, { force: true });

        logRestore(`copied into place in ${describeElapsed(copiedAt)}`);
    }
}

/** Puts the database that was set aside back, for a restore that got no further. */
function putBack(setAside: string, document: string): void {
    if (!fs.existsSync(setAside)) {
        logRestore("nothing had been set aside yet, so there is nothing to put back");
        return;
    }

    try {
        removeDatabaseFiles(document);
        fs.renameSync(setAside, document);
        logRestore("the previous database is back in place");
    } catch (e) {
        // Nothing else can be done from here, and the marker is still in place: the next start
        // finds it and puts the database back before anything opens it.
        logRestoreError(`the previous database could not be put back, leaving it to the next start: ${messageOf(e)}`);
    }
}

/** Re-attaches after a rollback. A failure here is reported, not raised: the caller is already failing. */
function attachQuietly(document: string): void {
    try {
        getSql().attachFromFile(document, config.General.readOnly);
        logRestore("re-attached to the previous database");
    } catch (e) {
        logRestoreError(`the database could not be re-opened after the failed restore: ${messageOf(e)}`);
    }
}

function removeDatabaseFiles(document: string): void {
    fs.rmSync(document, { force: true });
    removeSidecars(document);
}

function removeSidecars(document: string): void {
    fs.rmSync(`${document}-wal`, { force: true });
    fs.rmSync(`${document}-shm`, { force: true });
}

function asFailure(e: unknown): RestoreFailure {
    if (e instanceof RestoreFailure) {
        return e;
    }
    if (isBackupContainerError(e)) {
        return new RestoreFailure(e.reason, e.message);
    }

    return new RestoreFailure("swap-failed", messageOf(e));
}

function messageOf(e: unknown): string {
    return e instanceof Error ? e.message : String(e);
}
