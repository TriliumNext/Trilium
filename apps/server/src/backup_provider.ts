import {
    FIXED_HEADER_BYTES,
    peekBackupContainer,
    writeBackupContainer
} from "@triliumnext/backup-container";
import type { DatabaseBackup } from "@triliumnext/commons";
import { BackupOptionsService, BackupService, getLog, sync_mutex as syncMutexService, utils as coreUtils, ws } from "@triliumnext/core";
import fs from "fs";
import fsp from "fs/promises";
import { t } from "i18next";
import path from "path";

import dataDir from "./services/data_dir.js";
import sql from "./services/sql.js";

/**
 * Backups that are compressed, encrypted or both are containers rather than plain database copies.
 */
const CONTAINER_EXTENSION = ".tnbackup";
const DATABASE_EXTENSION = ".db";

export interface ServerBackupConfig {
    /**
     * Whether the `customDbBackupDir` option is honoured. Set by the desktop application, where the user
     * picks the directory themselves; on the server the backup location is part of the deployment and is
     * configured through the `TRILIUM_BACKUP_DIR` environment variable instead.
     */
    allowCustomDirectory?: boolean;
    /**
     * Reads the stored backup passphrase, or `null` when there is none to be had. Set by the
     * desktop application, which is the only one with an OS keyring to keep a passphrase in.
     */
    getPassphrase?: () => Promise<string | null>;
}

/** How a backup is to be written, once the options and the passphrase have both had their say. */
interface BackupFormat {
    compress: boolean;
    passphrase: string | null;
    /**
     * Set when encryption was asked for and could not be delivered. The backup is still worth
     * having, but it must stay in the default directory: the chosen one is typically a synced
     * folder, and putting an unencrypted database there is the very thing encryption was turned on
     * to avoid.
     */
    keepLocal: boolean;
}

export default class ServerBackupService extends BackupService {

    constructor(options: BackupOptionsService, private readonly config: ServerBackupConfig = {}) {
        super(options);
    }

    override async getExistingBackups(): Promise<DatabaseBackup[]> {
        return this.getBackupDirectories().flatMap(listBackupsIn);
    }

    override getBackupFolderPath(): string {
        return this.getCustomBackupDir() ?? getDefaultBackupDir();
    }

    override scheduleBackups(): void {
        // Run regular backups every 4 hours
        setInterval(() => this.regularBackup(), 4 * 60 * 60 * 1000);

        // Kickoff first backup soon after startup
        setTimeout(() => this.regularBackup(), 5 * 60 * 1000);
    }

    override async backupNow(name: string): Promise<string> {
        // Sanitize backup name to prevent path traversal (CWE-22).
        // Only allow alphanumeric characters, hyphens, and underscores.
        const sanitizedName = name.replace(/[^a-zA-Z0-9_-]/g, "");
        if (!sanitizedName) {
            throw new Error("Invalid backup name: must contain at least one alphanumeric character, hyphen, or underscore.");
        }

        const baseName = `backup-${sanitizedName}`;

        // we don't want to back up DB in the middle of sync with potentially inconsistent DB state
        return await syncMutexService.doExclusively(async () => {
            const format = await this.resolveFormat();
            const customDir = format.keepLocal ? null : this.getCustomBackupDir();

            if (customDir) {
                try {
                    return await writeBackup(customDir, baseName, format, "custom");
                } catch (e) {
                    // A backup that cannot reach the chosen location is still worth having, so the
                    // default one takes over instead of the backup being lost altogether. The reason
                    // reaches the log; where it was headed reaches only the user, in the toast.
                    getLog().error(`Could not back up to the custom backup location, using the default one instead: ${e}`);
                    ws.sendMessageToAllClients({
                        type: "toast",
                        message: t("backup.custom_directory_unwritable", { location: customDir }),
                        timeout: 15000
                    });
                }
            }

            return await writeBackup(getDefaultBackupDir(), baseName, format, "default");
        });
    }

    override async getBackupContent(filePath: string): Promise<Uint8Array | null> {
        const resolvedPath = path.resolve(filePath);

        // Security check: ensure the path is within one of the backup directories
        if (!this.getBackupDirectories().some((dir) => isInsideDirectory(dir, resolvedPath))) {
            return null;
        }

        if (!fs.existsSync(resolvedPath)) {
            return null;
        }

        return fs.readFileSync(resolvedPath);
    }

    /**
     * Settles what the backup is written as. Compression alone needs nothing but the option;
     * encryption also needs a passphrase, and where that cannot be read the backup falls back to
     * being unencrypted and local rather than not being taken at all.
     */
    private async resolveFormat(): Promise<BackupFormat> {
        // Read leniently: the pre-migration backup runs before the options added by newer versions
        // exist.
        const isEnabled = (name: "backupEnableCompression" | "backupEnableEncryption") =>
            this.options.getOptionOrNull(name) === "true";

        const compress = isEnabled("backupEnableCompression");
        if (!isEnabled("backupEnableEncryption")) {
            return { compress, passphrase: null, keepLocal: false };
        }

        const passphrase = (await this.config.getPassphrase?.()) ?? null;
        if (passphrase) {
            return { compress, passphrase, keepLocal: false };
        }

        getLog().error("Could not read the backup passphrase; backing up unencrypted to the "
            + "default location.");
        ws.sendMessageToAllClients({
            type: "toast",
            message: t("backup.passphrase_unavailable"),
            timeout: 15000
        });

        return { compress, passphrase: null, keepLocal: true };
    }

    /** The directory the user chose to back up to, or `null` when the default one applies. */
    private getCustomBackupDir(): string | null {
        if (!this.config.allowCustomDirectory) {
            return null;
        }

        const customDir = this.options.getOptionOrNull("customDbBackupDir")?.trim();
        if (!customDir) {
            return null;
        }

        const resolved = path.resolve(customDir);
        return resolved !== getDefaultBackupDir() ? resolved : null;
    }

    /**
     * Every directory that may hold backups. The default one stays in the list next to a custom
     * directory, since it still holds the backups taken before the custom one was chosen, as well as
     * the ones redirected there after a failed write.
     */
    private getBackupDirectories(): string[] {
        const customDir = this.getCustomBackupDir();
        const defaultDir = getDefaultBackupDir();

        return customDir ? [ customDir, defaultDir ] : [ defaultDir ];
    }

}

function getDefaultBackupDir(): string {
    return path.resolve(dataDir.BACKUP_DIR);
}

/** Both paths must already be resolved. Unlike a prefix comparison, this also holds at a drive root. */
function isInsideDirectory(directory: string, filePath: string): boolean {
    const relative = path.relative(directory, filePath);

    return !!relative && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function listBackupsIn(directory: string): DatabaseBackup[] {
    let fileNames: string[];
    try {
        fileNames = fs.readdirSync(directory);
    } catch {
        // Missing or unreadable, e.g. a custom directory on a drive that is no longer plugged in.
        return [];
    }

    return fileNames
        // The extension check excludes intermediate files (e.g. *.db-journal, *.part) created while
        // a backup is in progress.
        .filter((fileName) => fileName.includes("backup")
            && (fileName.endsWith(DATABASE_EXTENSION) || fileName.endsWith(CONTAINER_EXTENSION)))
        .flatMap((fileName) => {
            const filePath = path.resolve(directory, fileName);
            const stat = fs.statSync(filePath, { throwIfNoEntry: false });
            if (!stat) {
                return [];
            }

            return [
                { fileName,
                    filePath,
                    mtime: stat.mtime,
                    fileSize: stat.size,
                    ...describeContainer(filePath, fileName) }
            ];
        });
}

/**
 * What a container is, read from its own header rather than from today's options: a backup keeps
 * the shape it was written in, whatever the settings have since become.
 *
 * Only the fixed header is read, so this costs a few dozen bytes per file and never needs the
 * passphrase. A file whose header does not parse is listed as a plain one rather than not at all.
 */
function describeContainer(filePath: string, fileName: string): Partial<DatabaseBackup> {
    if (!fileName.endsWith(CONTAINER_EXTENSION)) {
        return {};
    }

    const head = Buffer.alloc(FIXED_HEADER_BYTES);
    let descriptor: number | undefined;
    try {
        descriptor = fs.openSync(filePath, "r");
        fs.readSync(descriptor, head, 0, head.length, 0);
    } catch {
        return {};
    } finally {
        if (descriptor !== undefined) {
            fs.closeSync(descriptor);
        }
    }

    const info = peekBackupContainer(head);
    if (!info) {
        return {};
    }

    return {
        compressed: info.compressed,
        encrypted: info.encrypted,
        // Recorded as 0 when the writer did not know it, which reads the same as "not stated".
        plaintextSize: info.plaintextSize > 0 ? info.plaintextSize : undefined
    };
}

async function writeBackup(
    directory: string,
    baseName: string,
    format: BackupFormat,
    location: "default" | "custom"
): Promise<string> {
    const isContainer = format.compress || format.passphrase !== null;
    const fileName = `${baseName}${isContainer ? CONTAINER_EXTENSION : DATABASE_EXTENSION}`;
    const backupFile = path.resolve(directory, fileName);

    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });

    getLog().info("Creating backup...");
    try {
        if (isContainer) {
            await writeContainer(backupFile, baseName, format);
        } else {
            await sql.copyDatabase(backupFile);
        }
    } catch (e) {
        // Whatever was written before the failure is not a usable backup, and would otherwise be
        // listed and offered for download as if it were one.
        fs.rmSync(backupFile, { force: true });
        throw new Error(withoutDirectory(e, directory));
    }

    // One backup name, one file: a container retires the plain copy it replaces, and the other way
    // round.
    const counterpart = `${baseName}${isContainer ? DATABASE_EXTENSION : CONTAINER_EXTENSION}`;
    fs.rmSync(path.resolve(directory, counterpart), { force: true });

    getLog().info(`Created backup .${path.sep}${fileName}${location === "custom" ? " in the custom backup location." : ""}`);

    return backupFile;
}

/**
 * Wraps the database into a container.
 *
 * SQLite's backup API writes to a path rather than a stream, so a snapshot has to land somewhere
 * before it can be fed to the writer. It lands in the data directory's temp folder and is deleted
 * straight after, so the backup directory never holds a plain database even for a moment.
 */
async function writeContainer(
    backupFile: string,
    baseName: string,
    format: BackupFormat
): Promise<void> {
    const snapshot = path.resolve(dataDir.TMP_DIR, `${baseName}.snapshot.db`);
    const partial = `${backupFile}.part`;

    try {
        await sql.copyDatabase(snapshot);

        await writeBackupContainer(fs.createReadStream(snapshot), fs.createWriteStream(partial), {
            compress: format.compress,
            passphrase: format.passphrase ?? undefined,
            plaintextSize: fs.statSync(snapshot).size,
            // The digest is only known once the payload is written, so it is patched in afterwards.
            patchHeader: async (offset, data) => {
                const handle = await fsp.open(partial, "r+");
                try {
                    await handle.write(data, 0, data.length, offset);
                    await handle.sync();
                } finally {
                    await handle.close();
                }
            }
        });

        // Renamed last, so a half-written container is never mistaken for a finished one.
        fs.renameSync(partial, backupFile);
    } finally {
        fs.rmSync(snapshot, { force: true });
        fs.rmSync(partial, { force: true });
    }
}

/**
 * Keeps the backup directory out of anything that reaches the log. It carries the user's name on most
 * platforms, and the backend log is meant to be shareable for diagnostics without having to be censored
 * first — so the reason for a failure is kept and the location filesystem errors quote back is not.
 */
function withoutDirectory(error: unknown, directory: string): string {
    const message = error instanceof Error ? error.message : String(error);

    return coreUtils.replaceAll(message, directory, "<backup location>");
}
