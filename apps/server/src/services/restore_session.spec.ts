import { writeBackupContainer } from "@triliumnext/backup-container";
import { getLog, getRunningSetupOperation, holdSetup } from "@triliumnext/core";
import type { Request } from "express";
import fs from "fs";
import path from "path";
import { Readable, Writable } from "stream";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";

// Uploads and pending backups land in a temporary directory rather than the shared test data one.
vi.mock("./data_dir.js", async (importOriginal) => {
    const original = await importOriginal<typeof import("./data_dir.js")>();
    const { mkdtempSync } = await import("fs");
    const { tmpdir } = await import("os");
    const { join } = await import("path");

    return {
        ...original,
        default: { ...original.default, TMP_DIR: mkdtempSync(join(tmpdir(), "trilium-restore-session-spec-")) }
    };
});

// The restore itself is covered in its own spec; here it only has to succeed or fail on cue.
vi.mock("./database_restore.js", async (importOriginal) => {
    const original = await importOriginal<typeof import("./database_restore.js")>();

    return {
        ...original,
        restoreDatabase: vi.fn(async () => {}),
        reportRestoreFailure: vi.fn(original.reportRestoreFailure)
    };
});

import dataDir from "./data_dir.js";
import { getRestoreProgress, reportRestoreFailure, restoreDatabase, RestoreFailure } from "./database_restore.js";
import {
    backupUpload,
    beginBackupUpload,
    beginRestore,
    discardPendingBackup,
    getPendingBackup,
    pendingRestoreRequest,
    setPendingBackup
} from "./restore_session.js";

const UPLOAD_DIR = path.join(dataDir.TMP_DIR, "uploads");
const PENDING_UPLOAD_PATH = path.join(UPLOAD_DIR, "pending-backup");
const SQLITE_HEADER = "SQLite format 3\0";

/** Captured before the fake timers replace it, so a test can let a restore it started run to its end. */
const realSetImmediate = setImmediate;
function settle() {
    return new Promise<void>((resolve) => realSetImmediate(resolve));
}

/** An encrypted container, written once on real timers, since the specs below run on fake ones. */
let encryptedContainer = Buffer.alloc(0);

beforeAll(async () => {
    const chunks: Buffer[] = [];
    const sink = new Writable({
        write(chunk: Buffer, _encoding, callback) {
            chunks.push(Buffer.from(chunk));
            callback();
        }
    });
    await writeBackupContainer(Readable.from([ Buffer.from(SQLITE_HEADER) ]), sink, {
        compress: false,
        passphrase: "hunter2"
    });
    encryptedContainer = Buffer.concat(chunks);
});

afterAll(() => fs.rmSync(dataDir.TMP_DIR, { recursive: true, force: true }));

function beginRequest(totalBytes: number, fileName = "backup.db") {
    return { body: { fileName, totalBytes } } as unknown as Request;
}

function chunkRequest(uploadId: string, offset: number, body: Buffer) {
    return Object.assign(Readable.from([ body ]), {
        params: { uploadId },
        query: { offset: String(offset) }
    }) as unknown as Request;
}

/** A file standing in for one of the user's own backups, which a restore may never consume. */
function localBackup(name = "backup-daily.db") {
    const filePath = path.join(UPLOAD_DIR, name);
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
    fs.writeFileSync(filePath, "SQLite format 3\0");

    return filePath;
}

beforeEach(() => {
    vi.useFakeTimers();
    discardPendingBackup();
});

afterEach(async () => {
    // The upload is a singleton across the file, so an open session outlives the test that opened
    // it. Age it past its own expiry and sweep, which is the only way in from outside.
    vi.advanceTimersByTime(2 * 60 * 60 * 1000);
    await backupUpload.sweep();
    discardPendingBackup();

    vi.useRealTimers();
    fs.rmSync(UPLOAD_DIR, { recursive: true, force: true });
});

describe("reserving setup for a backup that is coming", () => {
    it("reserves setup before the first byte, so nothing else can build a document meanwhile", async () => {
        expect(getRunningSetupOperation()).toBe(null);

        await beginBackupUpload(beginRequest(8));

        expect(getRunningSetupOperation()).toBe("restore-backup");
    });

    it("gives setup back when the upload expires, which nothing else would put right", async () => {
        const { uploadId } = await beginBackupUpload(beginRequest(8));
        await backupUpload.chunk(chunkRequest(uploadId, 0, Buffer.alloc(4)));

        // An hour later, with the user long gone.
        vi.advanceTimersByTime(61 * 60 * 1000);
        await backupUpload.sweep();

        expect(getRunningSetupOperation()).toBe(null);
    });

    it("gives setup back when the upload contradicts the size it declared", async () => {
        const { uploadId } = await beginBackupUpload(beginRequest(4));

        await expect(backupUpload.chunk(chunkRequest(uploadId, 0, Buffer.alloc(8)))).rejects.toThrow();

        expect(getRunningSetupOperation()).toBe(null);
    });

    it("keeps the reservation when a second upload takes the place of the first", async () => {
        const replaced = await beginBackupUpload(beginRequest(8));

        // The newest attempt wins, since a user who is being refused because of an upload of their
        // own that is already lost has nothing else they can do on this screen.
        const { uploadId } = await beginBackupUpload(beginRequest(8));

        // The reservation the replaced upload was standing on must not go with it: it is the same
        // reservation the one replacing it now stands on.
        expect(getRunningSetupOperation()).toBe("restore-backup");
        await expect(backupUpload.chunk(chunkRequest(replaced.uploadId, 0, Buffer.alloc(4)))).rejects.toThrow(/took over/);
        await expect(backupUpload.chunk(chunkRequest(uploadId, 0, Buffer.alloc(4)))).resolves.toBeTruthy();
    });

    it("keeps the reservation the new upload took when opening it sweeps away an old one", async () => {
        const abandoned = await beginBackupUpload(beginRequest(8));
        await backupUpload.chunk(chunkRequest(abandoned.uploadId, 0, Buffer.alloc(4)));

        // The abandoned one ages out. Opening the next upload sweeps it, and that sweep reports a
        // discarded session — after the replacement has already reserved setup for itself.
        vi.advanceTimersByTime(61 * 60 * 1000);
        await beginBackupUpload(beginRequest(8));

        expect(getRunningSetupOperation()).toBe("restore-backup");
    });

    it("keeps the reservation for an upload in flight when the backup that was waiting is dropped", async () => {
        setPendingBackup(localBackup(), "backup-daily.db", { consumable: false });
        const { uploadId } = await beginBackupUpload(beginRequest(8));

        // The backup that was waiting expires while the one replacing it is still arriving.
        discardPendingBackup();

        expect(getRunningSetupOperation()).toBe("restore-backup");
        await expect(backupUpload.chunk(chunkRequest(uploadId, 0, Buffer.alloc(4)))).resolves.toBeTruthy();
    });

    it("keeps setup reserved once a backup is actually waiting to be restored", async () => {
        setPendingBackup(localBackup(), "backup-daily.db", { consumable: false });

        expect(getPendingBackup()).toEqual({ fileName: "backup-daily.db", encrypted: false });
        expect(getRunningSetupOperation()).toBe("restore-backup");
    });
});

describe("a backup nobody comes back for", () => {
    it("gives setup back after it has waited long enough, and leaves the user's own file alone", () => {
        const filePath = localBackup();
        setPendingBackup(filePath, "backup-daily.db", { consumable: false });

        vi.advanceTimersByTime(61 * 60 * 1000);

        expect(getPendingBackup()).toBe(null);
        expect(getRunningSetupOperation()).toBe(null);
        // Never consumable: it is the user's file, not something uploaded to be spent.
        expect(fs.existsSync(filePath)).toBe(true);
    });

    it("deletes an uploaded one, which existed for nothing else", () => {
        const filePath = localBackup("pending-backup");
        setPendingBackup(filePath, "backup.db", { consumable: true });

        vi.advanceTimersByTime(61 * 60 * 1000);

        expect(fs.existsSync(filePath)).toBe(false);
    });

    it("starts its wait over each time a new backup takes its place", () => {
        setPendingBackup(localBackup("first.db"), "first.db", { consumable: false });
        vi.advanceTimersByTime(50 * 60 * 1000);

        setPendingBackup(localBackup("second.db"), "second.db", { consumable: false });
        vi.advanceTimersByTime(50 * 60 * 1000);

        // The first one's hour has passed, but the second one's has not.
        expect(getPendingBackup()).toMatchObject({ fileName: "second.db" });
    });

    it("hands the restore what it needs, and forgets it once discarded", () => {
        const filePath = localBackup();
        setPendingBackup(filePath, "backup-daily.db", { consumable: false });

        expect(pendingRestoreRequest()).toEqual({
            path: filePath, fileName: "backup-daily.db", consumable: false
        });

        discardPendingBackup();

        expect(pendingRestoreRequest()).toBe(null);
        expect(getRunningSetupOperation()).toBe(null);
    });
});

describe("an upload that arrives whole", () => {
    it("becomes the backup waiting to be restored, which the restore may spend", async () => {
        const { uploadId } = await beginBackupUpload(beginRequest(16, "nightly.db"));
        await backupUpload.chunk(chunkRequest(uploadId, 0, Buffer.from(SQLITE_HEADER)));

        await expect(backupUpload.finish({ params: { uploadId } } as unknown as Request))
            .resolves.toEqual({ fileName: "nightly.db", encrypted: false });

        // Moved out of the upload's own directory, which keeps nothing once the upload is over.
        expect(fs.readFileSync(PENDING_UPLOAD_PATH, "utf-8")).toBe(SQLITE_HEADER);
        expect(fs.readdirSync(path.join(UPLOAD_DIR, "restore"))).toEqual([]);
        expect(pendingRestoreRequest()).toEqual({
            path: PENDING_UPLOAD_PATH, fileName: "nightly.db", consumable: true
        });
        expect(getRunningSetupOperation()).toBe("restore-backup");
    });

    it("says when the backup waiting needs a passphrase, reading it from the file's own header", () => {
        const info = vi.spyOn(getLog(), "info").mockImplementation(() => {});
        const filePath = localBackup("locked.tnbackup");
        fs.writeFileSync(filePath, encryptedContainer);

        expect(setPendingBackup(filePath, "locked.tnbackup", { consumable: false }))
            .toEqual({ fileName: "locked.tnbackup", encrypted: true });
        expect(info).toHaveBeenCalledWith(expect.stringMatching(/is waiting to be restored, and needs a passphrase$/));
        info.mockRestore();
    });

    it("takes a file it cannot read for an unlocked one, leaving the restore to find out what it is", () => {
        expect(setPendingBackup(path.join(UPLOAD_DIR, "not-there.db"), "not-there.db", { consumable: false }))
            .toEqual({ fileName: "not-there.db", encrypted: false });
    });
});

describe("an upload refused before it starts", () => {
    it("says why in the log, and gives setup back", async () => {
        const error = vi.spyOn(getLog(), "error").mockImplementation(() => {});

        await expect(beginBackupUpload(beginRequest(0))).rejects.toThrow(/positive integer/);
        expect(error).toHaveBeenCalledWith(expect.stringMatching(
            /^Backup restore: an upload was refused before it started: The size of the upload must be stated/
        ));
        expect(getRunningSetupOperation()).toBe(null);

        // A refusal that is not an Error is quoted as it was thrown.
        vi.spyOn(backupUpload, "begin").mockRejectedValueOnce("too many uploads");
        await expect(beginBackupUpload(beginRequest(8))).rejects.toBe("too many uploads");
        expect(error).toHaveBeenLastCalledWith(
            "Backup restore: an upload was refused before it started: too many uploads"
        );
        expect(getRunningSetupOperation()).toBe(null);
        vi.restoreAllMocks();
    });
});

describe("running the restore", () => {
    afterEach(() => {
        vi.mocked(restoreDatabase).mockReset().mockResolvedValue();
        vi.mocked(reportRestoreFailure).mockClear();
    });

    function pendingUpload() {
        const filePath = localBackup("pending-backup");
        setPendingBackup(filePath, "backup.db", { consumable: true });

        return filePath;
    }

    it("drops the backup it restored, and gives setup back", async () => {
        const filePath = pendingUpload();
        const request = { path: filePath, fileName: "backup.db", consumable: true, passphrase: "pw" };

        beginRestore(request);
        await settle();

        expect(restoreDatabase).toHaveBeenCalledWith(request);
        expect(getPendingBackup()).toBe(null);
        expect(fs.existsSync(filePath)).toBe(false);
        expect(getRunningSetupOperation()).toBe(null);
        expect(reportRestoreFailure).not.toHaveBeenCalled();
    });

    it("keeps the backup for another passphrase, and starts its wait over", async () => {
        const filePath = pendingUpload();
        vi.advanceTimersByTime(50 * 60 * 1000);
        vi.mocked(restoreDatabase).mockRejectedValue(
            new RestoreFailure("wrong-passphrase-or-damaged-header", "The passphrase is wrong."));

        beginRestore({ path: filePath, fileName: "backup.db", consumable: true, passphrase: "wrong" });
        await settle();

        // The restore recorded its own failure, so it is not reported a second time.
        expect(reportRestoreFailure).not.toHaveBeenCalled();
        expect(getPendingBackup()).toEqual({ fileName: "backup.db", encrypted: false });
        expect(fs.existsSync(filePath)).toBe(true);
        expect(getRunningSetupOperation()).toBe("restore-backup");

        // Past the hour the backup first waited, but not past the one that began with the failure.
        vi.advanceTimersByTime(50 * 60 * 1000);
        expect(getPendingBackup()).not.toBe(null);

        vi.advanceTimersByTime(11 * 60 * 1000);
        expect(getPendingBackup()).toBe(null);
        expect(fs.existsSync(filePath)).toBe(false);
    });

    it("drops the backup when no passphrase could get past what went wrong", async () => {
        const filePath = pendingUpload();
        vi.mocked(restoreDatabase).mockRejectedValue(new RestoreFailure("not-a-database", "Not a database."));

        beginRestore({ path: filePath, fileName: "backup.db", consumable: true });
        await settle();

        expect(getPendingBackup()).toBe(null);
        expect(fs.existsSync(filePath)).toBe(false);
        expect(getRunningSetupOperation()).toBe(null);
        expect(reportRestoreFailure).not.toHaveBeenCalled();
    });

    it("drops the backup and records a failure the restore could not record itself", async () => {
        pendingUpload();
        const failure = new Error("the disk went away");
        vi.mocked(restoreDatabase).mockRejectedValue(failure);

        beginRestore({ path: PENDING_UPLOAD_PATH, fileName: "backup.db", consumable: true });
        await settle();

        expect(getPendingBackup()).toBe(null);
        expect(reportRestoreFailure).toHaveBeenCalledWith("backup.db", failure);
        expect(getRestoreProgress()).toMatchObject({
            stage: "failed", reason: "restore-refused", error: "the disk went away"
        });
    });

    it("records a restore setup refused to start, so a client polling for it is not left waiting", async () => {
        const release = holdSetup("new-document");
        try {
            beginRestore({ path: localBackup(), fileName: "backup-daily.db", consumable: false });
            await settle();
        } finally {
            release();
        }

        expect(restoreDatabase).not.toHaveBeenCalled();
        expect(getRestoreProgress()).toEqual({
            stage: "failed",
            fileName: "backup-daily.db",
            error: "Cannot start 'restore-backup': setup is already busy with 'new-document'.",
            reason: "restore-refused"
        });
    });
});
