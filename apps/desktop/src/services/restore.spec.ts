import { beforeEach, describe, expect, it, vi } from "vitest";

// --- electron mock: capture the IPC handlers and drive the dialog/window from the test ---
const electronMock = vi.hoisted(() => ({
    handlers: new Map<string, (...args: unknown[]) => unknown>(),
    handle: vi.fn((channel: string, handler: (...args: unknown[]) => unknown) => electronMock.handlers.set(channel, handler)),
    showOpenDialog: vi.fn<(...args: unknown[]) => Promise<{ canceled: boolean; filePaths: string[] }>>(),
    getFocusedWindow: vi.fn<() => object | null>(() => ({}))
}));

vi.mock("electron", () => ({
    default: {
        ipcMain: { handle: electronMock.handle },
        dialog: { showOpenDialog: electronMock.showOpenDialog },
        BrowserWindow: { getFocusedWindow: electronMock.getFocusedWindow }
    }
}));

vi.mock("i18next", () => ({ t: (key: string) => key }));

vi.mock("@triliumnext/core", () => ({
    getLog: () => ({ info: vi.fn(), error: vi.fn() }),
    utils: {
        safeExtractMessageAndStackFromError: (e: unknown) => String(e),
        // Used by the restore log to take the filesystem out of what it quotes back.
        replaceAll: (text: string, from: string, to: string) => text.split(from).join(to)
    }
}));

const sessionMock = vi.hoisted(() => ({
    setPendingBackup: vi.fn<(path: string, fileName: string, options: { consumable: boolean }) => unknown>()
}));
vi.mock("@triliumnext/server/src/services/restore_session.js", () => sessionMock);

import { setupRestoreHandlers } from "./restore.js";

/** Resolves the open-dialog mock to a user selection, or to a cancel when given nothing. */
function dialogReturns(filePath?: string) {
    electronMock.showOpenDialog.mockResolvedValue(
        filePath ? { canceled: false, filePaths: [ filePath ] } : { canceled: true, filePaths: [] }
    );
}

function pickBackup() {
    const handler = electronMock.handlers.get("restore-pick-backup");
    if (!handler) {
        throw new Error("the restore-pick-backup handler was never registered");
    }

    return handler() as Promise<{ status: string; fileName?: string; encrypted?: boolean; message?: string }>;
}

beforeEach(() => {
    vi.clearAllMocks();
    electronMock.handlers.clear();
    electronMock.getFocusedWindow.mockReturnValue({});
    sessionMock.setPendingBackup.mockReturnValue({ fileName: "backup-daily.db", encrypted: false });
    setupRestoreHandlers();
});

describe("choosing a backup to restore", () => {
    it("puts the chosen file forward, and answers with what it is rather than where it is", async () => {
        dialogReturns("/home/adorian/backups/backup-daily.db");

        const picked = await pickBackup();

        expect(sessionMock.setPendingBackup).toHaveBeenCalledWith(
            "/home/adorian/backups/backup-daily.db",
            "backup-daily.db",
            // Never consumable: it is the user's own file, not something uploaded to be consumed.
            { consumable: false }
        );
        expect(picked).toEqual({ status: "selected", fileName: "backup-daily.db", encrypted: false });
        // The path is the thing the renderer must never see, whatever else it is told.
        expect(JSON.stringify(picked)).not.toContain("/home/adorian");
    });

    it("passes on that a passphrase will be needed, which the header states in the clear", async () => {
        dialogReturns("/home/adorian/backups/backup-weekly.tnbackup");
        sessionMock.setPendingBackup.mockReturnValue({ fileName: "backup-weekly.tnbackup", encrypted: true });

        await expect(pickBackup()).resolves.toEqual({
            status: "selected", fileName: "backup-weekly.tnbackup", encrypted: true
        });
    });

    it("puts nothing forward when the dialog is dismissed", async () => {
        dialogReturns();

        await expect(pickBackup()).resolves.toEqual({ status: "cancelled" });
        expect(sessionMock.setPendingBackup).not.toHaveBeenCalled();
    });

    it("cannot open a dialog with no window to open it over", async () => {
        electronMock.getFocusedWindow.mockReturnValue(null);

        await expect(pickBackup()).resolves.toEqual({ status: "cancelled" });
        expect(electronMock.showOpenDialog).not.toHaveBeenCalled();
    });

    it("reports a refusal rather than throwing across the bridge", async () => {
        dialogReturns("/home/adorian/backups/backup-daily.db");
        sessionMock.setPendingBackup.mockImplementation(() => {
            throw new Error("Cannot start 'restore-backup': setup is already busy with 'new-document'.");
        });

        await expect(pickBackup()).resolves.toEqual({
            status: "error",
            message: "Cannot start 'restore-backup': setup is already busy with 'new-document'."
        });
    });

    it("offers the backup extensions first, and everything else after them", async () => {
        dialogReturns("/home/adorian/backups/backup-daily.db");

        await pickBackup();

        const [ , options ] = electronMock.showOpenDialog.mock.calls[0] as [ unknown, { properties: string[]; filters: { extensions: string[] }[] } ];
        expect(options.properties).toEqual([ "openFile" ]);
        expect(options.filters.map((filter) => filter.extensions)).toEqual([ [ "db", "tnbackup" ], [ "*" ] ]);
    });
});
