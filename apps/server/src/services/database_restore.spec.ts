import { writeBackupContainer } from "@triliumnext/backup-container";
// `sql_init` from core rather than the server's own re-export, which copies the function references
// onto a fresh object: a spy on that one would not be seen by `database_restore`.
import {
    app_info as appInfo,
    events,
    getBackup,
    getLog,
    getSql,
    OLDEST_SUPPORTED_DB_VERSION,
    sql_init as sqlInit
} from "@triliumnext/core";
import Database from "better-sqlite3";
import fs from "fs";
import os from "os";
import path from "path";
import { afterAll, afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/** Where the backup directory is configured to be, when a test needs it somewhere in particular. */
const { configuredBackupDir } = vi.hoisted(() => ({ configuredBackupDir: { value: "" } }));

// The database a restore replaces, and everything around it, live in a temporary directory: the
// restore detaches, renames and deletes the files at these paths.
vi.mock("./data_dir.js", async (importOriginal) => {
    const original = await importOriginal<typeof import("./data_dir.js")>();
    const { mkdtempSync } = await import("fs");
    const { tmpdir } = await import("os");
    const { join } = await import("path");
    const root = mkdtempSync(join(tmpdir(), "trilium-restore-data-spec-"));

    return {
        ...original,
        default: {
            ...original.default,
            TRILIUM_DATA_DIR: root,
            DOCUMENT_PATH: join(root, "document.db"),
            TMP_DIR: join(root, "tmp"),
            get BACKUP_DIR() {
                return configuredBackupDir.value || join(root, "backup");
            }
        }
    };
});

import type ServerBackupService from "../backup_provider.js";
import dataDir from "./data_dir.js";
import {
    adoptBackupPassphrase,
    exchangeDatabaseFiles,
    getRestoreProgress,
    logRestore,
    logRestoreError,
    reportStepProgress,
    readBackupFormat,
    removeQuietly,
    reportRestoreFailure,
    restoreDatabase,
    RestoreFailure,
    type RestoreRequest,
    stageBackup
} from "./database_restore.js";

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "trilium-restore-spec-"));
let counter = 0;

/** The database being replaced, and the files a restore leaves beside it. */
const DOCUMENT_FILES = [ "", "-wal", "-shm", ".pre-restore", ".restore-in-progress" ]
    .map((suffix) => `${dataDir.DOCUMENT_PATH}${suffix}`);

beforeEach(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
    fs.mkdirSync(tempRoot, { recursive: true });
    for (const file of DOCUMENT_FILES) {
        fs.rmSync(file, { force: true });
    }
    // The state a restore actually runs in: the setup screen, with no database of this instance's
    // own open. `restoreDatabase` refuses anywhere else, and the shared fixture is initialized.
    vi.spyOn(sqlInit, "isDbInitialized").mockReturnValue(false);
});

afterEach(() => vi.restoreAllMocks());

afterAll(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
    fs.rmSync(dataDir.TRILIUM_DATA_DIR, { recursive: true, force: true });
});

/** A database that would pass validation, so a test can tell a rejected file from a rejected step. */
function validDatabase(name = `db-${counter++}.db`, dbVersion = appInfo.dbVersion) {
    const filePath = path.join(tempRoot, name);
    const db = new Database(filePath);
    try {
        for (const table of [ "options", "notes", "branches", "blobs" ]) {
            db.exec(`CREATE TABLE ${table} (name TEXT, value TEXT)`);
        }
        const insert = db.prepare("INSERT INTO options (name, value) VALUES (?, ?)");
        insert.run("initialized", "true");
        insert.run("dbVersion", String(dbVersion));
    } finally {
        db.close();
    }

    return filePath;
}

/** Wraps `source` the way a backup does, with the same writer the backup service uses. */
async function containerOf(source: string, passphrase?: string, compress = false) {
    const filePath = path.join(tempRoot, `backup-${counter++}.tnbackup`);

    await writeBackupContainer(fs.createReadStream(source), fs.createWriteStream(filePath), {
        compress,
        passphrase,
        plaintextSize: fs.statSync(source).size
    });

    return filePath;
}

function fileWith(content: string, name = `file-${counter++}.bin`) {
    const filePath = path.join(tempRoot, name);
    fs.writeFileSync(filePath, content);

    return filePath;
}

describe("reading what a backup file is", () => {
    it("tells a container from a plain database, going by the header rather than the name", async () => {
        const database = validDatabase("looks-like-a-backup.tnbackup");
        expect(readBackupFormat(database)).toEqual({ container: false, encrypted: false });

        const plain = await containerOf(validDatabase());
        expect(readBackupFormat(plain)).toEqual({ container: true, encrypted: false });

        const encrypted = await containerOf(validDatabase(), "hunter2");
        expect(readBackupFormat(encrypted)).toEqual({ container: true, encrypted: true });
    });

    it("answers for a file it cannot read at all", () => {
        expect(readBackupFormat(path.join(tempRoot, "not-here.db"))).toBe(null);
        expect(readBackupFormat(fileWith("short"))).toEqual({ container: false, encrypted: false });
    });
});

describe("staging a backup", () => {
    it("takes an uploaded database where it lies rather than copying gigabytes for no reason", async () => {
        const uploaded = validDatabase();

        const candidate = await stageBackup({ path: uploaded, fileName: "backup.db", consumable: true });

        expect(candidate).toBe(uploaded);
    });

    it("copies a backup that has to stay where it is, leaving the original untouched", async () => {
        const existing = validDatabase();

        const candidate = await stageBackup({ path: existing, fileName: "backup.db", consumable: false });

        expect(candidate).not.toBe(existing);
        expect(fs.existsSync(existing)).toBe(true);
        expect(fs.readFileSync(candidate)).toEqual(fs.readFileSync(existing));
    });

    it("unwraps a container back into the database it was made from", async () => {
        const source = validDatabase();
        const backup = await containerOf(source, undefined, true);

        const candidate = await stageBackup({ path: backup, fileName: "backup.tnbackup", consumable: true });

        expect(fs.readFileSync(candidate)).toEqual(fs.readFileSync(source));
        // Consumable: the container has served its purpose and the unwrapped copy is what matters now.
        expect(fs.existsSync(backup)).toBe(false);
    });

    it("asks for a passphrase before reading an encrypted container, not after", async () => {
        const backup = await containerOf(validDatabase(), "hunter2");
        const readStream = vi.spyOn(fs, "createReadStream");

        await expect(stageBackup({ path: backup, fileName: "backup.tnbackup", consumable: false }))
            .rejects.toMatchObject({ reason: "passphrase-required" });

        expect(readStream).not.toHaveBeenCalled();
        // Nothing was consumed, so the same file can be tried again once the passphrase is known.
        expect(fs.existsSync(backup)).toBe(true);
    });

    it("tells a wrong passphrase apart from a file that is damaged beyond it", async () => {
        const backup = await containerOf(validDatabase(), "hunter2");

        await expect(stageBackup({ path: backup, fileName: "b.tnbackup", consumable: true, passphrase: "wrong" }))
            .rejects.toMatchObject({ reason: "wrong-passphrase-or-damaged-header" });

        // Kept, because another passphrase is exactly what could still make it work.
        expect(fs.existsSync(backup)).toBe(true);
    });

    it("closes both files when the unwrap fails, so what is left can be deleted and replaced", async () => {
        // Windows refuses to delete or overwrite an open file, so a leaked handle turns one wrong
        // password into a staging directory that cannot be cleared (ENOTEMPTY) and an uploaded
        // backup the next attempt cannot replace (EPERM).
        const backup = await containerOf(validDatabase(), "hunter2");
        const opened = vi.spyOn(fs, "createReadStream");
        const written = vi.spyOn(fs, "createWriteStream");

        await expect(stageBackup({ path: backup, fileName: "b.tnbackup", consumable: false, passphrase: "wrong" }))
            .rejects.toMatchObject({ reason: "wrong-passphrase-or-damaged-header" });

        expect(opened.mock.results[0].value.closed).toBe(true);
        expect(written.mock.results[0].value.closed).toBe(true);
        // Which is what the caller then relies on, on both counts.
        expect(() => fs.rmSync(path.dirname(String(written.mock.calls[0][0])), { recursive: true })).not.toThrow();
        expect(() => fs.rmSync(backup)).not.toThrow();
    });

    it("refuses a file it cannot even open", async () => {
        await expect(stageBackup({ path: path.join(tempRoot, "gone.db"), fileName: "gone.db", consumable: false }))
            .rejects.toMatchObject({ reason: "not-a-database" });
    });
});

describe("what the log is told", () => {
    /** Everything the restore said, as one body of text to look through. */
    function transcript(lines: string[]) {
        return lines.join("\n");
    }

    it("prefixes every line, so one restore can be picked out of a log by searching for it", () => {
        const said: string[] = [];
        vi.spyOn(getLog(), "info").mockImplementation((message) => said.push(String(message)));
        vi.spyOn(getLog(), "error").mockImplementation((message) => said.push(String(message)));

        logRestore("something happened");
        logRestoreError("something went wrong");

        expect(said).toEqual([ "Backup restore: something happened", "Backup restore: something went wrong" ]);
    });

    it("keeps the filesystem out of what it quotes back, so the log can be handed over unread", () => {
        const said: string[] = [];
        vi.spyOn(getLog(), "error").mockImplementation((message) => said.push(String(message)));

        // The shape a filesystem error arrives in: our own words, and a path we did not write.
        logRestoreError(`the exchange failed: EPERM, Permission denied: ${dataDir.DOCUMENT_PATH}`);
        logRestoreError(`a temporary file would not go away: ENOTEMPTY: ${dataDir.TMP_DIR}`);

        expect(transcript(said)).not.toContain(dataDir.TRILIUM_DATA_DIR);
        expect(said[0]).toContain("<database>");
        expect(said[1]).toContain("<temporary files>");
    });

    it("leaves ordinary words alone, however the data directory happens to be configured", () => {
        const said: string[] = [];
        vi.spyOn(getLog(), "info").mockImplementation((message) => said.push(String(message)));

        // A relatively configured data directory ("TRILIUM_DATA_DIR=data", which the development
        // scripts use) was replaced as a bare substring, turning every "database" into
        // "<data directory>base" and making the log read as nonsense.
        logRestore("detaching the database being replaced");

        expect(said[0]).toContain("detaching the database being replaced");
    });

    it("scrubs a relatively configured location in both spellings, and a bare word in neither", () => {
        const said: string[] = [];
        vi.spyOn(getLog(), "info").mockImplementation((message) => said.push(String(message)));

        // An error quotes back whichever form the failed call was given: the configured one, or
        // the one resolved against the working directory.
        configuredBackupDir.value = path.join("relative", "backups");
        try {
            logRestore(`EACCES: ${path.resolve("relative", "backups")} and ${path.join("relative", "backups")}`);

            configuredBackupDir.value = "backups";
            logRestore(`EACCES: ${path.resolve("backups")}, while the backups were being listed`);
        } finally {
            configuredBackupDir.value = "";
        }

        expect(said).toEqual([
            "Backup restore: EACCES: <backup location> and <backup location>",
            "Backup restore: EACCES: <backup location>, while the backups were being listed"
        ]);
    });

    it("names every step it enters and where it stopped, without naming the backup", async () => {
        const said: string[] = [];
        vi.spyOn(getLog(), "info").mockImplementation((message) => said.push(String(message)));
        vi.spyOn(getLog(), "error").mockImplementation((message) => said.push(String(message)));

        await expect(restoreDatabase({
            path: fileWith("a photograph, renamed"),
            fileName: "holidays-in-crete.db",
            consumable: false
        })).rejects.toBeInstanceOf(RestoreFailure);

        const log = transcript(said);
        expect(log).toContain("Backup restore: starting");
        // Staged without complaint — any readable file can be copied — and refused by the check that
        // opens it, which is the distinction the step in this line is there to draw.
        expect(log).toContain("failed at the 'validating' step");
        expect(log).toContain("not-a-database");
        // The name is the user's, and says nothing a diagnosis needs.
        expect(log).not.toContain("holidays-in-crete");
    });

    it("reports how far a long step has got, in brackets, once per tenth of the way", () => {
        const said: string[] = [];
        vi.spyOn(getLog(), "info").mockImplementation((message) => said.push(String(message)));
        const report = reportStepProgress("unwrapping the backup");

        // What the container module sends: a position at whatever rate its own throttle allows.
        for (const fraction of [ 0, 0.02, 0.05, 0.09, 0.1, 0.15, 0.2, 0.99, 1 ]) {
            report(fraction);
        }

        expect(said).toEqual([
            "Backup restore: unwrapping the backup [0%]",
            "Backup restore: unwrapping the backup [10%]",
            "Backup restore: unwrapping the backup [20%]",
            "Backup restore: unwrapping the backup [99%]",
            "Backup restore: unwrapping the backup [100%]"
        ]);
    });

    it("says nothing more while a step is not getting anywhere, however often it is asked", () => {
        const said: string[] = [];
        vi.spyOn(getLog(), "info").mockImplementation((message) => said.push(String(message)));
        const report = reportStepProgress("unwrapping the backup");

        report(0.42);
        for (let i = 0; i < 50; i++) {
            report(0.42);
        }

        // A stall is told apart from slow going by the log not growing, which it cannot do if every
        // report writes a line.
        expect(said).toEqual([ "Backup restore: unwrapping the backup [42%]" ]);
    });

    it("reports the progress of a real unwrap", async () => {
        const said: string[] = [];
        vi.spyOn(getLog(), "info").mockImplementation((message) => said.push(String(message)));
        const backup = await containerOf(validDatabase());

        await stageBackup({ path: backup, fileName: "backup.tnbackup", consumable: false });

        expect(transcript(said)).toContain("unwrapping the backup [100%]");
    });

    it("puts the position where the screen can see it, every time rather than every tenth", () => {
        vi.spyOn(getLog(), "info").mockImplementation(() => {});
        reportRestoreFailure("backup.db", new Error("so that there is a progress to carry it"));
        const report = reportStepProgress("unwrapping the backup");

        report(0.42);
        expect(getRestoreProgress()?.fraction).toBe(0.42);

        // Between two logged tenths, and still the latest thing the screen is told.
        report(0.47);
        expect(getRestoreProgress()?.fraction).toBe(0.47);
    });

    it("says which steps a restore got through, so one that stops says where", async () => {
        const said: string[] = [];
        vi.spyOn(getLog(), "info").mockImplementation((message) => said.push(String(message)));
        vi.spyOn(getLog(), "error").mockImplementation(() => {});
        const detach = vi.spyOn(getSql(), "detachConnection").mockImplementation(() => {
            throw new Error("the database is in the middle of a transaction");
        });

        await expect(restoreDatabase({ path: validDatabase(), fileName: "backup.db", consumable: false }))
            .rejects.toBeInstanceOf(RestoreFailure);

        // A step's position belongs to that step, so it is not left showing under the next one.
        expect(getRestoreProgress()?.fraction).toBeUndefined();

        const log = transcript(said);
        expect(detach).toHaveBeenCalled();
        expect(log).toContain("the backup is a plain database");
        expect(log).toContain("step 'validating'");
        expect(log).toContain("database version");
        expect(log).toContain("step 'swapping'");
        // It never got as far as opening anything.
        expect(log).not.toContain("step 'migrating'");
    });
});

describe("removing what is no longer wanted", () => {
    it("removes a file, and a directory when it is told to", () => {
        const file = fileWith("temporary");
        const directory = path.join(tempRoot, "staging");
        fs.mkdirSync(directory, { recursive: true });
        fs.writeFileSync(path.join(directory, "candidate.db"), "half a database");

        removeQuietly(file);
        removeQuietly(directory, { recursive: true });

        expect(fs.existsSync(file)).toBe(false);
        expect(fs.existsSync(directory)).toBe(false);
    });

    it("says nothing about something that was never there", () => {
        const errors = vi.spyOn(getLog(), "error");

        removeQuietly(path.join(tempRoot, "never-existed"));

        expect(errors).not.toHaveBeenCalled();
    });

    it("logs and carries on when the file will not go, rather than raising", () => {
        const errors = vi.spyOn(getLog(), "error").mockImplementation(() => {});
        vi.spyOn(fs, "rmSync").mockImplementation(() => {
            throw new Error("EPERM, Permission denied");
        });

        expect(() => removeQuietly(fileWith("locked"))).not.toThrow();
        expect(errors).toHaveBeenCalledWith(expect.stringContaining("EPERM"));
    });
});

describe("exchanging the database files", () => {
    it("puts the candidate in place, keeps the old database aside, and drops its sidecars", () => {
        const document = path.join(tempRoot, "document.db");
        fs.writeFileSync(document, "the old database");
        fs.writeFileSync(`${document}-wal`, "old write-ahead log");
        fs.writeFileSync(`${document}-shm`, "old shared memory");
        const candidate = fileWith("the restored database");

        exchangeDatabaseFiles(candidate, document);

        expect(fs.readFileSync(document, "utf-8")).toBe("the restored database");
        expect(fs.readFileSync(`${document}.pre-restore`, "utf-8")).toBe("the old database");
        expect(fs.existsSync(`${document}-wal`)).toBe(false);
        expect(fs.existsSync(`${document}-shm`)).toBe(false);
        expect(fs.existsSync(candidate)).toBe(false);
    });

    it("works where there is no database yet, which is the usual case during setup", () => {
        const document = path.join(tempRoot, "document.db");

        exchangeDatabaseFiles(fileWith("the restored database"), document);

        expect(fs.readFileSync(document, "utf-8")).toBe("the restored database");
        expect(fs.existsSync(`${document}.pre-restore`)).toBe(false);
    });

    it("replaces what an earlier restore had set aside rather than refusing to start", () => {
        const document = path.join(tempRoot, "document.db");
        fs.writeFileSync(document, "the current database");
        fs.writeFileSync(`${document}.pre-restore`, "from an earlier attempt");

        exchangeDatabaseFiles(fileWith("the restored database"), document);

        expect(fs.readFileSync(`${document}.pre-restore`, "utf-8")).toBe("the current database");
    });
});

describe("recovering from an interrupted restore", () => {
    /** Imported lazily so the default path is bound per call rather than at module load. */
    async function recover(document: string) {
        const { recoverInterruptedRestore } = await import("./database_restore.js");
        vi.spyOn(console, "info").mockImplementation(() => {});
        recoverInterruptedRestore(document);
    }

    it("does nothing when no restore was under way", async () => {
        const document = path.join(tempRoot, "document.db");
        fs.writeFileSync(document, "the database");

        await recover(document);

        expect(fs.readFileSync(document, "utf-8")).toBe("the database");
    });

    it("puts the previous database back when one was set aside", async () => {
        const document = path.join(tempRoot, "document.db");
        fs.writeFileSync(document, "half a restored database");
        fs.writeFileSync(`${document}-wal`, "a log belonging to neither");
        fs.writeFileSync(`${document}.pre-restore`, "the database it had");
        fs.writeFileSync(`${document}.restore-in-progress`, "");

        await recover(document);

        expect(fs.readFileSync(document, "utf-8")).toBe("the database it had");
        expect(fs.existsSync(`${document}-wal`)).toBe(false);
        expect(fs.existsSync(`${document}.pre-restore`)).toBe(false);
        expect(fs.existsSync(`${document}.restore-in-progress`)).toBe(false);
    });

    it("keeps the database in place when nothing was set aside, and clears the marker", async () => {
        const document = path.join(tempRoot, "document.db");
        fs.writeFileSync(document, "a whole database");
        fs.writeFileSync(`${document}.restore-in-progress`, "");

        await recover(document);

        expect(fs.readFileSync(document, "utf-8")).toBe("a whole database");
        expect(fs.existsSync(`${document}.restore-in-progress`)).toBe(false);
    });
});

describe("restoring a database", () => {
    it("refuses outright on an instance that already has a database", async () => {
        // The route this is reached through is guarded by `checkAppNotInitialized`, and until this
        // check existed that middleware was the only thing between a running instance and a restore
        // over the top of it. Every other way of replacing a database refuses on its own account.
        vi.spyOn(sqlInit, "isDbInitialized").mockReturnValue(true);
        const detach = vi.spyOn(getSql(), "detachConnection").mockImplementation(() => {});

        await expect(restoreDatabase({
            path: validDatabase(),
            fileName: "holiday.db",
            consumable: false
        })).rejects.toMatchObject({ reason: "restore-refused" });

        expect(detach).not.toHaveBeenCalled();
    });

    it("stops before touching the live database when the backup is not one", async () => {
        const detach = vi.spyOn(getSql(), "detachConnection").mockImplementation(() => {});

        await expect(restoreDatabase({
            path: fileWith("a photograph, renamed"),
            fileName: "holiday.db",
            consumable: false
        })).rejects.toBeInstanceOf(RestoreFailure);

        expect(detach).not.toHaveBeenCalled();
        expect(getRestoreProgress()).toMatchObject({
            stage: "failed", fileName: "holiday.db", reason: "not-a-database"
        });
    });

    it("reports why it failed even when the tidying up afterwards fails too", async () => {
        // A throw from the `finally` would replace the failure on its way out, and the client would
        // be told the temporary directory would not delete rather than that the password was wrong.
        vi.spyOn(fs, "rmSync").mockImplementation(() => {
            throw new Error("ENOTEMPTY, Directory not empty");
        });

        await expect(restoreDatabase({
            path: fileWith("a photograph, renamed"),
            fileName: "holiday.db",
            consumable: false
        })).rejects.toMatchObject({ reason: "not-a-database" });

        expect(getRestoreProgress()).toMatchObject({ stage: "failed", reason: "not-a-database" });
    });

    it("records a failure that happened instead of a restore, so nothing waits on a run that never began", () => {
        reportRestoreFailure("backup.db", new Error("setup is already busy with 'new-document'"));

        expect(getRestoreProgress()).toEqual({
            stage: "failed",
            fileName: "backup.db",
            error: "setup is already busy with 'new-document'",
            reason: "restore-refused"
        });

        // A refusal that already carries a reason keeps it.
        reportRestoreFailure("backup.db", new RestoreFailure("database-too-new", "From a newer version."));
        expect(getRestoreProgress()).toMatchObject({ reason: "database-too-new", error: "From a newer version." });
    });

    it("stops before touching the live database when the backup is from a newer version", async () => {
        const detach = vi.spyOn(getSql(), "detachConnection").mockImplementation(() => {});
        const database = validDatabase();
        const db = new Database(database);
        db.prepare("UPDATE options SET value = ? WHERE name = 'dbVersion'").run(String(appInfo.dbVersion + 1));
        db.close();

        await expect(restoreDatabase({ path: database, fileName: "newer.db", consumable: false }))
            .rejects.toMatchObject({ reason: "database-too-new" });

        expect(detach).not.toHaveBeenCalled();
        expect(getRestoreProgress()).toMatchObject({ stage: "failed", reason: "database-too-new" });
    });
});

describe("the backup password after a restore", () => {
    /** What the restore reaches for: the desktop's keyring, by way of the backup service. */
    const backupService = () => getBackup() as ServerBackupService;

    function request(passphrase?: string): RestoreRequest {
        const fileName = "backup.tnbackup";

        return { path: fileName, fileName, consumable: false, passphrase };
    }

    it("takes on the password that opened the backup, which is this database's now", async () => {
        const adopted = vi.spyOn(backupService(), "adoptPassphrase").mockResolvedValue();

        await adoptBackupPassphrase(request("the newer database's password"), true);

        expect(adopted).toHaveBeenCalledWith("the newer database's password");
    });

    it.each([
        [ "an unlocked backup", undefined, false ],
        [ "a password typed for a backup that turned out not to need one", "typed anyway", false ],
        [ "a locked backup that was somehow opened without one", undefined, true ]
    ])("lets go of the stored password after %s", async (_label, passphrase, wasEncrypted) => {
        // The stored one belongs to the database that was here before. Kept, this instance goes on
        // encrypting with it and writes backups the password the user expects will not open.
        const adopted = vi.spyOn(backupService(), "adoptPassphrase").mockResolvedValue();

        await adoptBackupPassphrase(request(passphrase), wasEncrypted);

        expect(adopted).toHaveBeenCalledWith(null);
    });

    it("does not fail a restore that already happened over a keyring that will not answer", async () => {
        const said: string[] = [];
        vi.spyOn(getLog(), "error").mockImplementation((message) => said.push(String(message)));
        vi.spyOn(backupService(), "adoptPassphrase")
            .mockRejectedValue(new Error("the keyring is locked"));

        // The database is in place and open by this point; there is nothing left to undo and no
        // honest way to call the restore failed.
        await expect(adoptBackupPassphrase(request("a password"), true)).resolves.toBeUndefined();
        expect(said.join("\n")).toContain("the keyring is locked");
    });
});

describe("putting a restored database in place", () => {
    const document = dataDir.DOCUMENT_PATH;

    /**
     * Stands in for the connection and everything that opens a database, so the files can be
     * exchanged for real while the shared in-memory fixture stays attached.
     */
    function attachedDatabase() {
        const said: string[] = [];
        vi.spyOn(getLog(), "info").mockImplementation((message) => said.push(String(message)));
        vi.spyOn(getLog(), "error").mockImplementation((message) => said.push(String(message)));

        return {
            log: () => said.join("\n"),
            detach: vi.spyOn(getSql(), "detachConnection").mockImplementation(() => {}),
            attach: vi.spyOn(getSql(), "attachFromFile").mockImplementation(() => {}),
            open: vi.spyOn(sqlInit, "initDbConnection").mockResolvedValue(),
            announce: vi.spyOn(events, "emit").mockImplementation(() => {}),
            adopt: vi.spyOn(getBackup() as ServerBackupService, "adoptPassphrase").mockResolvedValue()
        };
    }

    it("exchanges the files, opens the restored database and leaves nothing of the old one behind", async () => {
        const db = attachedDatabase();
        fs.writeFileSync(document, "the database being replaced");
        const source = validDatabase();

        await restoreDatabase({ path: source, fileName: "backup.db", consumable: false });

        expect(fs.readFileSync(document)).toEqual(fs.readFileSync(source));
        // A backup from the backup directory is copied, never taken.
        expect(fs.existsSync(source)).toBe(true);
        expect(fs.existsSync(`${document}.pre-restore`)).toBe(false);
        expect(fs.existsSync(`${document}.restore-in-progress`)).toBe(false);

        expect(db.detach).toHaveBeenCalledBefore(db.attach);
        expect(db.attach).toHaveBeenCalledWith(document, expect.any(Boolean));
        expect(db.open).toHaveBeenCalledOnce();
        expect(db.announce).toHaveBeenCalledWith(events.DB_INITIALIZED);
        // Unlocked, so the stored password of the previous database is let go.
        expect(db.adopt).toHaveBeenCalledWith(null);
        expect(getRestoreProgress()).toMatchObject({ stage: "done", fileName: "backup.db" });

        expect(db.log()).toContain("from a backup already on this device");
        expect(db.log()).toContain("database version");
        expect(db.log()).toContain("already current");
        expect(db.log()).toMatch(/opening the restored database$/m);
        expect(db.log()).toContain("finished in");
    });

    it("migrates an older locked backup it was given, and takes on the password that opened it", async () => {
        const db = attachedDatabase();
        const source = validDatabase(undefined, OLDEST_SUPPORTED_DB_VERSION);
        const backup = await containerOf(source, "hunter2");

        await restoreDatabase({ path: backup, fileName: "old.tnbackup", consumable: true, passphrase: "hunter2" });

        expect(fs.readFileSync(document)).toEqual(fs.readFileSync(source));
        // Given to be restored, so it is spent once unwrapped.
        expect(fs.existsSync(backup)).toBe(false);
        expect(db.adopt).toHaveBeenCalledWith("hunter2");
        expect(db.log()).toContain("from a backup this instance was given");
        expect(db.log()).toContain("needs migrating");
        expect(db.log()).toContain("which is being migrated first");
    });

    it("says what an earlier, interrupted restore left behind, and replaces it", async () => {
        const db = attachedDatabase();
        fs.writeFileSync(document, "the database being replaced");
        fs.writeFileSync(`${document}.restore-in-progress`, "");
        fs.writeFileSync(`${document}.pre-restore`, "set aside by an earlier attempt");
        fs.writeFileSync(`${document}-wal`, "a log that belongs to the old database");

        await restoreDatabase({ path: validDatabase(), fileName: "backup.db", consumable: false });

        expect(db.log()).toContain("a marker from an earlier restore was still in place");
        expect(db.log()).toContain("a database set aside by an earlier restore was still there");
        expect(db.log()).toContain("the database has sidecar files");
        expect(fs.existsSync(`${document}-wal`)).toBe(false);
        expect(fs.existsSync(`${document}.pre-restore`)).toBe(false);
        expect(getRestoreProgress()).toMatchObject({ stage: "done" });
    });

    it("copies the restored database into place where a rename cannot reach it", async () => {
        const db = attachedDatabase();
        const source = validDatabase();
        const { renameSync } = fs;
        vi.spyOn(fs, "renameSync").mockImplementation((from, to) => {
            if (to === document) {
                throw Object.assign(new Error("EXDEV: cross-device link not permitted"), { code: "EXDEV" });
            }
            renameSync(from, to);
        });

        await restoreDatabase({ path: source, fileName: "backup.db", consumable: false });

        expect(fs.readFileSync(document)).toEqual(fs.readFileSync(source));
        expect(fs.existsSync(path.join(dataDir.TMP_DIR, "restore"))).toBe(false);
        expect(db.log()).toContain("the last step is a copy rather than a rename");
        expect(db.log()).toContain("copied into place in");
    });

    it("puts the previous database back when the restored one will not attach", async () => {
        const db = attachedDatabase();
        fs.writeFileSync(document, "the database it had");
        fs.writeFileSync(`${document}-shm`, "shared memory of the database it had");
        db.attach.mockImplementation(() => {
            throw new Error("SQLITE_CANTOPEN");
        });

        await expect(restoreDatabase({ path: validDatabase(), fileName: "backup.db", consumable: false }))
            .rejects.toMatchObject({ reason: "swap-failed", message: "SQLITE_CANTOPEN" });

        expect(fs.readFileSync(document, "utf-8")).toBe("the database it had");
        expect(db.attach).toHaveBeenCalledTimes(2);
        expect(db.open).not.toHaveBeenCalled();
        expect(db.log()).toContain("the database has sidecar files");
        expect(db.log()).toContain("the previous database is back in place");
        // Re-attaching failed as well; that is reported, and the reason the restore failed still stands.
        expect(db.log()).toContain("the database could not be re-opened after the failed restore: SQLITE_CANTOPEN");
        expect(getRestoreProgress()).toMatchObject({ stage: "failed", reason: "swap-failed" });
    });

    it("re-attaches to an empty slot when there was no database to put back", async () => {
        const db = attachedDatabase();
        db.attach.mockImplementationOnce(() => {
            throw new Error("SQLITE_CANTOPEN");
        });

        await expect(restoreDatabase({ path: validDatabase(), fileName: "backup.db", consumable: false }))
            .rejects.toMatchObject({ reason: "swap-failed" });

        expect(db.log()).toContain("nothing had been set aside yet, so there is nothing to put back");
        expect(db.log()).toContain("re-attached to the previous database");
    });

    it("leaves the marker for the next start when the previous database cannot be put back either", async () => {
        const db = attachedDatabase();
        fs.writeFileSync(document, "the database it had");
        const { renameSync } = fs;
        vi.spyOn(fs, "renameSync").mockImplementation((from, to) => {
            if (to === document) {
                throw Object.assign(new Error("EPERM: operation not permitted"), { code: "EPERM" });
            }
            renameSync(from, to);
        });

        await expect(restoreDatabase({ path: validDatabase(), fileName: "backup.db", consumable: false }))
            .rejects.toMatchObject({ reason: "swap-failed", message: "EPERM: operation not permitted" });

        expect(db.log()).toContain("the exchange failed, putting the previous database back");
        expect(db.log()).toContain("the previous database could not be put back, leaving it to the next start");
        // What the next start needs to undo it: the marker, and the database it set aside.
        expect(fs.existsSync(`${document}.restore-in-progress`)).toBe(true);
        expect(fs.readFileSync(`${document}.pre-restore`, "utf-8")).toBe("the database it had");
    });

    it("puts the previous database back when the restored one will not open", async () => {
        const db = attachedDatabase();
        fs.writeFileSync(document, "the database it had");
        // Not an Error: a rejection is quoted as it was given.
        db.open.mockRejectedValue("the migration could not proceed");

        await expect(restoreDatabase({ path: validDatabase(), fileName: "backup.db", consumable: false }))
            .rejects.toMatchObject({ reason: "migration-failed", message: "the migration could not proceed" });

        expect(fs.readFileSync(document, "utf-8")).toBe("the database it had");
        expect(db.announce).not.toHaveBeenCalled();
        expect(db.adopt).not.toHaveBeenCalled();
        expect(db.log()).toContain("failed at the 'migrating' step");
    });

    it("reports a wrong passphrase by the reason the container gave, so the screen can ask again", async () => {
        const db = attachedDatabase();
        const backup = await containerOf(validDatabase(), "hunter2");

        await expect(restoreDatabase({ path: backup, fileName: "b.tnbackup", consumable: false, passphrase: "wrong" }))
            .rejects.toMatchObject({ name: "RestoreFailure", reason: "wrong-passphrase-or-damaged-header" });

        expect(db.detach).not.toHaveBeenCalled();
        expect(getRestoreProgress()).toMatchObject({ stage: "failed", reason: "wrong-passphrase-or-damaged-header" });
    });

    it("refuses a backup that is not there, without guessing at whether it was locked", async () => {
        const db = attachedDatabase();

        await expect(restoreDatabase({ path: path.join(tempRoot, "gone.db"), fileName: "gone.db", consumable: false }))
            .rejects.toMatchObject({ reason: "not-a-database" });

        expect(db.log()).toContain("failed at the 'staging' step");
    });
});
