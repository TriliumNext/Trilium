import type { DatabaseBackup, FilterOptionsByType, OptionNames } from "@triliumnext/commons";
import { getContext } from "./context.js";
import dateUtils from "./utils/date.js";

type BackupType = "daily" | "weekly" | "monthly";

export interface BackupOptionsService {
    getOption(name: OptionNames): string;
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
     * Get list of existing backups.
     */
    abstract getExistingBackups(): Promise<DatabaseBackup[]>;

    /**
     * Get the content of a backup file.
     * Returns null if the backup doesn't exist or access is denied.
     */
    abstract getBackupContent(filePath: string): Promise<Uint8Array | null>;

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
