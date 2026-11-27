import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as cls from "./context.js";
import FileBasedLogService, { type LogFileInfo, type LogFileTail, MAX_LOG_CONTENTS_BYTES } from "./file_based_log.js";

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * In-memory concrete implementation used to exercise the shared logic of the
 * abstract {@link FileBasedLogService}. All side effects are captured in plain
 * fields so the test can assert on them. Public `call*` wrappers expose the
 * protected helpers for direct unit testing.
 */
class MemoryLogService extends FileBasedLogService {
    eolValue = "\n";
    retentionDays = 7;
    dirEnsured = false;
    files: Record<string, string[]> = {};
    currentFile = "";
    deleted: string[] = [];
    failingDeletes = new Set<string>();
    fileList: LogFileInfo[] = [];
    listShouldThrow = false;
    closeShouldThrow = false;
    cleanupShouldReject = false;

    protected get eol(): string {
        return this.eolValue;
    }
    protected override ensureLogDirectory(): void {
        this.dirEnsured = true;
    }
    protected override openLogFile(fileName: string): void {
        this.currentFile = fileName;
        this.files[fileName] ??= [];
    }
    protected override closeLogFile(): void {
        if (this.closeShouldThrow) throw new Error("close failed");
    }
    protected override writeEntry(entry: string): void {
        this.files[this.currentFile].push(entry);
    }
    protected override readLogFile(fileName: string, maxBytes: number): LogFileTail | null {
        const entries = this.files[fileName];
        if (!entries) return null;
        const bytes = new TextEncoder().encode(entries.join(""));
        const start = Math.max(bytes.length - maxBytes, 0);
        return { bytes: bytes.subarray(start), omittedBytes: start };
    }
    protected override async listLogFiles(): Promise<LogFileInfo[]> {
        if (this.listShouldThrow) throw new Error("list failed");
        return this.fileList;
    }
    protected override async deleteLogFile(name: string): Promise<void> {
        if (this.failingDeletes.has(name)) throw new Error(`cannot delete ${name}`);
        this.deleted.push(name);
    }
    protected override getRetentionDays(): number {
        return this.retentionDays;
    }
    protected override cleanupOldLogFiles(): Promise<void> {
        return this.cleanupShouldReject ? Promise.reject(new Error("cleanup failed")) : super.cleanupOldLogFiles();
    }

    // Wrappers exposing protected helpers for direct coverage.
    callRotate() {
        return this.rotateLogFile();
    }
    callCleanup() {
        return this.cleanupOldLogFiles();
    }
    callCheckDateAndRotate(ms: number) {
        return this.checkDateAndRotate(ms);
    }
    callGetScriptContext() {
        return this.getScriptContext();
    }
    callFormatTime(ms: number) {
        return this.formatTime(ms);
    }
}

describe("FileBasedLogService (shared logic)", () => {
    let log: MemoryLogService;
    let consoleLogSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        log = new MemoryLogService();
        consoleLogSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    });
    afterEach(() => vi.restoreAllMocks());

    it("initialize() sets up the directory and current log file, and is idempotent", async () => {
        await log.initialize();
        expect(log.dirEnsured).toBe(true);
        expect(log.currentFile).toMatch(/^trilium-\d{4}-\d{2}-\d{2}\.log$/);

        // Second call short-circuits.
        log.dirEnsured = false;
        await log.initialize();
        expect(log.dirEnsured).toBe(false);
    });

    it("log()/info() write a timestamped entry and echo to the console", async () => {
        await log.initialize();
        log.log("hello world");
        log.info("second");

        const contents = log.getLogContents() ?? "";
        expect(contents).toContain("hello world");
        expect(contents).toContain("second");
        // "HH:MM:SS.mmm message" format.
        expect(contents).toMatch(/\d{2}:\d{2}:\d{2}\.\d{3} hello world/);
        expect(consoleLogSpy).toHaveBeenCalledWith("hello world");
    });

    it("prefixes the entry with the script bundle id when one is in context", async () => {
        await log.initialize();
        cls.init(() => {
            cls.set("bundleNoteId", "scriptXyz");
            log.log("inside script");
        });
        expect(log.getLogContents() ?? "").toContain("[Script scriptXyz] inside script");
    });

    it("error() stringifies Error stacks and plain values", async () => {
        await log.initialize();
        log.error(new Error("boom"));
        log.error("plain failure");
        const stackless = new Error("no stack here");
        stackless.stack = undefined;
        log.error(stackless);

        const contents = log.getLogContents() ?? "";
        expect(contents).toContain("ERROR: ");
        expect(contents).toContain("boom");
        expect(contents).toContain("plain failure");
        expect(contents).toContain("ERROR: no stack here");
    });

    it("warn() writes a WARNING: entry, with the stack of an Error", async () => {
        await log.initialize();
        log.warn("careful");
        log.warn(new Error("shaky"));

        const contents = log.getLogContents() ?? "";
        expect(contents).toMatch(/\d{2}:\d{2}:\d{2}\.\d{3} WARNING: careful/);
        expect(contents).toContain("WARNING: Error: shaky\n    at ");
        expect(consoleLogSpy).toHaveBeenCalledWith("WARNING: careful");
    });

    it("getScriptContext returns undefined when the context lookup throws", () => {
        vi.spyOn(cls, "getContext").mockImplementation(() => {
            throw new Error("no context");
        });
        expect(log.callGetScriptContext()).toBeUndefined();
    });

    it("checkDateAndRotate rotates and subtracts a day only past midnight rollover", () => {
        expect(log.callCheckDateAndRotate(1000)).toBe(1000);
        const overflowed = log.callCheckDateAndRotate(DAY_MS + 5000);
        expect(overflowed).toBe(5000);
    });

    it("rotateLogFile opens a fresh file for the new day", async () => {
        await log.initialize();
        const before = log.currentFile;
        await log.callRotate();
        expect(log.currentFile).toBe(before); // same calendar day -> same name
        expect(log.files[before]).toBeDefined();
    });

    it("swallows failures of the background rotation and cleanup", async () => {
        await log.initialize();
        log.cleanupShouldReject = true;
        await expect(log.callRotate()).resolves.toBeUndefined();

        log.closeShouldThrow = true;
        expect(log.callCheckDateAndRotate(DAY_MS + 1)).toBe(1);
        await Promise.resolve();
    });

    describe("getLogContents", () => {
        const MiB = 1024 * 1024;

        /** Today's log holding the given text, as one entry. */
        async function withLog(text: string) {
            await log.initialize();
            log.files[log.currentFile] = [ text ];
        }

        it("returns a log within the limit whole, and null when there is none", async () => {
            await withLog("first\nsecond\n");
            expect(log.getLogContents()).toBe("first\nsecond\n");

            log.files = {};
            expect(log.getLogContents()).toBeNull();
        });

        it("leaves out the start of a longer log at a line boundary and says how much", async () => {
            const line = `${"x".repeat(1023)}\n`;
            const lines = Array.from({ length: MAX_LOG_CONTENTS_BYTES / 1024 + 2 * 1024 }, () => line);
            // One byte longer than the rest, so the cut falls inside its two-byte `é`.
            lines[2 * 1024] = `é${"x".repeat(1022)}\n`;
            const lastLine = `${"last line".padEnd(1023, ".")}\n`;
            lines[lines.length - 1] = lastLine;
            await withLog(lines.join(""));

            const contents = log.getLogContents() ?? "";
            const [ notice, , ...rest ] = contents.split("\n");
            const shown = rest.join("\n");

            expect(notice).toContain("2.0");
            expect(notice).toContain(log.currentFile);
            expect(shown.startsWith(line)).toBe(true);
            expect(shown.endsWith(lastLine)).toBe(true);
            expect(shown).not.toContain("�");
            expect(new TextEncoder().encode(shown).length).toBeLessThanOrEqual(MAX_LOG_CONTENTS_BYTES);
        });

        it("keeps the whole tail when it holds no line break", async () => {
            await withLog("y".repeat(MAX_LOG_CONTENTS_BYTES + MiB));

            const shown = (log.getLogContents() ?? "").split("\n").at(-1);
            expect(shown).toBe("y".repeat(MAX_LOG_CONTENTS_BYTES));
        });
    });

    it("formatTime pads hours and the three millisecond magnitudes", () => {
        expect(log.callFormatTime(5)).toMatch(/00:00:00\.005$/);
        expect(log.callFormatTime(50)).toMatch(/00:00:00\.050$/);
        expect(log.callFormatTime(500)).toMatch(/00:00:00\.500$/);
        expect(log.callFormatTime(11 * 60 * 60 * 1000)).toMatch(/^11:00:00/);
    });

    describe("cleanupOldLogFiles", () => {
        const oldDate = () => new Date(Date.now() - 30 * DAY_MS);

        it("keeps everything when retention is -1", async () => {
            log.retentionDays = -1;
            log.fileList = Array.from({ length: 10 }, (_, i) => ({ name: `f${i}.log`, mtime: oldDate() }));
            await log.callCleanup();
            expect(log.deleted).toEqual([]);
        });

        it("does nothing when there are at most the minimum number of files", async () => {
            log.fileList = Array.from({ length: 5 }, (_, i) => ({ name: `f${i}.log`, mtime: oldDate() }));
            await log.callCleanup();
            expect(log.deleted).toEqual([]);
        });

        it("deletes the oldest files beyond the minimum when they exceed retention (retention 0 -> default)", async () => {
            log.retentionDays = 0; // falls back to the default of 7 days
            log.fileList = Array.from({ length: 10 }, (_, i) => ({ name: `old${i}.log`, mtime: oldDate() }));
            log.failingDeletes.add("old1.log"); // one delete failure is swallowed
            await log.callCleanup();
            // 10 files - 7 kept = 3 candidates (old0..old2); old1 fails, so 2 deleted.
            expect(log.deleted).toEqual(["old0.log", "old2.log"]);
        });

        it("does not delete recent files even beyond the minimum", async () => {
            log.fileList = Array.from({ length: 10 }, (_, i) => ({ name: `recent${i}.log`, mtime: new Date() }));
            await log.callCleanup();
            expect(log.deleted).toEqual([]);
        });

        it("swallows errors from listing log files", async () => {
            log.listShouldThrow = true;
            await expect(log.callCleanup()).resolves.toBeUndefined();
        });
    });
});
