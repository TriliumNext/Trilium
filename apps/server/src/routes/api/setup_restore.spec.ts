import { getBackup, NotFoundError, ValidationError } from "@triliumnext/core";
import type { Request } from "express";
import path from "path";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../services/restore_session.js", () => ({
    backupUpload: {
        chunk: vi.fn(async () => ({ chunked: true })),
        status: vi.fn(async () => ({ receivedBytes: 4 })),
        finish: vi.fn(async () => ({ fileName: "backup.db", encrypted: false })),
        abort: vi.fn(async () => {}),
        stop: vi.fn()
    },
    beginBackupUpload: vi.fn(async () => ({ uploadId: "upload-1" })),
    beginRestore: vi.fn(),
    discardPendingBackup: vi.fn(),
    pendingRestoreRequest: vi.fn(() => null)
}));

vi.mock("../../services/database_restore.js", () => ({
    getRestoreProgress: vi.fn(() => ({ stage: "validating", fileName: "backup.db" }))
}));

import type ServerBackupService from "../../backup_provider.js";
import { getRestoreProgress } from "../../services/database_restore.js";
import {
    backupUpload,
    beginBackupUpload,
    beginRestore,
    discardPendingBackup,
    pendingRestoreRequest
} from "../../services/restore_session.js";
import setupRestore from "./setup_restore.js";

function request(body?: unknown) {
    return { body, params: { uploadId: "upload-1" } } as unknown as Request;
}

afterEach(() => vi.clearAllMocks());

describe("receiving a backup through the setup screen", () => {
    it("passes each step of the upload to the restore session", async () => {
        const req = request();

        expect(await setupRestore.beginUpload(req)).toEqual({ uploadId: "upload-1" });
        expect(beginBackupUpload).toHaveBeenCalledWith(req);

        expect(await setupRestore.uploadChunk(req)).toEqual({ chunked: true });
        expect(backupUpload.chunk).toHaveBeenCalledWith(req);

        expect(await setupRestore.uploadStatus(req)).toEqual({ receivedBytes: 4 });
        expect(backupUpload.status).toHaveBeenCalledWith(req);

        expect(await setupRestore.finishUpload(req)).toEqual({ fileName: "backup.db", encrypted: false });
        expect(backupUpload.finish).toHaveBeenCalledWith(req);

        setupRestore.stop();
        expect(backupUpload.stop).toHaveBeenCalled();
    });

    it("drops the backup that was waiting along with an aborted upload", async () => {
        const req = request();

        await expect(setupRestore.abortUpload(req)).resolves.toBeUndefined();

        expect(backupUpload.abort).toHaveBeenCalledWith(req);
        expect(discardPendingBackup).toHaveBeenCalled();
    });

    it("reports the progress of the running restore", () => {
        expect(setupRestore.status()).toEqual({ restore: { stage: "validating", fileName: "backup.db" } });
        expect(getRestoreProgress).toHaveBeenCalled();
    });
});

describe("starting a restore", () => {
    it("restores the pending backup with the passphrase the user typed", () => {
        vi.mocked(pendingRestoreRequest).mockReturnValue({
            path: "/tmp/pending-backup", fileName: "backup.tnbackup", consumable: true
        });

        expect(setupRestore.start(request({ source: "pending", passphrase: "hunter2" }))).toEqual({ started: true });
        expect(beginRestore).toHaveBeenCalledWith({
            path: "/tmp/pending-backup", fileName: "backup.tnbackup", consumable: true, passphrase: "hunter2"
        });

        // A request with no body at all asks for the pending backup too.
        setupRestore.start(request(undefined));
        expect(beginRestore).toHaveBeenLastCalledWith({
            path: "/tmp/pending-backup", fileName: "backup.tnbackup", consumable: true, passphrase: undefined
        });
    });

    it("refuses when no backup is waiting to be restored", () => {
        vi.mocked(pendingRestoreRequest).mockReturnValue(null);

        expect(() => setupRestore.start(request({ source: "pending" })))
            .toThrow(new NotFoundError("No backup is waiting to be restored."));
        expect(beginRestore).not.toHaveBeenCalled();
    });

    it("restores a backup from the listing only once the backup service has resolved its path", () => {
        const backup = getBackup() as ServerBackupService;
        const resolvedPath = path.resolve("backups", "backup-daily.db");
        const resolve = vi.spyOn(backup, "resolveBackupPath").mockReturnValue(resolvedPath);

        setupRestore.start(request({ source: "existing", filePath: "backup-daily.db", passphrase: "pw" }));

        expect(resolve).toHaveBeenCalledWith("backup-daily.db");
        // Never consumable: it is one of the user's own backups and has to survive the restore.
        expect(beginRestore).toHaveBeenCalledWith({
            path: resolvedPath, fileName: "backup-daily.db", consumable: false, passphrase: "pw"
        });
        resolve.mockRestore();
    });

    it("refuses a backup from the listing that is unnamed or outside the backup directories", () => {
        const backup = getBackup() as ServerBackupService;
        const resolve = vi.spyOn(backup, "resolveBackupPath").mockReturnValue(null);

        expect(() => setupRestore.start(request({ source: "existing" })))
            .toThrow(new ValidationError("No backup was named."));
        expect(() => setupRestore.start(request({ source: "existing", filePath: "../../etc/passwd" })))
            .toThrow(new NotFoundError("No such backup."));

        expect(resolve).toHaveBeenCalledTimes(1);
        expect(beginRestore).not.toHaveBeenCalled();
        resolve.mockRestore();
    });
});
