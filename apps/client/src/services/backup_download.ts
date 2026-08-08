import { defaultBackupName, type StandaloneDownloadResult } from "@triliumnext/commons";

import { tidyFilesystemFriendlyName } from "../widgets/react/FilesystemFriendlyName";

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

/** Reserved device names on Windows, which cannot be a filename there whatever the extension. */
const RESERVED_FILE_NAMES = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

/** Whether this platform backs up by streaming a download, which is the standalone build. */
export function isBackupDownloadSupported(): boolean {
    return !!window.standaloneApi;
}

/**
 * The file a name is written to.
 *
 * The name arrives already tidied by the field it was typed into; this applies the same rules
 * again, because a name can also arrive from somewhere that never saw that field, and adds the two
 * things only a filename cares about: a name that is left empty, and the device names Windows
 * reserves whatever the extension. Either falls back to the suggested name rather than failing.
 */
export function backupFileName(name: string): string {
    const tidied = tidyFilesystemFriendlyName(name);
    const usable = tidied && !RESERVED_FILE_NAMES.test(tidied) ? tidied : defaultBackupName(new Date());

    return `${usable}${BACKUP_EXTENSION}`;
}

/**
 * Starts the download and resolves with how it ended, which is when the stream behind it has been
 * fully produced — the closest thing to "finished" the application can see, with the browser's
 * own download UI carrying the transfer itself.
 *
 * @param passphrase encrypts the container. Omitted or empty leaves it unencrypted, which is still
 *                   a container: one format, one extension, whatever the user chose.
 */
export async function startBackupDownload(
    fileName: string,
    passphrase?: string
): Promise<StandaloneDownloadResult> {
    const api = window.standaloneApi;
    if (!api) {
        return { status: "failed", message: "This platform does not back up by download." };
    }

    return await api.backup.downloadDatabase(fileName, passphrase || undefined);
}
