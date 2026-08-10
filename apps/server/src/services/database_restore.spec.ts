import { writeBackupContainer } from "@triliumnext/backup-container";
import { app_info as appInfo, getLog, getSql } from "@triliumnext/core";
import Database from "better-sqlite3";
import fs from "fs";
import fsp from "fs/promises";
import os from "os";
import path from "path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import dataDir from "./data_dir.js";
import {
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
    stageBackup
} from "./database_restore.js";

const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "trilium-restore-spec-"));
let counter = 0;

beforeEach(() => {
    fs.rmSync(tempRoot, { recursive: true, force: true });
    fs.mkdirSync(tempRoot, { recursive: true });
});

afterEach(() => vi.restoreAllMocks());

/** A database that would pass validation, so a test can tell a rejected file from a rejected step. */
function validDatabase(name = `db-${counter++}.db`) {
    const filePath = path.join(tempRoot, name);
    const db = new Database(filePath);
    try {
        for (const table of [ "options", "notes", "branches", "blobs" ]) {
            db.exec(`CREATE TABLE ${table} (name TEXT, value TEXT)`);
        }
        const insert = db.prepare("INSERT INTO options (name, value) VALUES (?, ?)");
        insert.run("initialized", "true");
        insert.run("dbVersion", String(appInfo.dbVersion));
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
        plaintextSize: fs.statSync(source).size,
        patchHeader: async (offset, data) => {
            const handle = await fsp.open(filePath, "r+");
            try {
                await handle.write(data, 0, data.length, offset);
            } finally {
                await handle.close();
            }
        }
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
