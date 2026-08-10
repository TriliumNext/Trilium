import { readBackupContainer } from "@triliumnext/backup-container";
import type { OptionNames, SetupBackupSettings } from "@triliumnext/commons";
import { getLog, getSql, ws } from "@triliumnext/core";
import fs from "fs";
import os from "os";
import path from "path";
import { Readable, Writable } from "stream";
import { afterAll, afterEach, beforeEach, describe, expect, it, type MockInstance, vi } from "vitest";

import ServerBackupService, { type ServerBackupConfig } from "./backup_provider.js";
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
function desktopService(
    customDbBackupDir: string | null,
    extraOptions: OptionOverrides = {},
    config: Partial<ServerBackupConfig> = {}
) {
    return new ServerBackupService(
        optionsWith(customDbBackupDir, extraOptions),
        { allowCustomDirectory: true, ...config }
    );
}

/** A server service, which ignores the option entirely. */
function serverService(customDbBackupDir: string | null) {
    return new ServerBackupService(optionsWith(customDbBackupDir));
}

type OptionOverrides = Partial<Record<OptionNames, string>>;

function optionsWith(customDbBackupDir: string | null, extraOptions: OptionOverrides = {}) {
    const values: Partial<Record<OptionNames, string | null>> = {
        customDbBackupDir,
        ...extraOptions
    };

    return {
        getOption: (name: OptionNames) => values[name] ?? "",
        getOptionOrNull: (name: OptionNames) => values[name] ?? null,
        getOptionBool: () => false,
        setOption: () => {}
    };
}

function backupNamesIn(directory: string) {
    return fs.existsSync(directory) ? fs.readdirSync(directory).sort() : [];
}

/** Unwraps a container back to the bytes the stub database was made of. */
async function unwrapContainer(filePath: string, passphrase?: string) {
    const chunks: Buffer[] = [];
    const sink = new Writable({
        write(chunk: Buffer, _encoding, callback) {
            chunks.push(Buffer.from(chunk));
            callback();
        }
    });

    await readBackupContainer(Readable.from([ fs.readFileSync(filePath) ]), sink, {
        passphrase,
        // The stub standing in for the online backup is not a real database.
        requireSqliteHeader: false
    });

    return Buffer.concat(chunks).toString();
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
        expect(backupNamesIn(CUSTOM_DIR)).toEqual([ "backup-daily.db" ]);
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
        const listed = await service.getExistingBackups();
        expect(listed.map((b) => b.fileName)).toEqual([ "backup-now.db" ]);
    });
});

describe("ServerBackupService: backup format", () => {
    const PASSPHRASE = "correct horse battery staple";
    const withPassphrase: Partial<ServerBackupConfig> = { getPassphrase: async () => PASSPHRASE };

    it("writes a plain database when neither compression nor encryption is on", async () => {
        const backupFile = await desktopService(CUSTOM_DIR).backupNow("now");

        expect(backupFile).toBe(path.join(CUSTOM_DIR, "backup-now.db"));
        expect(backupNamesIn(CUSTOM_DIR)).toEqual([ "backup-now.db" ]);
    });

    it("writes a compressed container, which unwraps to the database again", async () => {
        const service = desktopService(CUSTOM_DIR, { backupEnableCompression: "true" });

        const backupFile = await service.backupNow("now");

        expect(backupFile).toBe(path.join(CUSTOM_DIR, "backup-now.tnbackup"));
        expect(await unwrapContainer(backupFile)).toBe("db-bytes");
    });

    it("writes an encrypted container, which only the passphrase opens", async () => {
        const service = desktopService(
            CUSTOM_DIR,
            { backupEnableEncryption: "true" },
            withPassphrase
        );

        const backupFile = await service.backupNow("now");

        expect(backupFile).toBe(path.join(CUSTOM_DIR, "backup-now.tnbackup"));
        expect(await unwrapContainer(backupFile, PASSPHRASE)).toBe("db-bytes");
        await expect(unwrapContainer(backupFile, "wrong"))
            .rejects.toMatchObject({ reason: "wrong-passphrase-or-damaged-header" });
    });

    it("compresses and encrypts together when both are on", async () => {
        const service = desktopService(
            CUSTOM_DIR,
            { backupEnableCompression: "true", backupEnableEncryption: "true" },
            withPassphrase
        );

        const backupFile = await service.backupNow("now");

        expect(await unwrapContainer(backupFile, PASSPHRASE)).toBe("db-bytes");
    });

    it("keeps one file per backup name, whichever format it was last written in", async () => {
        await desktopService(CUSTOM_DIR).backupNow("daily");
        expect(backupNamesIn(CUSTOM_DIR)).toEqual([ "backup-daily.db" ]);

        await desktopService(CUSTOM_DIR, { backupEnableCompression: "true" }).backupNow("daily");
        expect(backupNamesIn(CUSTOM_DIR)).toEqual([ "backup-daily.tnbackup" ]);

        await desktopService(CUSTOM_DIR).backupNow("daily");
        expect(backupNamesIn(CUSTOM_DIR)).toEqual([ "backup-daily.db" ]);
    });

    it("leaves no snapshot behind in the data directory", async () => {
        await desktopService(CUSTOM_DIR, { backupEnableCompression: "true" }).backupNow("now");

        const left = fs.readdirSync(dataDir.TMP_DIR);
        const snapshots = left.filter((name) => name.includes("snapshot"));

        expect(snapshots).toEqual([]);
    });

    it("cleans up after a failure, leaving no snapshot and no partial container", async () => {
        copyDatabase.mockRejectedValue(new Error("EIO: i/o error"));

        const backup = desktopService("", { backupEnableCompression: "true" }).backupNow("now");

        await expect(backup).rejects.toThrow("EIO");

        const left = fs.readdirSync(dataDir.TMP_DIR);
        const snapshots = left.filter((name) => name.includes("snapshot"));

        expect(snapshots).toEqual([]);
        expect(backupNamesIn(DEFAULT_DIR)).toEqual([]);
    });

    it("lists containers alongside plain backups", async () => {
        await desktopService("", { backupEnableCompression: "true" }).backupNow("daily");
        await desktopService("").backupNow("weekly");

        const backups = await desktopService("").getExistingBackups();

        expect(backups.map((b) => b.fileName).sort()).toEqual(
            [ "backup-daily.tnbackup",
                "backup-weekly.db" ]
        );
    });

    it("reads what each container is from its own header, not from today's options", async () => {
        await desktopService("", { backupEnableCompression: "true" }).backupNow("compressed");
        const encrypting = desktopService("", { backupEnableEncryption: "true" }, withPassphrase);
        await encrypting.backupNow("encrypted");
        await desktopService("").backupNow("plain");

        // Listed by a service with both switched off: a backup keeps the shape it was written in.
        const listed = await desktopService("").getExistingBackups();
        const byName = new Map(listed.map((b) => [ b.fileName, b ]));

        expect(byName.get("backup-compressed.tnbackup")).toMatchObject(
            { compressed: true,
                encrypted: false,
                plaintextSize: "db-bytes".length }
        );
        expect(byName.get("backup-encrypted.tnbackup")).toMatchObject(
            { compressed: false,
                encrypted: true }
        );
        // A plain copy states nothing of the sort: its own size is the whole story.
        expect(byName.get("backup-plain.db")).not.toHaveProperty("compressed");
        expect(byName.get("backup-plain.db")).not.toHaveProperty("plaintextSize");
    });

    it("lists a container it cannot make sense of, rather than dropping it", async () => {
        fs.mkdirSync(DEFAULT_DIR, { recursive: true });
        fs.writeFileSync(
            path.join(DEFAULT_DIR, "backup-damaged.tnbackup"),
            "not a container at all"
        );

        const backups = await desktopService("").getExistingBackups();

        expect(backups.map((b) => b.fileName)).toEqual([ "backup-damaged.tnbackup" ]);
        expect(backups[0]).not.toHaveProperty("compressed");
        expect(backups[0]).not.toHaveProperty("encrypted");
    });
});

describe("ServerBackupService.backupAs: the backup the setup screen asked for", () => {
    const PASSPHRASE = "correct horse battery staple";
    const withPassphrase: Partial<ServerBackupConfig> = { getPassphrase: async () => PASSPHRASE };

    /** What the screen sends, with the plainest backup there is as the starting point. */
    function asked(overrides: Partial<SetupBackupSettings> = {}): SetupBackupSettings {
        return {
            name: "Before the import",
            passphrase: "",
            useStoredPassphrase: false,
            compress: false,
            ...overrides
        };
    }

    it("writes it under the name the user gave it, spaces and all", async () => {
        const written = await desktopService(CUSTOM_DIR).backupAs(asked());

        // A plain database copy rather than a container, which is what nothing asked for looks like.
        expect(written.fileName).toBe("Before the import.db");
        expect(written.directoryPath).toBe(CUSTOM_DIR);
    });

    it("locks it with the password typed on the screen, over anything the instance is set up for", async () => {
        // Encryption is off in the options, and there is a stored passphrase that is not this one:
        // what the user typed while asking is what the backup is written with.
        const service = desktopService(CUSTOM_DIR, {}, withPassphrase);

        const written = await service.backupAs(asked({ passphrase: "typed-here" }));

        expect(written.fileName).toBe("Before the import.tnbackup");
        expect(await unwrapContainer(written.filePath, "typed-here")).toBe("db-bytes");
        await expect(unwrapContainer(written.filePath, PASSPHRASE))
            .rejects.toMatchObject({ reason: "wrong-passphrase-or-damaged-header" });
    });

    it("locks it with the stored passphrase where that is what was asked for", async () => {
        // The one the screen cannot show and so cannot have sent: asking for it is the only way.
        const service = desktopService(CUSTOM_DIR, {}, withPassphrase);

        const written = await service.backupAs(asked({ useStoredPassphrase: true, passphrase: "ignored" }));

        expect(written.fileName).toBe("Before the import.tnbackup");
        expect(await unwrapContainer(written.filePath, PASSPHRASE)).toBe("db-bytes");
    });

    it("leaves it unlocked where the user cleared the password, however the instance backs up", async () => {
        const service = desktopService(
            CUSTOM_DIR,
            { backupEnableEncryption: "true", backupEnableCompression: "true" },
            withPassphrase
        );

        const written = await service.backupAs(asked());

        // Neither locked nor wrapped, so not a container at all: a plain database copy.
        expect(written.fileName).toBe("Before the import.db");
    });

    it("compresses because the screen said so, not because the option says so", async () => {
        const compressed = await desktopService(CUSTOM_DIR).backupAs(asked({ compress: true }));
        expect(compressed.fileName).toBe("Before the import.tnbackup");
        expect(await unwrapContainer(compressed.filePath)).toBe("db-bytes");

        const plain = await desktopService(CUSTOM_DIR, { backupEnableCompression: "true" })
            .backupAs(asked({ name: "Plain" }));
        expect(plain.fileName).toBe("Plain.db");
    });

    it("falls back to an unencrypted local copy where the stored passphrase turns out to be unreadable", async () => {
        // Only reachable if the keyring fails between the screen being told there is a passphrase
        // and the backup asking for it. A backup is still worth more than no backup.
        const service = desktopService(CUSTOM_DIR, {}, { getPassphrase: async () => null });

        const written = await service.backupAs(asked({ useStoredPassphrase: true }));

        // Unlocked, and so kept out of the chosen directory: that one is typically a synced folder,
        // which is the very thing encryption was turned on to keep a readable database out of.
        expect(written.fileName).toBe("Before the import.db");
        expect(written.directoryPath).toBe(DEFAULT_DIR);
        expect(ws.sendMessageToAllClients).toHaveBeenCalledWith(
            expect.objectContaining({ type: "toast", message: expect.stringContaining("not encrypted") })
        );
    });

    it("says whether there is a stored passphrase, which is all the screen is allowed to learn", async () => {
        await expect(desktopService("", {}, withPassphrase).hasStoredPassphrase()).resolves.toBe(true);
        await expect(desktopService("", {}, { getPassphrase: async () => null }).hasStoredPassphrase())
            .resolves.toBe(false);
        // A build with no keyring behind it at all, which is every server deployment.
        await expect(desktopService("").hasStoredPassphrase()).resolves.toBe(false);
    });
});

describe("ServerBackupService: when the backup passphrase cannot be read", () => {
    const noPassphrase: Partial<ServerBackupConfig> = { getPassphrase: async () => null };

    it("keeps the unencrypted backup out of the chosen directory and says so", async () => {
        const service = desktopService(
            CUSTOM_DIR,
            { backupEnableEncryption: "true" },
            noPassphrase
        );

        const backupFile = await service.backupNow("daily");

        // The chosen directory is typically a synced folder, which is what encryption was avoiding.
        // With nothing left to wrap, the backup is a plain database again rather than an empty
        // container.
        expect(backupFile).toBe(path.join(DEFAULT_DIR, "backup-daily.db"));
        expect(backupNamesIn(CUSTOM_DIR)).toEqual([]);
        expect(ws.sendMessageToAllClients).toHaveBeenCalledWith(
            expect.objectContaining(
                { type: "toast",
                    message: expect.stringContaining("not encrypted") }
            )
        );
    });

    it("still honours compression, so only what could not be done is missing", async () => {
        const service = desktopService(
            CUSTOM_DIR,
            { backupEnableCompression: "true", backupEnableEncryption: "true" },
            noPassphrase
        );

        const backupFile = await service.backupNow("daily");

        expect(backupFile).toBe(path.join(DEFAULT_DIR, "backup-daily.tnbackup"));
    });

    it("says nothing and encrypts nothing when encryption was never asked for", async () => {
        await desktopService(CUSTOM_DIR, {}, noPassphrase).backupNow("daily");

        expect(backupNamesIn(CUSTOM_DIR)).toEqual([ "backup-daily.db" ]);
        expect(ws.sendMessageToAllClients).not.toHaveBeenCalled();
    });

    it("treats a service with no passphrase provider at all the same way", async () => {
        const service = desktopService(CUSTOM_DIR, { backupEnableEncryption: "true" });

        expect(await service.backupNow("daily")).toBe(path.join(DEFAULT_DIR, "backup-daily.db"));
    });
});

describe("ServerBackupService: fallback when the custom directory cannot be written to", () => {
    it("backs up to the default directory and notifies the user", async () => {
        copyDatabase.mockRejectedValueOnce(new Error("ENOSPC: no space left on device"));

        expect(await desktopService(CUSTOM_DIR).backupNow("daily")).toBe(path.join(DEFAULT_DIR, "backup-daily.db"));
        expect(backupNamesIn(DEFAULT_DIR)).toEqual([ "backup-daily.db" ]);

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
        expect(backupNamesIn(DEFAULT_DIR)).toEqual([ "backup-daily.db" ]);
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

        expect(backups.map((b) => b.fileName)).toEqual([ "backup-spec-list.db" ]);
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
            [
                path.join(CUSTOM_DIR, "backup-daily.db"),
                path.join(DEFAULT_DIR, "backup-weekly.db")
            ].sort()
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

describe("ServerBackupService: sending a backup for download", () => {
    /** Collects what was written to it, and records the moment the headers were committed. */
    function fakeResponse() {
        const headers: Record<string, string> = {};
        const chunks: Buffer[] = [];
        let flushedAfter: number | null = null;

        const res = new Writable({
            write(chunk: Buffer, _encoding, callback) {
                chunks.push(Buffer.from(chunk));
                callback();
            }
        }) as Writable & {
            setHeader(name: string, value: string): void;
            flushHeaders(): void;
        };
        res.setHeader = (name, value) => { headers[name] = value; };
        res.flushHeaders = () => { flushedAfter = chunks.length; };

        return { res, headers, chunks, flushed: () => flushedAfter };
    }

    async function written(res: Writable): Promise<void> {
        await new Promise((resolve) => res.on("finish", resolve));
    }

    it("streams it with its headers committed first, so nothing downstream buffers it whole", async () => {
        const filePath = path.join(CUSTOM_DIR, "Backup 2026-08-07 10-32-21.tnbackup");
        fs.mkdirSync(CUSTOM_DIR, { recursive: true });
        fs.writeFileSync(filePath, "backup-bytes");
        const { res, headers, chunks, flushed } = fakeResponse();

        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- the express Response surface this uses.
        expect(desktopService(CUSTOM_DIR).sendBackup?.(filePath, res as any)).toBe(true);
        await written(res);

        expect(Buffer.concat(chunks).toString()).toBe("backup-bytes");
        expect(headers["Content-Disposition"])
            .toBe('attachment; filename="Backup 2026-08-07 10-32-21.tnbackup"');
        expect(headers["Content-Length"]).toBe("12");
        // Before any of the body: the desktop's protocol bridge streams only once headers are
        // flushed, and buffers a multi-gigabyte backup whole otherwise.
        expect(flushed()).toBe(0);
    });

    it("refuses anything that is not an existing backup, rather than sending a file", () => {
        const { res } = fakeResponse();

        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- as above.
        expect(desktopService(CUSTOM_DIR).sendBackup?.("/etc/passwd", res as any)).toBe(false);
    });
});
