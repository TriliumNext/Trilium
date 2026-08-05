import type { DatabaseBackup } from "@triliumnext/commons";
import { BackupOptionsService, BackupService, utils as coreUtils, getLog, sync_mutex as syncMutexService, ws } from "@triliumnext/core";
import fs from "fs";
import { t } from "i18next";
import path from "path";

import dataDir from "./services/data_dir.js";
import sql from "./services/sql.js";

export interface ServerBackupConfig {
    /**
     * Whether the `customDbBackupDir` option is honoured. Set by the desktop application, where the user
     * picks the directory themselves; on the server the backup location is part of the deployment and is
     * configured through the `TRILIUM_BACKUP_DIR` environment variable instead.
     */
    allowCustomDirectory?: boolean;
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

        const fileName = `backup-${sanitizedName}.db`;

        // we don't want to back up DB in the middle of sync with potentially inconsistent DB state
        return await syncMutexService.doExclusively(async () => {
            const customDir = this.getCustomBackupDir();

            if (customDir) {
                try {
                    return await writeBackup(customDir, fileName, "custom");
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

            return await writeBackup(getDefaultBackupDir(), fileName, "default");
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

        return customDir ? [customDir, defaultDir] : [defaultDir];
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
        // The .db check excludes intermediate SQLite files (e.g. *.db-journal) created while a backup is in progress.
        .filter((fileName) => fileName.includes("backup") && fileName.endsWith(".db"))
        .flatMap((fileName) => {
            const filePath = path.resolve(directory, fileName);
            const stat = fs.statSync(filePath, { throwIfNoEntry: false });
            if (!stat) {
                return [];
            }

            return [{ fileName, filePath, mtime: stat.mtime, fileSize: stat.size }];
        });
}

async function writeBackup(directory: string, fileName: string, location: "default" | "custom"): Promise<string> {
    const backupFile = path.resolve(directory, fileName);

    fs.mkdirSync(directory, { recursive: true, mode: 0o700 });

    getLog().info("Creating backup...");
    try {
        await sql.copyDatabase(backupFile);
    } catch (e) {
        // Whatever was written before the failure is not a usable database, and would otherwise be
        // listed and offered for download as if it were one.
        fs.rmSync(backupFile, { force: true });
        throw new Error(withoutDirectory(e, directory));
    }
    getLog().info(`Created backup .${path.sep}${fileName}${location === "custom" ? " in the custom backup location." : ""}`);

    return backupFile;
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
