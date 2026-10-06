import { FileBasedLogService, type LogFileInfo } from "@triliumnext/core";
import { t } from "i18next";

const LOG_DIR_NAME = "logs";
const LOG_FILE_PATTERN = /^trilium-\d{4}-\d{2}-\d{2}\.log$/;
const DEFAULT_RETENTION_DAYS = 7;
const OPEN_ATTEMPTS = 3;
const OPEN_RETRY_DELAY_MS = 100;
const BACKGROUND_RETRY_INITIAL_MS = 1_000;
const BACKGROUND_RETRY_MAX_MS = 30_000;
/** Entries kept in memory while no log file is open. */
export const MAX_PENDING_ENTRIES = 5_000;

/**
 * Standalone log service using OPFS (Origin Private File System).
 * Uses synchronous access handles available in service worker context.
 */
export default class StandaloneLogService extends FileBasedLogService {
    private logDir: FileSystemDirectoryHandle | null = null;
    private currentFile: FileSystemSyncAccessHandle | null = null;
    private currentFileName: string = "";
    private textEncoder = new TextEncoder();
    private textDecoder = new TextDecoder();
    /** Entries written while no file is open, flushed to the file once it opens. */
    private pendingEntries: string[] = [];
    /** Set while the background retry is the only thing that can open the log file. */
    private fileUnavailable = false;
    private retryTimer: ReturnType<typeof setTimeout> | null = null;
    /** Incremented on every open and close, so an attempt for an older file discards its handle. */
    private openGeneration = 0;

    constructor() {
        super();
    }

    // ==================== Abstract Method Implementations ====================

    protected override get eol(): string {
        return "\n";
    }

    protected override async ensureLogDirectory(): Promise<void> {
        const root = await navigator.storage.getDirectory();
        this.logDir = await root.getDirectoryHandle(LOG_DIR_NAME, { create: true });
    }

    protected override async openLogFile(fileName: string): Promise<void> {
        this.closeLogFile();
        const generation = this.openGeneration;

        if (!this.logDir) {
            await this.ensureLogDirectory();
        }
        if (!this.logDir) {
            return;
        }

        const fileHandle = await this.logDir.getFileHandle(fileName, { create: true });

        // A worker that was just replaced can still hold the handle for a moment.
        for (let attempt = 0; attempt < OPEN_ATTEMPTS; attempt++) {
            try {
                this.adoptFile(await fileHandle.createSyncAccessHandle(), fileName, generation);
                return;
            } catch (error) {
                if (attempt === OPEN_ATTEMPTS - 1) {
                    console.warn(
                        "[LogService] Could not open log file, retrying in the background:", error
                    );
                    this.fileUnavailable = true;
                    this.scheduleRetry(
                        fileHandle, fileName, generation, BACKGROUND_RETRY_INITIAL_MS
                    );
                    return;
                }
                const delayMs = OPEN_RETRY_DELAY_MS * (attempt + 1);
                await new Promise(resolve => setTimeout(resolve, delayMs));
            }
        }
    }

    protected override closeLogFile(): void {
        this.openGeneration++;
        this.fileUnavailable = false;
        if (this.retryTimer) {
            clearTimeout(this.retryTimer);
            this.retryTimer = null;
        }
        if (this.currentFile) {
            this.currentFile.close();
            this.currentFile = null;
            this.currentFileName = "";
        }
    }

    protected override writeEntry(entry: string): void {
        if (!this.currentFile) {
            this.pendingEntries.push(entry);
            if (this.pendingEntries.length > MAX_PENDING_ENTRIES) {
                this.pendingEntries.shift();
            }
            return;
        }

        const data = this.textEncoder.encode(entry);
        const currentSize = this.currentFile.getSize();
        this.currentFile.write(data, { at: currentSize });
        this.currentFile.flush();
    }

    protected override readLogFile(fileName: string): string | null {
        if (!this.logDir) {
            return null;
        }

        try {
            // For the current file, we need to read from the sync handle
            if (fileName === this.currentFileName && this.currentFile) {
                const size = this.currentFile.getSize();
                const buffer = new ArrayBuffer(size);
                const view = new DataView(buffer);
                this.currentFile.read(view, { at: 0 });
                return this.textDecoder.decode(buffer);
            }

            // For other files, we'd need async access - return null for now
            // The current file is what's most commonly needed
            return null;
        } catch {
            return null;
        }
    }

    protected override async listLogFiles(): Promise<LogFileInfo[]> {
        if (!this.logDir) {
            return [];
        }

        const logFiles: LogFileInfo[] = [];

        for await (const [name, handle] of this.logDir.entries()) {
            if (handle.kind !== "file" || !LOG_FILE_PATTERN.test(name)) {
                continue;
            }

            // OPFS doesn't provide mtime directly, so we parse from filename
            const match = name.match(/trilium-(\d{4})-(\d{2})-(\d{2})\.log/);
            /* v8 ignore next -- @preserve: `name` already matched LOG_FILE_PATTERN above, so this equivalent regex always matches. */
            if (match) {
                const mtime = new Date(
                    parseInt(match[1]),
                    parseInt(match[2]) - 1,
                    parseInt(match[3])
                );
                logFiles.push({ name, mtime });
            }
        }

        return logFiles;
    }

    protected override async deleteLogFile(fileName: string): Promise<void> {
        if (!this.logDir) {
            return;
        }

        // Don't delete the current file
        if (fileName === this.currentFileName) {
            return;
        }

        try {
            await this.logDir.removeEntry(fileName);
        } catch {
            // File might not exist or be locked
        }
    }

    override getLogContents(): string | null {
        const contents = super.getLogContents();
        if (contents !== null || this.currentFile) {
            return contents;
        }
        const entries = this.pendingEntries.join("");
        return this.fileUnavailable
            ? `${t("backend_log.log-file-unavailable")}\n\n${entries}`
            : entries;
    }

    protected override getRetentionDays(): number {
        // Standalone doesn't have config system, use default
        return DEFAULT_RETENTION_DAYS;
    }

    private adoptFile(
        accessHandle: FileSystemSyncAccessHandle, fileName: string, generation: number
    ): void {
        if (generation !== this.openGeneration) {
            accessHandle.close();
            return;
        }
        this.currentFile = accessHandle;
        this.currentFileName = fileName;
        this.fileUnavailable = false;
        if (this.pendingEntries.length > 0) {
            const entries = this.pendingEntries.join("");
            this.pendingEntries = [];
            this.writeEntry(entries);
        }
    }

    private scheduleRetry(
        fileHandle: FileSystemFileHandle, fileName: string, generation: number, delayMs: number
    ): void {
        this.retryTimer = setTimeout(async () => {
            this.retryTimer = null;
            let accessHandle: FileSystemSyncAccessHandle;
            try {
                accessHandle = await fileHandle.createSyncAccessHandle();
            } catch {
                if (generation === this.openGeneration) {
                    const nextDelayMs = Math.min(delayMs * 2, BACKGROUND_RETRY_MAX_MS);
                    this.scheduleRetry(fileHandle, fileName, generation, nextDelayMs);
                }
                return;
            }
            this.adoptFile(accessHandle, fileName, generation);
        }, delayMs);
    }
}
