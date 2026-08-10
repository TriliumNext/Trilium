import type { SetupBackupSettings } from "@triliumnext/commons";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { getBackup } from "./backup.js";
import optionService from "./options.js";
import {
    backUpExistingData,
    deleteExistingData,
    getExistingBackupDefaults,
    getExistingBackupProgress,
    getExistingBackupStatus,
    keepExistingData,
    resolveBackupSettings,
    startBackUpExistingData
} from "./setup_existing.js";
import { enterSetupMode, initSetupPlatform, leaveSetupMode } from "./setup_mode.js";

const platform = {
    writeMarker: vi.fn(async () => {}),
    removeMarker: vi.fn(async () => {}),
    removeDatabase: vi.fn(async () => {})
};

/** Whatever the screen would have sent, for the tests that are not about the settings themselves. */
const ANY_SETTINGS: SetupBackupSettings = {
    name: "Backup",
    passphrase: "",
    useStoredPassphrase: false,
    compress: false
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
        const written = { fileName: "Backup.tnbackup", filePath: "/b/Backup.tnbackup", fileSize: 12 };
        const backupAs = vi.fn(async (_settings: SetupBackupSettings, _onProgress?: (fraction: number) => void) => written);
        // Assigned rather than spied: the method is optional, and a platform without one is exactly
        // what the service checks for.
        const backup = getBackup() as { backupAs?: typeof backupAs };
        const previous = backup.backupAs;
        backup.backupAs = backupAs;

        const settings: SetupBackupSettings = {
            name: "Before the import",
            passphrase: "hunter2",
            useStoredPassphrase: false,
            compress: true
        };
        await expect(backUpExistingData(settings)).resolves.toEqual(written);
        // Handed on as it stands: what the user answered is what the backup is written as.
        expect(backupAs).toHaveBeenCalledWith(settings, expect.any(Function));
        // Nothing is erased by taking a copy of it.
        expect(platform.removeDatabase).not.toHaveBeenCalled();

        backup.backupAs = previous;
    });

    it("says how far along the write is while it runs, and nothing once it is over", async () => {
        const seen: (number | null)[] = [];
        const backup = getBackup() as { backupAs?: unknown };
        const previous = backup.backupAs;
        backup.backupAs = async (_settings: SetupBackupSettings, onProgress?: (fraction: number) => void) => {
            seen.push(getExistingBackupProgress());
            onProgress?.(0.5);
            seen.push(getExistingBackupProgress());
            return { fileName: "b", filePath: "/b", fileSize: 1 };
        };

        await backUpExistingData(ANY_SETTINGS);

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

        await expect(backUpExistingData(ANY_SETTINGS)).rejects.toThrow(/first time/);
        await expect(deleteExistingData()).rejects.toThrow(/first time/);
        await expect(keepExistingData()).rejects.toThrow(/first time/);
        expect(platform.removeDatabase).not.toHaveBeenCalled();
        expect(() => startBackUpExistingData(new Date())).toThrow(/first time/);
    });
});

describe("what a backup asked for over a request is written as", () => {
    const now = new Date(2026, 7, 7, 10, 32, 21);
    const SUGGESTED_NAME = "Trilium data (2026-08-07 10-32-21)";

    /** Makes the instance's own backup settings say what the fallbacks are read out of. */
    function instanceBacksUp({ compress = false, encrypt = false }) {
        vi.spyOn(optionService, "getOptionOrNull").mockImplementation((name) => {
            if (name === "backupEnableCompression") return compress ? "true" : "false";
            if (name === "backupEnableEncryption") return encrypt ? "true" : "false";
            return null;
        });
    }

    it("takes the answers the screen sent", () => {
        expect(resolveBackupSettings(now, {
            name: "Before the import",
            passphrase: "hunter2",
            useStoredPassphrase: false,
            compress: true
        })).toEqual({
            name: "Before the import",
            passphrase: "hunter2",
            useStoredPassphrase: false,
            compress: true
        });
    });

    it("names it after the moment where nothing usable was asked for", () => {
        expect(resolveBackupSettings(now, {}).name).toBe(SUGGESTED_NAME);
        expect(resolveBackupSettings(now, { name: "   " }).name).toBe(SUGGESTED_NAME);
        expect(resolveBackupSettings(now, undefined).name).toBe(SUGGESTED_NAME);
        // A caller may send anything at all, including something that is not an object.
        expect(resolveBackupSettings(now, "a backup, please").name).toBe(SUGGESTED_NAME);
    });

    it("reduces a name that would have named somewhere else to one that names a file", () => {
        // The name crosses a request boundary and is then resolved against the backup directory, so
        // it is the one field here that could reach outside it if it were taken at its word.
        expect(resolveBackupSettings(now, { name: "../../etc/passwd" }).name).toBe("....etcpasswd");
        expect(resolveBackupSettings(now, { name: "..\\..\\Windows" }).name).toBe("....Windows");
        expect(resolveBackupSettings(now, { name: ".." }).name).toBe(SUGGESTED_NAME);
    });

    it("reads no answer out of anything that is not one", () => {
        instanceBacksUp({});

        expect(resolveBackupSettings(now, { passphrase: 42, compress: "yes", useStoredPassphrase: 1 }))
            .toMatchObject({ passphrase: "", compress: false, useStoredPassphrase: false });
    });

    it("falls back on how the instance already backs up, where the caller said nothing", () => {
        // Which is what keeps a caller that knows nothing of these questions — anything older than
        // the screen that asks them — backing up exactly as it did before.
        instanceBacksUp({ compress: true, encrypt: true });

        expect(resolveBackupSettings(now, {}))
            .toMatchObject({ useStoredPassphrase: true, compress: true });
    });

    it("lets the screen turn off what the instance turns on", () => {
        instanceBacksUp({ compress: true, encrypt: true });

        expect(resolveBackupSettings(now, { useStoredPassphrase: false, compress: false }))
            .toMatchObject({ useStoredPassphrase: false, compress: false });
    });
});

describe("what the screen is offered as its answers", () => {
    /** Puts a stored passphrase in place, or takes the whole notion of one away. */
    function stubStoredPassphrase(hasOne: boolean | undefined) {
        const backup = getBackup() as { hasStoredPassphrase?: (() => Promise<boolean>) | undefined };
        const previous = backup.hasStoredPassphrase;
        backup.hasStoredPassphrase = hasOne === undefined ? undefined : async () => hasOne;

        return () => {
            backup.hasStoredPassphrase = previous;
        };
    }

    it("reports how the instance backs up, and whether there is a passphrase rather than what it is", async () => {
        vi.spyOn(optionService, "getOptionOrNull").mockImplementation((name) =>
            name === "backupEnableEncryption" ? "true" : "false");
        const restore = stubStoredPassphrase(true);

        await expect(getExistingBackupDefaults()).resolves.toEqual({
            storedPassphrase: true,
            encrypt: true,
            compress: false
        });

        restore();
    });

    it("offers nothing of the sort where the platform keeps no passphrase", async () => {
        const restore = stubStoredPassphrase(undefined);

        await expect(getExistingBackupDefaults()).resolves.toMatchObject({ storedPassphrase: false });

        restore();
    });
});

describe("the started backup, followed through its status", () => {
    /** Puts a controllable backupAs in place and gives back the strings to pull. */
    function stubBackup(behaviour: (onProgress?: (fraction: number) => void) => Promise<unknown>) {
        const backup = getBackup() as { backupAs?: unknown };
        const previous = backup.backupAs;
        backup.backupAs = (_settings: SetupBackupSettings, onProgress?: (fraction: number) => void) =>
            behaviour(onProgress);

        return () => {
            backup.backupAs = previous;
        };
    }

    it("runs with a live fraction, joins a second start, and ends holding what was written", async () => {
        const written = { fileName: "b", filePath: "/b", fileSize: 1 };
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
