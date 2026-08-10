import type {
    DatabaseBackup,
    FilterOptionsByType,
    OptionNames,
    SetupBackupSettings,
    SetupExistingBackup
} from "@triliumnext/commons";
import type { Response } from "express";

import { getContext } from "./context.js";
import dateUtils from "./utils/date.js";

type BackupType = "daily" | "weekly" | "monthly";

export interface BackupOptionsService {
    getOption(name: OptionNames): string;
    /**
     * Reads an option without throwing when it does not exist yet — the pre-migration backup runs
     * before {@link options_init.initStartupOptions} has filled in the options added by newer versions.
     */
    getOptionOrNull(name: OptionNames): string | null;
    getOptionBool(name: FilterOptionsByType<boolean>): boolean;
    setOption(name: OptionNames, value: string): void;
}

/**
 * Abstract backup service class.
 * Platform-specific implementations must extend this class.
 */
export default abstract class BackupService {
    constructor(protected readonly options: BackupOptionsService) {}

    /**
     * Create a backup with the given name.
     * Returns the backup file path/name.
     */
    abstract backupNow(name: string): Promise<string>;

    /**
     * Create a backup the user has just described, reporting what was written.
     *
     * For the setup screen's offer to save the existing database before replacing it, where the user
     * is shown the file afterwards and so has to be told its name, its path and its size. Left out by
     * platforms with nowhere to write a file the user could then find.
     *
     * Unlike {@link backupNow}, which runs to a schedule and so can only follow the instance's
     * options, this one is asked for by a person who was standing there answering questions about
     * it. What they answered arrives in `settings` and is what the backup is written as.
     *
     * @param onProgress how far through the write it is, from 0 to 1. A backup of a large knowledge
     *                   base runs for minutes, and a screen with nothing to show for that long is
     *                   indistinguishable from one that has stopped.
     */
    backupAs?(
        settings: SetupBackupSettings,
        onProgress?: (fraction: number) => void
    ): Promise<SetupExistingBackup>;

    /**
     * Whether a passphrase is stored that a backup could be locked with.
     *
     * Answers with a yes or a no and never with the passphrase itself, which is the whole point:
     * the screen offering "use the password I configured" has to know whether there is one, and
     * must not be able to learn what it is. Left out by platforms that keep no passphrase.
     */
    hasStoredPassphrase?(): Promise<boolean>;

    /**
     * Perform regular scheduled backups (daily, weekly, monthly).
     * Called periodically by the scheduler.
     * Default implementation runs inside an execution context.
     */
    regularBackup(): void {
        getContext().init(() => {
            this.runScheduledBackups().catch(err => {
                console.error("[Backup] Error running scheduled backups:", err);
            });
        });
    }

    /**
     * Schedule automatic backups.
     * Platform-specific: server uses timers, standalone/mobile is a no-op.
     */
    abstract scheduleBackups(): void;

    /**
     * Get list of existing backups.
     */
    abstract getExistingBackups(): Promise<DatabaseBackup[]>;

    /**
     * Get the directory where backups are stored, for display purposes.
     * Returns null when there is no user-accessible location (e.g. OPFS on standalone).
     */
    getBackupFolderPath(): string | null {
        return null;
    }

    /**
     * Get the content of a backup file.
     * Returns null if the backup doesn't exist or access is denied.
     */
    abstract getBackupContent(filePath: string): Promise<Uint8Array | null>;

    /**
     * Sends an existing backup to `res` as a download, a piece at a time.
     *
     * Neither reading it first nor handing the path to Express will do. {@link getBackupContent}
     * holds the whole thing in memory, which Node refuses outright above 2 GiB, and `res.download`
     * never flushes its headers, which is the signal the desktop's protocol bridge waits for before
     * it streams — without it a multi-gigabyte backup is buffered whole on its way to the renderer
     * and takes the application down with it.
     *
     * @returns whether it was sent; `false` for anything that is not an existing backup.
     */
    sendBackup?(filePath: string, res: Response): boolean;

    /**
     * Run the scheduled backup checks for daily, weekly, and monthly backups.
     */
    protected async runScheduledBackups(): Promise<void> {
        await this.periodBackup("lastDailyBackupDate", "daily", 24 * 3600);
        await this.periodBackup("lastWeeklyBackupDate", "weekly", 7 * 24 * 3600);
        await this.periodBackup("lastMonthlyBackupDate", "monthly", 30 * 24 * 3600);
    }

    /**
     * Check if a specific backup type is enabled via options.
     */
    protected isBackupEnabled(backupType: BackupType): boolean {
        const optionName: FilterOptionsByType<boolean> =
            backupType === "daily" ? "dailyBackupEnabled" :
            backupType === "weekly" ? "weeklyBackupEnabled" :
            "monthlyBackupEnabled";

        return this.options.getOptionBool(optionName);
    }

    /**
     * Check if a periodic backup is due and create it if so.
     */
    protected async periodBackup(
        optionName: "lastDailyBackupDate" | "lastWeeklyBackupDate" | "lastMonthlyBackupDate",
        backupType: BackupType,
        periodInSeconds: number
    ): Promise<void> {
        if (!this.isBackupEnabled(backupType)) {
            return;
        }

        const now = new Date();
        const lastBackupDate = dateUtils.parseDateTime(this.options.getOption(optionName));

        if (now.getTime() - lastBackupDate.getTime() > periodInSeconds * 1000) {
            await this.backupNow(backupType);
            this.options.setOption(optionName, dateUtils.utcNowDateTime());
        }
    }
}

let backupService: BackupService | undefined;

/**
 * Get the current backup service instance.
 */
export function getBackup(): BackupService {
    if (!backupService) {
        throw new Error("Backup service not initialized. Call initBackup() first.");
    }
    return backupService;
}

/**
 * Initialize the backup service with a platform-specific provider.
 */
export function initBackup(provider: BackupService): void {
    backupService = provider;
}
