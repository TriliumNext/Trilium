import type { OptionNames } from "@triliumnext/commons";
import { getLog, getSql, ws } from "@triliumnext/core";
import fs from "fs";
import os from "os";
import path from "path";
import { afterAll, afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from "vitest";

import ServerBackupService from "./backup_provider.js";
import dataDir from "./services/data_dir.js";

const DEFAULT_DIR = path.resolve(dataDir.BACKUP_DIR);
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "trilium-backup-spec-"));
const CUSTOM_DIR = path.join(tempRoot, "custom");

/** Stands in for the real online backup: writes a small file at the destination. */
let copyDatabase: MockInstance<(target: string) => Promise<void>>;

async function writeStubDatabase(target: string) {
    fs.writeFileSync(target, "db-bytes");
}

/** A desktop service (custom directory honoured) reading the given option value. */
function desktopService(customDbBackupDir: string | null) {
    return new ServerBackupService(optionsWith(customDbBackupDir), { allowCustomDirectory: true });
}

/** A server service, which ignores the option entirely. */
function serverService(customDbBackupDir: string | null) {
    return new ServerBackupService(optionsWith(customDbBackupDir));
}

function optionsWith(customDbBackupDir: string | null) {
    return {
        getOption: (name: OptionNames) => (name === "customDbBackupDir" ? customDbBackupDir ?? "" : ""),
        getOptionOrNull: (name: OptionNames) => (name === "customDbBackupDir" ? customDbBackupDir : null),
        getOptionBool: () => false,
        setOption: () => {}
    };
}

function backupNamesIn(directory: string) {
    return fs.existsSync(directory) ? fs.readdirSync(directory).sort() : [];
}

beforeEach(() => {
    copyDatabase = vi.spyOn(getSql(), "copyDatabase").mockImplementation(writeStubDatabase);
    vi.spyOn(ws, "sendMessageToAllClients").mockImplementation(() => {});

    fs.rmSync(tempRoot, { recursive: true, force: true });
    fs.mkdirSync(tempRoot, { recursive: true });
    fs.rmSync(DEFAULT_DIR, { recursive: true, force: true });
});

afterEach(() => vi.restoreAllMocks());

afterAll(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
    fs.rmSync(DEFAULT_DIR, { recursive: true, force: true });
});

describe("ServerBackupService: backup location", () => {
    it("uses the default directory when no custom one is configured", async () => {
        const service = desktopService("");

        expect(service.getBackupFolderPath()).toBe(DEFAULT_DIR);
        expect(await service.backupNow("now")).toBe(path.join(DEFAULT_DIR, "backup-now.db"));
    });

    it("uses the custom directory on the desktop, creating it if needed", async () => {
        const service = desktopService(CUSTOM_DIR);

        expect(service.getBackupFolderPath()).toBe(CUSTOM_DIR);
        expect(await service.backupNow("daily")).toBe(path.join(CUSTOM_DIR, "backup-daily.db"));
        expect(backupNamesIn(CUSTOM_DIR)).toEqual(["backup-daily.db"]);
        expect(backupNamesIn(DEFAULT_DIR)).toEqual([]);
    });

    it("ignores the custom directory on the server, which is configured via TRILIUM_BACKUP_DIR", async () => {
        const service = serverService(CUSTOM_DIR);

        expect(service.getBackupFolderPath()).toBe(DEFAULT_DIR);
        expect(await service.backupNow("daily")).toBe(path.join(DEFAULT_DIR, "backup-daily.db"));
        expect(backupNamesIn(CUSTOM_DIR)).toEqual([]);
    });

    it("falls back to the default directory for a blank, whitespace-only or missing option", () => {
        expect(desktopService("").getBackupFolderPath()).toBe(DEFAULT_DIR);
        expect(desktopService("   ").getBackupFolderPath()).toBe(DEFAULT_DIR);
        // The option row does not exist yet, e.g. the pre-migration backup of an older database.
        expect(desktopService(null).getBackupFolderPath()).toBe(DEFAULT_DIR);
    });

    it("resolves a relative custom directory against the working directory", () => {
        expect(desktopService("./my-backups").getBackupFolderPath()).toBe(path.resolve("./my-backups"));
    });

    it("treats a custom directory equal to the default one as no custom directory", async () => {
        const service = desktopService(DEFAULT_DIR);

        expect(service.getBackupFolderPath()).toBe(DEFAULT_DIR);
        await service.backupNow("now");
        // Listed once, not once per configured directory.
        expect((await service.getExistingBackups()).map((b) => b.fileName)).toEqual(["backup-now.db"]);
    });
});

describe("ServerBackupService: fallback when the custom directory cannot be written to", () => {
    it("backs up to the default directory and notifies the user", async () => {
        copyDatabase.mockRejectedValueOnce(new Error("ENOSPC: no space left on device"));

        expect(await desktopService(CUSTOM_DIR).backupNow("daily")).toBe(path.join(DEFAULT_DIR, "backup-daily.db"));
        expect(backupNamesIn(DEFAULT_DIR)).toEqual(["backup-daily.db"]);

        expect(ws.sendMessageToAllClients).toHaveBeenCalledWith(
            expect.objectContaining({
                type: "toast",
                message: `Database backup failed: unable to write to ${CUSTOM_DIR}. Backing up to the default location instead.`
            })
        );
    });

    it("falls back when the custom directory itself cannot be created", async () => {
        // A file where the directory should be: mkdir fails on every platform.
        const blocked = path.join(tempRoot, "blocked");
        fs.writeFileSync(blocked, "not-a-directory");

        const service = desktopService(path.join(blocked, "backups"));

        expect(await service.backupNow("now")).toBe(path.join(DEFAULT_DIR, "backup-now.db"));
        expect(ws.sendMessageToAllClients).toHaveBeenCalledOnce();
    });

    it("leaves no half-written file behind in the custom directory", async () => {
        copyDatabase.mockImplementationOnce(async (target: string) => {
            fs.writeFileSync(target, "partial");
            throw new Error("EIO: i/o error");
        });

        await desktopService(CUSTOM_DIR).backupNow("daily");

        expect(backupNamesIn(CUSTOM_DIR)).toEqual([]);
        expect(backupNamesIn(DEFAULT_DIR)).toEqual(["backup-daily.db"]);
    });

    it("propagates the failure when the default directory fails too", async () => {
        copyDatabase.mockRejectedValue(new Error("EACCES: permission denied"));

        await expect(desktopService(CUSTOM_DIR).backupNow("now")).rejects.toThrow("EACCES");
    });

    it("does not notify when there is no custom directory to fall back from", async () => {
        copyDatabase.mockRejectedValue(new Error("EACCES: permission denied"));

        await expect(desktopService("").backupNow("now")).rejects.toThrow("EACCES");
        expect(ws.sendMessageToAllClients).not.toHaveBeenCalled();
    });
});

describe("ServerBackupService: what reaches the backend log", () => {
    /** The log is meant to be postable for diagnostics as-is, so no backup path may appear in it. */
    function loggedBy(method: "info" | "error") {
        return vi.spyOn(getLog(), method).mockImplementation(() => {});
    }

    function linesFrom(spy: ReturnType<typeof loggedBy>) {
        return spy.mock.calls.flat().join("\n");
    }

    it("names the backup relative to its directory, never the directory itself", async () => {
        const info = loggedBy("info");

        await desktopService("").backupNow("daily");

        expect(linesFrom(info)).toContain(`Created backup .${path.sep}backup-daily.db`);
        expect(linesFrom(info)).not.toContain(DEFAULT_DIR);
    });

    it("says a backup went to the custom location without saying where that is", async () => {
        const info = loggedBy("info");

        await desktopService(CUSTOM_DIR).backupNow("daily");

        expect(linesFrom(info)).toContain(`Created backup .${path.sep}backup-daily.db in the custom backup location.`);
        expect(linesFrom(info)).not.toContain(CUSTOM_DIR);
    });

    it("keeps the reason for a fallback but strips the location the error quotes back", async () => {
        const error = loggedBy("error");
        copyDatabase.mockRejectedValueOnce(new Error(`EACCES: permission denied, open '${CUSTOM_DIR}\\backup-daily.db'`));

        await desktopService(CUSTOM_DIR).backupNow("daily");

        expect(linesFrom(error)).toContain("EACCES: permission denied");
        expect(linesFrom(error)).not.toContain(CUSTOM_DIR);
    });

    it("strips the location from the failure it propagates when there is nowhere left to fall back to", async () => {
        copyDatabase.mockRejectedValue(new Error(`ENOSPC: no space left on device, open '${DEFAULT_DIR}\\backup-now.db'`));

        const failure = await desktopService("").backupNow("now").catch((e: Error) => e.message);

        expect(failure).toContain("ENOSPC: no space left on device");
        expect(failure).not.toContain(DEFAULT_DIR);
    });
});

describe("ServerBackupService.backupNow: naming", () => {
    it("rejects a name with no usable characters", async () => {
        await expect(desktopService("").backupNow("../..")).rejects.toThrow("Invalid backup name");
    });

    it("strips path traversal from the name", async () => {
        expect(await desktopService(CUSTOM_DIR).backupNow("../../evil")).toBe(path.join(CUSTOM_DIR, "backup-evil.db"));
    });
});

describe("ServerBackupService.getExistingBackups", () => {
    it("lists .db backups with their size, excluding intermediate SQLite files", async () => {
        fs.mkdirSync(DEFAULT_DIR, { recursive: true });
        fs.writeFileSync(path.join(DEFAULT_DIR, "backup-spec-list.db"), "backup-bytes");
        fs.writeFileSync(path.join(DEFAULT_DIR, "backup-spec-list.db-journal"), "journal-bytes");

        const backups = await desktopService("").getExistingBackups();

        expect(backups.map((b) => b.fileName)).toEqual(["backup-spec-list.db"]);
        expect(backups[0].fileSize).toBe("backup-bytes".length);
        expect(backups[0].filePath).toBe(path.join(DEFAULT_DIR, "backup-spec-list.db"));
        expect(backups[0].mtime).toBeInstanceOf(Date);
    });

    it("merges the custom and the default directory, so redirected backups stay reachable", async () => {
        fs.mkdirSync(CUSTOM_DIR, { recursive: true });
        fs.mkdirSync(DEFAULT_DIR, { recursive: true });
        fs.writeFileSync(path.join(CUSTOM_DIR, "backup-daily.db"), "a");
        fs.writeFileSync(path.join(DEFAULT_DIR, "backup-weekly.db"), "b");

        const backups = await desktopService(CUSTOM_DIR).getExistingBackups();

        expect(backups.map((b) => b.filePath).sort()).toEqual(
            [path.join(CUSTOM_DIR, "backup-daily.db"), path.join(DEFAULT_DIR, "backup-weekly.db")].sort()
        );
    });

    it("tolerates a custom directory that does not exist", async () => {
        await expect(desktopService(path.join(tempRoot, "gone")).getExistingBackups()).resolves.toEqual([]);
    });
});

describe("ServerBackupService.getBackupContent", () => {
    it("reads a backup from the default directory", async () => {
        fs.mkdirSync(DEFAULT_DIR, { recursive: true });
        const file = path.join(DEFAULT_DIR, "backup-now.db");
        fs.writeFileSync(file, "db-bytes");

        expect(await desktopService("").getBackupContent(file)).toEqual(Buffer.from("db-bytes"));
    });

    it("reads a backup from the custom directory", async () => {
        fs.mkdirSync(CUSTOM_DIR, { recursive: true });
        const file = path.join(CUSTOM_DIR, "backup-now.db");
        fs.writeFileSync(file, "db-bytes");

        expect(await desktopService(CUSTOM_DIR).getBackupContent(file)).toEqual(Buffer.from("db-bytes"));
    });

    it("refuses a path outside the backup directories", async () => {
        const outside = path.join(tempRoot, "secret.db");
        fs.writeFileSync(outside, "secret");

        expect(await desktopService(CUSTOM_DIR).getBackupContent(outside)).toBeNull();
        expect(await desktopService(CUSTOM_DIR).getBackupContent(path.join(DEFAULT_DIR, "..", "document.db"))).toBeNull();
        // The directory itself is not a backup.
        expect(await desktopService(CUSTOM_DIR).getBackupContent(CUSTOM_DIR)).toBeNull();
        // The custom directory is only allowed while it is the configured one.
        expect(await desktopService("").getBackupContent(path.join(CUSTOM_DIR, "backup-now.db"))).toBeNull();
    });

    it("accepts a custom directory given with a trailing separator", async () => {
        fs.mkdirSync(CUSTOM_DIR, { recursive: true });
        const file = path.join(CUSTOM_DIR, "backup-now.db");
        fs.writeFileSync(file, "db-bytes");

        expect(await desktopService(CUSTOM_DIR + path.sep).getBackupContent(file)).toEqual(Buffer.from("db-bytes"));
    });

    it("returns null for a missing file inside the backup directory", async () => {
        expect(await desktopService("").getBackupContent(path.join(DEFAULT_DIR, "backup-absent.db"))).toBeNull();
    });
});
