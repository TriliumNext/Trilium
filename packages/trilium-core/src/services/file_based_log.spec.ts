import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as cls from "./context.js";
import FileBasedLogService, { type LogFileInfo } from "./file_based_log.js";

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
    protected override closeLogFile(): void {}
    protected override writeEntry(entry: string): void {
        this.files[this.currentFile].push(entry);
    }
    protected override readLogFile(fileName: string): string | null {
        return this.files[fileName]?.join("") ?? null;
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

        const contents = log.getLogContents() ?? "";
        expect(contents).toContain("ERROR: ");
        expect(contents).toContain("boom");
        expect(contents).toContain("plain failure");
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
