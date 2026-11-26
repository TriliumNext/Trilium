import {
    FIXED_HEADER_BYTES,
    getInfo,
    writeBackupContainer
} from "@triliumnext/backup-container";
import type {
    DatabaseBackup,
    SetupBackupSettings,
    SetupExistingBackup
} from "@triliumnext/commons";
import { BackupOptionsService, BackupService, getLog, sync_mutex as syncMutexService, utils as coreUtils, ws } from "@triliumnext/core";
import type { Response } from "express";
import fs from "fs";
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
    /**
     * Whether a passphrase is stored, without reading it. While one is, every backup that nobody is
     * asked about is encrypted.
     */
    isPassphraseStored?: () => boolean;
    /**
     * Stores the backup passphrase. Set alongside {@link getPassphrase}, and used by the restore
     * rather than by any screen.
     */
    setPassphrase?: (passphrase: string) => Promise<void>;
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

    /**
     * Writes the backup the setup screen asked for, and says what was written.
     *
     * The name is used as it stands, spaces and all, because the screen shows it to the user and
     * the user then goes looking for it in a file manager. It is safe to use that way because it
     * has already been reduced to a single file name on its way in, which is what keeps a name
     * arriving over a request from naming somewhere else entirely.
     */
    override async backupAs(
        settings: SetupBackupSettings,
        onProgress?: (fraction: number) => void
    ): Promise<SetupExistingBackup> {
        const filePath = await syncMutexService.doExclusively(async () => {
            const format = await this.resolveFormat(settings);
            const directory = (format.keepLocal ? null : this.getCustomBackupDir()) ?? getDefaultBackupDir();

            return await writeBackup(directory, settings.name, format, "default", onProgress);
        });
        const stat = fs.statSync(filePath);

        return {
            fileName: path.basename(filePath),
            filePath,
            directoryPath: path.dirname(filePath),
            fileSize: stat.size
        };
    }

    override async getBackupContent(filePath: string): Promise<Uint8Array | null> {
        const resolvedPath = this.resolveBackupPath(filePath);

        return resolvedPath ? fs.readFileSync(resolvedPath) : null;
    }

    override sendBackup(filePath: string, res: Response): boolean {
        const resolved = this.resolveBackupPath(filePath);
        if (!resolved) {
            return false;
        }

        res.setHeader("Content-Type", "application/octet-stream");
        res.setHeader("Content-Disposition", `attachment; filename="${path.basename(resolved)}"`);
        res.setHeader("Content-Length", String(fs.statSync(resolved).size));
        // Committed before a single byte of the body: the desktop serves the renderer through a
        // protocol bridge that only streams once headers are flushed, and buffers everything
        // otherwise. A backup is exactly the response that must not be buffered.
        res.flushHeaders();
        fs.createReadStream(resolved).pipe(res);

        return true;
    }

    /**
     * The absolute path of a backup that {@link getExistingBackups} lists, or `null` for any other
     * path. Every route that takes a backup path from a client goes through here.
     */
    resolveBackupPath(filePath: string): string | null {
        const resolvedPath = path.resolve(filePath);
        const directory = path.dirname(resolvedPath);

        if (!this.getBackupDirectories().includes(directory)) {
            return null;
        }

        return isListedBackup(directory, path.basename(resolvedPath)) ? resolvedPath : null;
    }

    /** Whether there is a passphrase that opens, without letting the caller learn what it is. */
    override async hasStoredPassphrase(): Promise<boolean> {
        return !!(await this.config.getPassphrase?.());
    }

    /**
     * Takes on the passphrase that a restored backup was locked with. The passphrase is not kept in
     * the database, so a restore does not replace it otherwise.
     */
    async adoptPassphrase(passphrase: string): Promise<void> {
        await this.config.setPassphrase?.(passphrase);
    }

    /**
     * Settles what the backup is written as, from what the user asked for where they were asked at
     * all, and from the instance's own setup where they were not.
     *
     * Compression needs nothing but the answer. Encryption also needs a passphrase, and where the
     * stored one was asked for and cannot be read the backup falls back to being unencrypted and
     * local rather than not being taken at all.
     *
     * @param settings what the setup screen asked for; absent for every other backup, which is
     *                 encrypted whenever a passphrase is stored.
     */
    private async resolveFormat(settings?: SetupBackupSettings): Promise<BackupFormat> {
        // Read leniently: the pre-migration backup runs before the options added by newer versions
        // exist.
        const compress = settings?.compress
            ?? this.options.getOptionOrNull("backupEnableCompression") === "true";

        // A backup someone asked for carries the password they typed while asking. Wanting the
        // stored one instead is a request rather than a value, since the passphrase is kept where
        // the interface that asked cannot read it.
        const useStored = settings
            ? settings.useStoredPassphrase
            : this.config.isPassphraseStored?.() ?? false;
        if (!useStored) {
            return { compress, passphrase: settings?.passphrase || null, keepLocal: false };
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

function listBackupsIn(directory: string): DatabaseBackup[] {
    let fileNames: string[];
    try {
        fileNames = fs.readdirSync(directory);
    } catch {
        // Missing or unreadable, e.g. a custom directory on a drive that is no longer plugged in.
        return [];
    }

    return fileNames
        .filter(isBackupFileName)
        .flatMap((fileName) => {
            const filePath = path.resolve(directory, fileName);
            const stat = fs.statSync(filePath, { throwIfNoEntry: false });
            if (!stat?.isFile()) {
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

/** Whether {@link listBackupsIn} lists the file of this name in `directory`. */
function isListedBackup(directory: string, fileName: string): boolean {
    const stat = fs.statSync(path.resolve(directory, fileName), { throwIfNoEntry: false });

    return isBackupFileName(fileName) && !!stat?.isFile();
}

/**
 * Whether a file name is one of a backup. The extension check excludes intermediate files
 * (`*.db-journal`, `*.part`). The name test ignores case, since the setup screen names its backup
 * for a person ("Backup …").
 */
function isBackupFileName(fileName: string): boolean {
    return fileName.toLowerCase().includes("backup")
        && (fileName.endsWith(DATABASE_EXTENSION) || fileName.endsWith(CONTAINER_EXTENSION));
}

/**
 * What a container is, read from its own header rather than from today's options: a backup keeps
 * the shape it was written in, whatever the settings have since become.
 *
 * Only the fixed header is read, so this costs a few dozen bytes per file and never needs the
 * passphrase. A file that is not a container this build can open is still listed, saying why: it is
 * sitting in the backup directory being counted as a backup, and the user is relying on it.
 */
function describeContainer(filePath: string, fileName: string): Partial<DatabaseBackup> {
    if (!fileName.endsWith(CONTAINER_EXTENSION)) {
        return {};
    }

    const head = Buffer.alloc(FIXED_HEADER_BYTES);
    let read: number;
    let descriptor: number | undefined;
    try {
        descriptor = fs.openSync(filePath, "r");
        read = fs.readSync(descriptor, head, 0, head.length, 0);
    } catch {
        // Nothing was learned, which is not the same as having learned the file is no good.
        return {};
    } finally {
        if (descriptor !== undefined) {
            fs.closeSync(descriptor);
        }
    }

    // Only what the file actually held, so a file too short to have a header is judged on that
    // rather than on the zeroes the buffer came with.
    const info = getInfo(head.subarray(0, read));
    if (!info.isValid) {
        return { unreadable: "invalid" };
    }
    if (!info.isSupported) {
        return { unreadable: "unsupported-version" };
    }

    return {
        compressed: info.isCompressed,
        encrypted: info.isEncrypted,
        // Recorded as 0 when the writer did not know it, which reads the same as "not stated".
        plaintextSize: info.size > 0 ? info.size : undefined
    };
}

async function writeBackup(
    directory: string,
    baseName: string,
    format: BackupFormat,
    location: "default" | "custom",
    onProgress?: (fraction: number) => void
): Promise<string> {
    const isContainer = format.compress || format.passphrase !== null;
    const fileName = `${baseName}${isContainer ? CONTAINER_EXTENSION : DATABASE_EXTENSION}`;
    const backupFile = path.resolve(directory, fileName);

    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });

    getLog().info("Creating backup...");
    try {
        if (isContainer) {
            await writeContainer(backupFile, baseName, format, onProgress);
        } else {
            // A plain copy has nothing to report along the way, only that it is over.
            await sql.copyDatabase(backupFile);
        }
        onProgress?.(1);
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
    format: BackupFormat,
    onProgress?: (fraction: number) => void
): Promise<void> {
    const snapshot = path.resolve(dataDir.TMP_DIR, `${baseName}.snapshot.db`);
    const partial = `${backupFile}.part`;

    try {
        await sql.copyDatabase(snapshot);

        await writeBackupContainer(fs.createReadStream(snapshot), fs.createWriteStream(partial), {
            compress: format.compress,
            passphrase: format.passphrase ?? undefined,
            plaintextSize: fs.statSync(snapshot).size,
            onProgress
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
