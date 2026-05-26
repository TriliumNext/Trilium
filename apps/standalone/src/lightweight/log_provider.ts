import { FileBasedLogService, type LogFileInfo } from "@triliumnext/core";

const LOG_DIR_NAME = "logs";
const LOG_FILE_PATTERN = /^trilium-\d{4}-\d{2}-\d{2}\.log$/;
const DEFAULT_RETENTION_DAYS = 7;

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
        if (!this.logDir) {
            await this.ensureLogDirectory();
        }

        // Close existing file if open
        if (this.currentFile) {
            this.currentFile.close();
            this.currentFile = null;
        }

        const fileHandle = await this.logDir!.getFileHandle(fileName, { create: true });

        // Try to create sync access handle with retry logic for worker restarts
        // Previous worker may have left handle open before being terminated
        const maxRetries = 3;
        const retryDelay = 100;

        for (let attempt = 0; attempt < maxRetries; attempt++) {
            try {
                this.currentFile = await fileHandle.createSyncAccessHandle();
                break;
            } catch (error) {
                if (attempt === maxRetries - 1) {
                    // Last attempt failed - fall back to console-only logging
                    console.warn("[LogService] Could not open log file, using console-only logging:", error);
                    this.currentFile = null;
                    this.currentFileName = "";
                    return;
                }
                // Wait before retrying - previous handle may be released
                await new Promise(resolve => setTimeout(resolve, retryDelay * (attempt + 1)));
            }
        }

        this.currentFileName = fileName;

        // Seek to end for appending
        if (this.currentFile) {
            const size = this.currentFile.getSize();
            this.currentFile.truncate(size); // No-op, but ensures we're at the right position
        }
    }

    protected override closeLogFile(): void {
        if (this.currentFile) {
            this.currentFile.close();
            this.currentFile = null;
            this.currentFileName = "";
        }
    }

    protected override writeEntry(entry: string): void {
        if (!this.currentFile) {
            console.log(entry); // Fallback to console if file not ready
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

    protected override getRetentionDays(): number {
        // Standalone doesn't have config system, use default
        return DEFAULT_RETENTION_DAYS;
    }
}
