import { getBackup, NotFoundError, ValidationError } from "@triliumnext/core";
import type { Request } from "express";
import path from "path";

import type ServerBackupService from "../../backup_provider.js";
import { getRestoreProgress, type RestoreProgress, type RestoreRequest } from "../../services/database_restore.js";
import {
    backupUpload,
    beginBackupUpload,
    beginRestore,
    discardPendingBackup,
    pendingRestoreRequest
} from "../../services/restore_session.js";

/**
 * The setup screen's way back from a backup: list what is already on disk, take a file that is not,
 * and restore whichever the user picks.
 *
 * Every endpoint here is reachable without authentication on a first run, because before a database
 * exists there is nobody to authenticate — the same footing the rest of the setup wizard stands on.
 * What that costs is bounded deliberately: one upload at a time, a ceiling on its size, a session
 * that expires, and a path from the listing that is checked against the backup directories rather
 * than taken at its word. Where a knowledge base IS sitting behind the wizard there is somebody to
 * authenticate, and `checkSetupAuth` asks for them: a restore replaces that database.
 *
 * @module
 */

async function beginUpload(req: Request) {
    return await beginBackupUpload(req);
}

async function uploadChunk(req: Request) {
    return await backupUpload.chunk(req);
}

async function uploadStatus(req: Request) {
    return await backupUpload.status(req);
}

async function finishUpload(req: Request) {
    return await backupUpload.finish(req);
}

async function abortUpload(req: Request) {
    await backupUpload.abort(req);
    discardPendingBackup();
}

/**
 * Restores the backup the user picked: the one waiting to be restored, or one from this device's
 * backup directory.
 *
 * Answers as soon as the restore is under way rather than when it is over. The client follows the
 * rest through {@link status}.
 */
function start(req: Request) {
    const { source, filePath, passphrase } = (req.body ?? {}) as StartBody;
    const request = source === "existing" ? existingBackup(filePath) : pendingBackup();

    beginRestore({ ...request, passphrase });

    return { started: true };
}

function status(): { restore: RestoreProgress | null } {
    return { restore: getRestoreProgress() };
}

/** Drops the sweeper's timer. Only the tests have any use for a shutdown this tidy. */
function stop() {
    backupUpload.stop();
}

export default {
    beginUpload,
    uploadChunk,
    uploadStatus,
    finishUpload,
    abortUpload,
    start,
    status,
    stop
};

interface StartBody {
    /** `existing` names a backup from this device; anything else restores the pending one. */
    source?: "pending" | "existing";
    /** Only for `existing`: which backup, from the listing. */
    filePath?: string;
    passphrase?: string;
}

function pendingBackup(): Omit<RestoreRequest, "passphrase"> {
    const request = pendingRestoreRequest();
    if (!request) {
        throw new NotFoundError("No backup is waiting to be restored.");
    }

    return request;
}

/**
 * A backup from the listing, resolved through the backup service rather than trusted: the path
 * arrives from a client, on an endpoint that needs no authentication.
 */
function existingBackup(filePath: string | undefined): Omit<RestoreRequest, "passphrase"> {
    if (!filePath) {
        throw new ValidationError("No backup was named.");
    }

    const backup = getBackup() as ServerBackupService;
    const resolvedPath = backup.resolveBackupPath(filePath);
    if (!resolvedPath) {
        throw new NotFoundError("No such backup.");
    }

    return { path: resolvedPath, fileName: path.basename(resolvedPath), consumable: false };
}
