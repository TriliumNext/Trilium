import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getBackup } from "./backup.js";
import {
    backUpExistingData,
    deleteExistingData,
    getExistingBackupProgress,
    getExistingBackupStatus,
    keepExistingData,
    startBackUpExistingData
} from "./setup_existing.js";
import { enterSetupMode, initSetupPlatform, leaveSetupMode } from "./setup_mode.js";

const platform = {
    writeMarker: vi.fn(async () => {}),
    removeMarker: vi.fn(async () => {}),
    removeDatabase: vi.fn(async () => {})
};

beforeEach(() => {
    Object.values(platform).forEach((fn) => fn.mockClear());
    initSetupPlatform(platform);
    // An instance the app asked into setup, which is the only state these operations belong to.
    enterSetupMode({ lang: "en" });
});

afterEach(() => {
    leaveSetupMode();
    vi.restoreAllMocks();
});

describe("what becomes of the existing database", () => {
    it("backs it up through the platform's own backup service", async () => {
        const written = { fileName: "Backup.tnbackup", filePath: "/b/Backup.tnbackup", fileSize: 12, encrypted: true };
        const backupAs = vi.fn(async (_name: string, _onProgress?: (fraction: number) => void) => written);
        // Assigned rather than spied: the method is optional, and a platform without one is exactly
        // what the service checks for.
        const backup = getBackup() as { backupAs?: typeof backupAs };
        const previous = backup.backupAs;
        backup.backupAs = backupAs;

        await expect(backUpExistingData(new Date(2026, 7, 7, 10, 32, 21))).resolves.toEqual(written);
        // The name every platform suggests, which commons settles and its own tests cover.
        expect(backupAs)
            .toHaveBeenCalledWith("Trilium data (2026-08-07 10-32-21)", expect.any(Function));
        // Nothing is erased by taking a copy of it.
        expect(platform.removeDatabase).not.toHaveBeenCalled();

        backup.backupAs = previous;
    });

    it("says how far along the write is while it runs, and nothing once it is over", async () => {
        const seen: (number | null)[] = [];
        const backup = getBackup() as { backupAs?: unknown };
        const previous = backup.backupAs;
        backup.backupAs = async (_name: string, onProgress?: (fraction: number) => void) => {
            seen.push(getExistingBackupProgress());
            onProgress?.(0.5);
            seen.push(getExistingBackupProgress());
            return { fileName: "b", filePath: "/b", fileSize: 1, encrypted: false };
        };

        await backUpExistingData(new Date());

        expect(seen).toEqual([ 0, 0.5 ]);
        // Nothing is running any more, which is what the screen needs to stop drawing a bar.
        expect(getExistingBackupProgress()).toBeNull();

        backup.backupAs = previous;
    });

    it("erases it, and nothing else", async () => {
        await deleteExistingData();

        expect(platform.removeDatabase).toHaveBeenCalled();
    });

    it("puts the instance back as it was when the answer is to keep it", async () => {
        await keepExistingData();

        // The marker goes first: a start that finds one comes up as the wizard all over again.
        expect(platform.removeMarker).toHaveBeenCalled();
        expect(platform.removeDatabase).not.toHaveBeenCalled();
    });

    it("refuses every one of them where there is no existing database to act on", async () => {
        leaveSetupMode();

        await expect(backUpExistingData(new Date())).rejects.toThrow(/first time/);
        await expect(deleteExistingData()).rejects.toThrow(/first time/);
        await expect(keepExistingData()).rejects.toThrow(/first time/);
        expect(platform.removeDatabase).not.toHaveBeenCalled();
        expect(() => startBackUpExistingData(new Date())).toThrow(/first time/);
    });
});

describe("the started backup, followed through its status", () => {
    /** Puts a controllable backupAs in place and gives back the strings to pull. */
    function stubBackup(behaviour: (onProgress?: (fraction: number) => void) => Promise<unknown>) {
        const backup = getBackup() as { backupAs?: unknown };
        const previous = backup.backupAs;
        backup.backupAs = (_name: string, onProgress?: (fraction: number) => void) =>
            behaviour(onProgress);

        return () => {
            backup.backupAs = previous;
        };
    }

    it("runs with a live fraction, joins a second start, and ends holding what was written", async () => {
        const written = { fileName: "b", filePath: "/b", fileSize: 1, encrypted: false };
        let report: ((fraction: number) => void) | undefined;
        let finish!: (value: typeof written) => void;
        const restore = stubBackup((onProgress) => new Promise((resolve) => {
            report = onProgress;
            finish = resolve;
        }));

        startBackUpExistingData(new Date());
        await vi.waitFor(() => expect(getExistingBackupStatus().state).toBe("running"));

        report?.(0.25);
        expect(getExistingBackupStatus()).toMatchObject({ state: "running", fraction: 0.25 });

        // Asked to start again while running: joined, not doubled, so the fraction survives.
        startBackUpExistingData(new Date());
        expect(getExistingBackupStatus()).toMatchObject({ state: "running", fraction: 0.25 });

        finish(written);
        await vi.waitFor(() => expect(getExistingBackupStatus().state).toBe("done"));
        expect(getExistingBackupStatus()).toEqual({ state: "done", fraction: 1, result: written });

        restore();
    });

    it("ends failed with the reason, and lets the next attempt start over", async () => {
        const restore = stubBackup(async () => {
            throw new Error("disk full");
        });

        // The previous test left a done state behind, which a new start must replace.
        startBackUpExistingData(new Date());
        await vi.waitFor(() => expect(getExistingBackupStatus().state).toBe("failed"));
        expect(getExistingBackupStatus()).toEqual({ state: "failed", fraction: null, error: "disk full" });

        restore();
    });
});
