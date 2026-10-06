import { asFileName, defaultBackupName, type StandaloneDownloadResult } from "@triliumnext/commons";

/**
 * Backing up by download, which is the standalone platform's one and only backup.
 *
 * Standalone keeps no backups anywhere: the browser's storage holds the live database and could
 * rarely hold a copy of it beside itself, so a backup is streamed straight off the database into a
 * browser download instead. The options screen and the setup screen both back up through here, so
 * the naming and the format live in exactly one place.
 *
 * @module
 */

/** Every backup is a container, with or without a password, so every backup has this extension. */
const BACKUP_EXTENSION = ".tnbackup";

/** Whether this platform backs up by streaming a download, which is the standalone build. */
export function isBackupDownloadSupported(): boolean {
    return !!window.standaloneApi;
}

/**
 * The file a name is written to.
 *
 * The name arrives already tidied by the field it was typed into, and is put through the same rules
 * again here, because a name can also arrive from somewhere that never saw that field. What is left
 * of one that empties itself out, or that turns out to be a name the system keeps for itself, is
 * the suggested name rather than a failure.
 */
export function backupFileName(name: string): string {
    return `${asFileName(name) ?? defaultBackupName(new Date())}${BACKUP_EXTENSION}`;
}

/**
 * Starts the backup and resolves with how it ended, which is when the stream behind it has been
 * fully produced — the closest thing to "finished" the application can see, with the browser's
 * own download UI carrying the transfer itself.
 *
 * Inside the mobile shell there is no download manager to carry it, so the backup is written onto
 * the device and offered to the share sheet instead; the result then carries where it went.
 *
 * @param passphrase encrypts the container. Omitted or empty leaves it unencrypted, which is still
 *                   a container: one format, one extension, whatever the user chose.
 */
export async function startBackupDownload(
    fileName: string,
    passphrase?: string,
    onProgress?: (sentBytes: number, totalBytes: number) => void
): Promise<StandaloneDownloadResult> {
    const backup = window.standaloneApi?.backup;
    if (!backup) {
        return { status: "failed", message: "This platform does not back up by download." };
    }

    const take = backup.saveDatabase ?? backup.downloadDatabase;
    return await take.call(backup, fileName, passphrase || undefined, onProgress);
}
