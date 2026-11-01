import { getRunningSetupOperation } from "@triliumnext/core";
import type { Request } from "express";
import fs from "fs";
import path from "path";
import { Readable } from "stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import dataDir from "./data_dir.js";
import {
    backupUpload,
    beginBackupUpload,
    discardPendingBackup,
    getPendingBackup,
    pendingRestoreRequest,
    setPendingBackup
} from "./restore_session.js";

const UPLOAD_DIR = path.join(dataDir.TMP_DIR, "uploads");

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
