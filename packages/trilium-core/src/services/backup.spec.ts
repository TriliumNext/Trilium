import type { DatabaseBackup, FilterOptionsByType, OptionNames } from "@triliumnext/commons";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import BackupService, { getBackup, initBackup } from "./backup.js";
import type { BackupOptionsService } from "./backup.js";
import dateUtils from "./utils/date.js";

/**
 * A simple in-memory options service used to drive the abstract backup logic.
 * Mirrors the three methods the real BackupOptionsService exposes.
 */
class FakeOptions implements BackupOptionsService {
    private readonly store: Record<string, string>;

    constructor(initial: Record<string, string> = {}) {
        this.store = { ...initial };
    }

    getOption(name: OptionNames): string {
        return this.store[name] ?? "";
    }

    getOptionBool(name: FilterOptionsByType<boolean>): boolean {
        return this.store[name] === "true";
    }

    setOption(name: OptionNames, value: string): void {
        this.store[name] = value;
    }
}

/**
 * Concrete subclass exposing the protected scheduling logic and recording the
 * backups it is asked to create. The other abstract members are stubbed.
 */
class TestBackupService extends BackupService {
    public readonly created: string[] = [];

    async backupNow(name: string): Promise<string> {
        this.created.push(name);
        return `backup-${name}.db`;
    }

    scheduleBackups(): void {
        /* no-op for tests */
    }

    async getExistingBackups(): Promise<DatabaseBackup[]> {
        return [];
    }

    async getBackupContent(): Promise<Uint8Array | null> {
        return null;
    }

    // Expose protected members for direct assertions.
    public runScheduledBackupsPublic(): Promise<void> {
        return this.runScheduledBackups();
    }

    public periodBackupPublic(
        optionName: "lastDailyBackupDate" | "lastWeeklyBackupDate" | "lastMonthlyBackupDate",
        backupType: "daily" | "weekly" | "monthly",
        periodInSeconds: number
    ): Promise<void> {
        return this.periodBackup(optionName, backupType, periodInSeconds);
    }

    public isBackupEnabledPublic(backupType: "daily" | "weekly" | "monthly"): boolean {
        return this.isBackupEnabled(backupType);
    }
}

const DAY = 24 * 3600;

/** An old UTC date-time string guaranteed to be far in the past. */
const LONG_AGO = "2000-01-01 00:00:00.000Z";

describe("BackupService singleton (getBackup / initBackup)", () => {
    it("getBackup throws before the service is initialized", async () => {
        // Re-import the module in isolation so the module-level singleton is
        // guaranteed to be undefined (other tests in this file install one).
        vi.resetModules();
        const fresh = await import("./backup.js");
        expect(() => fresh.getBackup()).toThrow(/not initialized/);
    });

    it("initBackup installs the provider returned by getBackup", () => {
        const provider = new TestBackupService(new FakeOptions());
        initBackup(provider);
        expect(getBackup()).toBe(provider);

        // Replacing it swaps the instance returned.
        const replacement = new TestBackupService(new FakeOptions());
        initBackup(replacement);
        expect(getBackup()).toBe(replacement);
        expect(getBackup()).not.toBe(provider);
    });
});

describe("BackupService.isBackupEnabled", () => {
    it("maps each backup type to the matching boolean option", () => {
        const service = new TestBackupService(
            new FakeOptions({
                dailyBackupEnabled: "true",
                weeklyBackupEnabled: "false",
                monthlyBackupEnabled: "true"
            })
        );

        expect(service.isBackupEnabledPublic("daily")).toBe(true);
        expect(service.isBackupEnabledPublic("weekly")).toBe(false);
        expect(service.isBackupEnabledPublic("monthly")).toBe(true);
    });

    it("treats a missing / non-'true' option value as disabled", () => {
        const service = new TestBackupService(new FakeOptions());
        expect(service.isBackupEnabledPublic("daily")).toBe(false);
        expect(service.isBackupEnabledPublic("weekly")).toBe(false);
        expect(service.isBackupEnabledPublic("monthly")).toBe(false);
    });
});

describe("BackupService.periodBackup", () => {
    it("does nothing when the backup type is disabled", async () => {
        const options = new FakeOptions({
            dailyBackupEnabled: "false",
            lastDailyBackupDate: LONG_AGO
        });
        const service = new TestBackupService(options);

        await service.periodBackupPublic("lastDailyBackupDate", "daily", DAY);

        expect(service.created).toEqual([]);
        // The last-backup option is left untouched.
        expect(options.getOption("lastDailyBackupDate")).toBe(LONG_AGO);
    });

    it("creates a backup and records the new timestamp when the period has elapsed", async () => {
        const options = new FakeOptions({
            dailyBackupEnabled: "true",
            lastDailyBackupDate: LONG_AGO
        });
        const service = new TestBackupService(options);

        await service.periodBackupPublic("lastDailyBackupDate", "daily", DAY);

        expect(service.created).toEqual(["daily"]);
        // The timestamp is advanced to (roughly) now, and is parseable.
        const stored = options.getOption("lastDailyBackupDate");
        expect(stored).not.toBe(LONG_AGO);
        const parsed = dateUtils.parseDateTime(stored);
        expect(Math.abs(parsed.getTime() - Date.now())).toBeLessThan(5000);
    });

    it("does not create a backup when the last one is still within the period", async () => {
        // Last backup was "now"; the period is one day, so nothing is due.
        const recent = dateUtils.utcNowDateTime();
        const options = new FakeOptions({
            weeklyBackupEnabled: "true",
            lastWeeklyBackupDate: recent
        });
        const service = new TestBackupService(options);

        await service.periodBackupPublic("lastWeeklyBackupDate", "weekly", 7 * DAY);

        expect(service.created).toEqual([]);
        expect(options.getOption("lastWeeklyBackupDate")).toBe(recent);
    });

    it("uses the boundary strictly (exactly the period elapsed is not yet due)", async () => {
        // Pin "now" so the elapsed time equals the period exactly.
        const fixedNow = new Date("2024-06-01T00:00:00.000Z");
        vi.useFakeTimers();
        vi.setSystemTime(fixedNow);
        try {
            const exactlyOneDayAgo = "2024-05-31 00:00:00.000Z";
            const options = new FakeOptions({
                dailyBackupEnabled: "true",
                lastDailyBackupDate: exactlyOneDayAgo
            });
            const service = new TestBackupService(options);

            await service.periodBackupPublic("lastDailyBackupDate", "daily", DAY);

            // now - last === period, and the check is strictly greater-than.
            expect(service.created).toEqual([]);
            expect(options.getOption("lastDailyBackupDate")).toBe(exactlyOneDayAgo);
        } finally {
            vi.useRealTimers();
        }
    });
});

describe("BackupService.runScheduledBackups", () => {
    it("runs the daily/weekly/monthly checks, backing up only the enabled & due ones", async () => {
        const options = new FakeOptions({
            dailyBackupEnabled: "true",
            weeklyBackupEnabled: "false",
            monthlyBackupEnabled: "true",
            lastDailyBackupDate: LONG_AGO,
            lastWeeklyBackupDate: LONG_AGO,
            lastMonthlyBackupDate: LONG_AGO
        });
        const service = new TestBackupService(options);

        await service.runScheduledBackupsPublic();

        // Weekly is disabled, so only daily and monthly run; order is preserved.
        expect(service.created).toEqual(["daily", "monthly"]);
        expect(options.getOption("lastWeeklyBackupDate")).toBe(LONG_AGO);
        expect(options.getOption("lastDailyBackupDate")).not.toBe(LONG_AGO);
        expect(options.getOption("lastMonthlyBackupDate")).not.toBe(LONG_AGO);
    });
});

describe("BackupService.regularBackup", () => {
    let errorSpy: ReturnType<typeof vi.spyOn>;

    beforeEach(() => {
        errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    });

    afterEach(() => {
        errorSpy.mockRestore();
    });

    it("runs the scheduled backups inside an execution context", async () => {
        const options = new FakeOptions({
            dailyBackupEnabled: "true",
            lastDailyBackupDate: LONG_AGO
        });
        const service = new TestBackupService(options);

        service.regularBackup();
        // runScheduledBackups is async and fire-and-forget; let it settle.
        await vi.waitFor(() => expect(service.created).toContain("daily"));

        expect(errorSpy).not.toHaveBeenCalled();
    });

    it("logs (and swallows) errors thrown by the scheduled backups", async () => {
        const options = new FakeOptions({
            dailyBackupEnabled: "true",
            lastDailyBackupDate: LONG_AGO
        });
        const service = new TestBackupService(options);
        const boom = new Error("backup blew up");
        vi.spyOn(service, "backupNow").mockRejectedValue(boom);

        // Must not throw synchronously even though the backup rejects.
        expect(() => service.regularBackup()).not.toThrow();

        await vi.waitFor(() =>
            expect(errorSpy).toHaveBeenCalledWith(
                "[Backup] Error running scheduled backups:",
                boom
            )
        );
    });
});
