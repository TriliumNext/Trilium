import { holdSetup, withSetupLock } from "@triliumnext/core";
import fs from "fs";
import path from "path";

import { createChunkedUpload } from "./chunked_upload.js";
import dataDir from "./data_dir.js";
import {
    describeSize,
    logRestore,
    logRestoreError,
    readBackupFormat,
    removeQuietly,
    reportRestoreFailure,
    restoreDatabase,
    RestoreFailure,
    type RestoreFailureReason,
    type RestoreRequest,
    sizeOf
} from "./database_restore.js";

/**
 * Holds the backup the setup screen is about to restore, however it arrived, and starts the restore
 * when the user says so.
 *
 * There are two ways in and they converge here: a browser sends the file in chunks, and the desktop
 * points at one already on disk. Both end as *the pending backup*, so the passphrase prompt, the
 * retry after a wrong one, and the restore itself are one path rather than two that have to be kept
 * in step. A backup picked from this device's own backup directory needs nothing pending: it names
 * itself each time, and must survive being restored.
 *
 * Setup is reserved from the moment a backup is pending. What is coming replaces the database, and an
 * hour of uploading must not end with another tab having created a document in the meantime.
 *
 * @module
 */

/** No database is worth more than this, and an upload claiming to be is refused before it starts. */
const MAX_BACKUP_BYTES = 64 * 1024 * 1024 * 1024;

/** Failures another passphrase could still get past, which is the only reason to keep the backup. */
const RETRYABLE_WITH_ANOTHER_PASSPHRASE = new Set<RestoreFailureReason>([
    "passphrase-required",
    "wrong-passphrase-or-damaged-header"
]);

/**
 * Where a finished upload waits between arriving and being restored.
 *
 * Deliberately outside the restore's own working directory, which is emptied whenever a restore
 * ends: a wrong passphrase would otherwise take the uploaded backup with it, and the user would have
 * to send the whole file again to try another one.
 */
const PENDING_UPLOAD_PATH = path.join(dataDir.TMP_DIR, "uploads", "pending-backup");

/** The backup waiting to be restored, and what the screen needs to know about it. */
export interface PendingBackup {
    fileName: string;
    /** Whether the user has to be asked for a passphrase before anything can be done with it. */
    encrypted: boolean;
}

interface Pending extends PendingBackup {
    path: string;
    /** An upload exists only to be restored and may be consumed; a file of the user's may not. */
    consumable: boolean;
}

/**
 * How long a backup may wait to be restored before setup is given back, matching how long an upload
 * may go quiet for.
 *
 * A backup goes pending as soon as it arrives, which is before the user has been asked for its
 * passphrase — and they may never answer. Without a limit, closing that tab would leave the instance
 * refusing every other way of setting itself up until it was restarted.
 */
const PENDING_TTL_MS = 60 * 60 * 1000;

let pending: Pending | null = null;
let pendingExpiry: ReturnType<typeof setTimeout> | null = null;
let releaseSetupHold: (() => void) | null = null;
/**
 * Uploads that have been reserved for but are not open yet.
 *
 * Opening one sweeps away the sessions whose time has run out, and each of those reports itself as
 * discarded. Without counting the one being opened, that sweep would hand back the reservation the
 * upload took a moment earlier, on its way to taking its place.
 */
let opening = 0;

/** Receives a backup a chunk at a time, and makes what arrives the pending one. */
export const backupUpload = createChunkedUpload<PendingBackup>({
    name: "restore",
    directory: path.join(dataDir.TMP_DIR, "uploads"),
    maxTotalBytes: MAX_BACKUP_BYTES,
    requireFreeSpace: true,
    // The newest attempt wins. An upload whose connection is gone cannot say so, and until it aged
    // out it left the user refused every time they tried again — on the one screen where trying
    // again is all they can do, since a failed upload is what brought them back to it.
    whenAtCapacity: "supersede",
    // An upload that ends with nothing to show for it gives setup back. Expiry is the case that
    // needs saying: it happens on a timer, with no request to fail and nobody to tell, and without
    // this the instance would refuse every other way of setting itself up until it was restarted.
    onSessionDiscarded: () => {
        logRestore("an upload ended with nothing to show for it");
        releaseSetupIfUnused();
    },
    // The name the user gave the file is carried on, since the screen shows it back to them; it is
    // only the log that has no business repeating it.
    onComplete: async ({ path: uploadedPath, fileName, totalBytes }) => {
        logRestore(`an upload of ${describeSize(totalBytes)} arrived complete`);

        fs.mkdirSync(path.dirname(PENDING_UPLOAD_PATH), { recursive: true });
        fs.rmSync(PENDING_UPLOAD_PATH, { force: true });
        // A move rather than a copy: the file is the size of a database, and both ends are in the
        // same temporary directory.
        fs.renameSync(uploadedPath, PENDING_UPLOAD_PATH);

        return setPendingBackup(PENDING_UPLOAD_PATH, fileName, { consumable: true });
    }
});

/**
 * Begins receiving an uploaded backup, reserving setup before the first byte of it arrives.
 *
 * Reserved this early because the reservation is the point: an hour of uploading must not end with
 * another tab having created a document in the meantime. Given back by `onSessionDiscarded` if the
 * upload never becomes a backup.
 *
 * @throws ConflictError when setup is busy with something else.
 */
export async function beginBackupUpload(req: Parameters<typeof backupUpload.begin>[0]) {
    reserveSetup();
    opening++;

    try {
        const session = await backupUpload.begin(req);
        logRestore(`receiving a backup of ${describeSize(session.totalBytes)}`
            + ` in ${describeSize(session.chunkSize)} pieces`);

        return session;
    } catch (e) {
        logRestoreError(`an upload was refused before it started: ${e instanceof Error ? e.message : String(e)}`);
        throw e;
    } finally {
        // Counted down before the reservation is reconsidered, and reconsidered however this ended:
        // an upload refused because another one is already running must leave that one's reservation
        // exactly where it found it.
        opening--;
        releaseSetupIfUnused();
    }
}

/**
 * Makes the backup at `filePath` the one waiting to be restored, and reserves setup for it.
 *
 * @param options.consumable whether the restore may take the file rather than copy it. True only for
 *        a file that exists to be restored, i.e. an upload; never for one of the user's own.
 * @throws ConflictError when setup is busy with something else.
 */
export function setPendingBackup(filePath: string, fileName: string, options: { consumable: boolean }): PendingBackup {
    // Taken before the backup is recorded, so a refusal leaves nothing pending behind it. Released
    // when the restore ends, or when the backup is discarded.
    reserveSetup();

    pending = {
        path: filePath,
        fileName,
        consumable: options.consumable,
        // Stated in the clear in a container's header, so the screen knows to ask for a passphrase
        // without having to try the restore and fail first.
        encrypted: readBackupFormat(filePath)?.encrypted ?? false
    };
    schedulePendingExpiry();

    logRestore(`a backup of ${describeSize(sizeOf(filePath))} is waiting to be restored`
        + `${pending.encrypted ? ", and needs a passphrase" : ""}`);

    return { fileName: pending.fileName, encrypted: pending.encrypted };
}

/** The backup waiting to be restored, or `null` when none is. */
export function getPendingBackup(): PendingBackup | null {
    return pending && { fileName: pending.fileName, encrypted: pending.encrypted };
}

/** What a restore needs to know to run, for the backup that is pending. */
export function pendingRestoreRequest(): Omit<RestoreRequest, "passphrase"> | null {
    return pending && { path: pending.path, fileName: pending.fileName, consumable: pending.consumable };
}

/**
 * Starts a restore and returns at once, since unwrapping, checking and migrating a large database
 * outlast any sensible request or dialog. Progress is followed through
 * {@link getRestoreProgress}.
 *
 * The setup lock is held for the whole of it, not just for starting it.
 */
export function beginRestore(request: RestoreRequest): void {
    // A restore is not a backup waiting to be restored, and a large one can outlast the wait it is
    // allowed: left armed, the timer would delete the very file the restore is reading.
    cancelPendingExpiry();

    void withSetupLock("restore-backup", async () => {
        try {
            await restoreDatabase(request);
            discardPendingBackup();
        } catch (e) {
            // A passphrase that was wrong or missing is the one failure the same backup can still
            // recover from, so it is kept for the next attempt — and starts waiting again, since the
            // next attempt is another answer that may never come.
            if (!(e instanceof RestoreFailure) || !RETRYABLE_WITH_ANOTHER_PASSPHRASE.has(e.reason)) {
                discardPendingBackup();
            } else {
                schedulePendingExpiry();
            }

            throw e;
        }
    }).catch((e) => {
        // A restore that ran has already recorded why it stopped. One that was refused before it
        // began has recorded nothing, and a client polling for progress would wait on it forever.
        if (!(e instanceof RestoreFailure)) {
            reportRestoreFailure(request.fileName, e);
        }
    });
}

/**
 * Frees setup once the pending backup is restored, abandoned, or found to be unusable, and deletes it
 * if it was ours to delete.
 *
 * Runs while a failure is on its way to the user, so a file that will not go must not become the
 * failure they are told about. Setup is freed either way: a file left behind costs disk, a lock left
 * behind costs them every other way out of the setup screen.
 */
export function discardPendingBackup(): void {
    if (pending?.consumable) {
        logRestore("dropping the backup that was waiting, and the copy of it that was ours");
        removeQuietly(pending.path);
    }

    pending = null;
    cancelPendingExpiry();
    releaseSetupIfUnused();
}

/** Starts the wait over, so a backup only expires after it has been left alone for the whole of it. */
function schedulePendingExpiry(): void {
    cancelPendingExpiry();

    pendingExpiry = setTimeout(() => {
        logRestore("a backup waited to be restored for longer than it is allowed to");
        discardPendingBackup();
    }, PENDING_TTL_MS);
    // Nothing should be kept alive by a backup nobody came back for.
    pendingExpiry.unref?.();
}

function cancelPendingExpiry(): void {
    if (pendingExpiry) {
        clearTimeout(pendingExpiry);
        pendingExpiry = null;
    }
}

/** Reserves setup for the restore that is coming, if it is not reserved already. */
function reserveSetup(): void {
    releaseSetupHold ??= holdSetup("restore-backup");
}

/**
 * Gives setup back, but only once nothing a restore is doing still depends on it.
 *
 * There is one reservation and several things behind it: an upload being opened, uploads in flight,
 * and a backup waiting to be restored. Whichever of them ends first must not hand back what the
 * others are still standing on — a second upload being refused would otherwise unreserve setup for
 * the upload it was refused in favour of, and a pending backup expiring would unreserve it for an
 * upload halfway through replacing it.
 */
function releaseSetupIfUnused(): void {
    if (opening > 0 || pending !== null || backupUpload.activeSessions() > 0) {
        return;
    }

    releaseSetupHold?.();
    releaseSetupHold = null;
}
