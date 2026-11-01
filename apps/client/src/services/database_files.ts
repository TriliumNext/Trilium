import { dayjs } from "@triliumnext/commons";

import { formatDateTime } from "../utils/formatters.js";
import { t } from "./i18n.js";
import { formatSize } from "./utils.js";

/** A file holding a database: a backup, or an anonymized copy. */
export interface DatabaseFile {
    fileName: string;
    filePath: string;
    mtime: Date;
    /** Size of the file, in bytes. */
    fileSize: number;
    /**
     * Size of the database the file was made from, in bytes, where that differs from the file's own
     * size — a compressed backup, say. Both are then shown, so the saving is visible.
     */
    plaintextSize?: number;
    /**
     * Why the file cannot be restored from, where its own header says as much. Absent for a plain
     * copy and for a container this build can open.
     */
    unreadable?: "invalid" | "unsupported-version";
}

/**
 * When the file was written, and how big it is.
 *
 * A file made from a database larger than itself states both, so what compressing it saved is
 * visible rather than having to be worked out.
 *
 * Shared by every list of these files — the backups in the options, the backups the setup screen
 * offers to restore from — so that one line reads the same wherever it appears.
 */
/**
 * What a backup was written as, as short labels: compressed, encrypted, or neither.
 *
 * Read from the file's own header rather than from today's settings, so it describes the backup as
 * it is. Shared by every list of these files, so that the same file is described the same way
 * wherever it is shown.
 */
export function describeDatabaseFormat(file: { compressed?: boolean; encrypted?: boolean }): string[] {
    const badges: string[] = [];

    if (file.compressed) {
        badges.push(t("backup.compressed"));
    }
    if (file.encrypted) {
        badges.push(t("backup.encrypted"));
    }

    return badges;
}

export function describeDatabaseFile(file: DatabaseFile): string {
    const parts = [ file.mtime ? formatDateTime(file.mtime) : "-" ];

    if (file.plaintextSize && file.plaintextSize !== file.fileSize) {
        parts.push(formatSize(file.plaintextSize), t("database_file_list.size_on_disk", { size: formatSize(file.fileSize) }));
    } else {
        parts.push(formatSize(file.fileSize));
    }

    // Last, after the two facts that identify which file this is. The date and the size are kept
    // rather than replaced because they are what tells the user why it is no good: a backup that
    // stopped halfway is the size of how far it got.
    if (file.unreadable) {
        parts.push(file.unreadable === "invalid"
            ? t("database_file_list.invalid_backup")
            : t("database_file_list.unsupported_version"));
    }

    return parts.join(" • ");
}

/**
 * How many backups there are and how long ago the last one was made — the two things a list of them
 * only answers by being read through. Nothing is said while there are none: wherever this is shown
 * the list itself, or the page it links to, states that more plainly than a sentence could.
 *
 * Shared by the backup page's own header and by the Database page's summary of it, so that the two
 * never state the same thing differently.
 */
export function summarizeBackups(backups: { mtime: Date }[]): string | null {
    if (!backups.length) {
        return null;
    }

    const mostRecent = backups.reduce((latest, backup) => (
        backup.mtime > latest.mtime ? backup : latest
    ));

    return t("backup.backups_summary", {
        count: backups.length,
        age: dayjs(mostRecent.mtime).fromNow(true)
    });
}
