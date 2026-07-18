import LogService from "./log.js";
import { getContext } from "./context.js";

const SECOND = 1000;
const MINUTE = 60 * SECOND;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

const MINIMUM_FILES_TO_KEEP = 7;
const DEFAULT_RETENTION_DAYS = 7;

export interface LogFileInfo {
    name: string;
    mtime: Date;
}

/**
 * Abstract base class for file-based logging implementations.
 * Provides shared logic for log rotation, cleanup, and formatting.
 * Platform-specific implementations (Node.js fs, OPFS) extend this class.
 */
export default abstract class FileBasedLogService extends LogService {
    protected todaysMidnight!: Date;
    private isInitialized = false;

    constructor() {
        super();
    }

    /**
     * Initialize the log service. Must be called before logging.
     * Separated from constructor to allow async initialization in some platforms.
     * For sync platforms (Node.js), call the methods directly in the constructor.
     */
    async initialize(): Promise<void> {
        if (this.isInitialized) return;
        await this.ensureLogDirectory();
        this.todaysMidnight = this.getTodaysMidnight();
        await this.openLogFile(this.getLogFileName());
        this.isInitialized = true;
    }

    // ==================== Abstract Methods ====================

    /** Line ending character(s) for this platform */
    protected abstract get eol(): string;

    /** Ensure the log directory exists */
    protected abstract ensureLogDirectory(): Promise<void> | void;

    /** Open a log file for appending */
    protected abstract openLogFile(fileName: string): Promise<void> | void;

    /** Close the current log file */
    protected abstract closeLogFile(): Promise<void> | void;

    /** Write an entry to the current log file */
    protected abstract writeEntry(entry: string): void;

    /** Read the contents of a log file */
    protected abstract readLogFile(fileName: string): string | null;

    /** List all log files with their modification times */
    protected abstract listLogFiles(): Promise<LogFileInfo[]>;

    /** Delete a log file by name */
    protected abstract deleteLogFile(fileName: string): Promise<void>;

    /** Get the configured retention days (-1 = keep all, 0 = use default) */
    protected abstract getRetentionDays(): number;

    // ==================== Shared Implementation ====================

    protected getTodaysMidnight(): Date {
        const now = new Date();
        return new Date(now.getFullYear(), now.getMonth(), now.getDate());
    }

    protected getLogFileName(): string {
        return `trilium-${this.formatDate()}.log`;
    }

    protected async rotateLogFile(): Promise<void> {
        await this.closeLogFile();
        this.todaysMidnight = this.getTodaysMidnight();
        await this.openLogFile(this.getLogFileName());

        // Trigger cleanup asynchronously
        this.cleanupOldLogFiles().catch(() => {
            // Ignore cleanup errors
        });
    }

    protected checkDateAndRotate(millisSinceMidnight: number): number {
        if (millisSinceMidnight >= DAY) {
            // Trigger rotation asynchronously to avoid blocking
            this.rotateLogFile().catch(() => {});
            return millisSinceMidnight - DAY;
        }
        return millisSinceMidnight;
    }

    protected async cleanupOldLogFiles(): Promise<void> {
        try {
            let retentionDays = this.getRetentionDays();

            if (retentionDays <= -1) {
                this.info("Log cleanup: keeping all log files, as specified by configuration.");
                return;
            }

            if (retentionDays === 0) {
                retentionDays = DEFAULT_RETENTION_DAYS;
            }

            const cutoffDate = new Date();
            cutoffDate.setDate(cutoffDate.getDate() - retentionDays);

            const logFiles = await this.listLogFiles();

            // Sort by modification time (oldest first)
            logFiles.sort((a, b) => a.mtime.getTime() - b.mtime.getTime());

            if (logFiles.length <= MINIMUM_FILES_TO_KEEP) {
                return;
            }

            let deletedCount = 0;
            for (let i = 0; i < logFiles.length - MINIMUM_FILES_TO_KEEP; i++) {
                const file = logFiles[i];
                if (file.mtime < cutoffDate) {
                    try {
                        await this.deleteLogFile(file.name);
                        deletedCount++;
                    } catch {
                        // Log deletion failed, but continue with others
                    }
                }
            }

            if (deletedCount > 0) {
                this.info(`Log cleanup: deleted ${deletedCount} old log files`);
            }
        } catch {
            // Cleanup failed, but don't crash
        }
    }

    protected getScriptContext(): string | undefined {
        try {
            return getContext().get("bundleNoteId");
        } catch {
            // Context not initialized yet
            return undefined;
        }
    }

    override log(message: string | Error): void {
        const bundleNoteId = this.getScriptContext();
        let str = String(message);

        if (bundleNoteId) {
            str = `[Script ${bundleNoteId}] ${str}`;
        }

        let millisSinceMidnight = Date.now() - this.todaysMidnight.getTime();
        millisSinceMidnight = this.checkDateAndRotate(millisSinceMidnight);

        const entry = `${this.formatTime(millisSinceMidnight)} ${str}${this.eol}`;
        this.writeEntry(entry);
        console.log(str);
    }

    override info(message: string | Error): void {
        this.log(message);
    }

    override error(message: string | Error | unknown): void {
        const str = message instanceof Error
            ? message.stack || message.message
            : String(message);
        this.log(`ERROR: ${str}`);
    }

    override getLogContents(): string | null {
        return this.readLogFile(this.getLogFileName());
    }

    // ==================== Formatting Helpers ====================

    protected pad(num: number): string {
        num = Math.floor(num);
        return num < 10 ? `0${num}` : num.toString();
    }

    protected padMilli(num: number): string {
        if (num < 10) {
            return `00${num}`;
        } else if (num < 100) {
            return `0${num}`;
        }
        return num.toString();
    }

    protected formatTime(millisSinceMidnight: number): string {
        return `${this.pad(millisSinceMidnight / HOUR)}:${this.pad((millisSinceMidnight % HOUR) / MINUTE)}:${this.pad((millisSinceMidnight % MINUTE) / SECOND)}.${this.padMilli(millisSinceMidnight % SECOND)}`;
    }

    protected formatDate(): string {
        return `${this.pad(this.todaysMidnight.getFullYear())}-${this.pad(this.todaysMidnight.getMonth() + 1)}-${this.pad(this.todaysMidnight.getDate())}`;
    }
}
