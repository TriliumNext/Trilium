import type fs from "fs";
import { beforeEach, describe, expect, it, vi } from "vitest";

const h = vi.hoisted(() => ({
    fileStore: new Map<string, Buffer>(),
    handlers: new Map<string, (event: unknown, ...args: unknown[]) => unknown>(),
    showMessageBox: vi.fn(async (_options: Record<string, unknown>) => ({ response: 1 })),
    isReady: true,
    encryptionAvailable: true,
    storageBackend: "gnome_libsecret",
    platform: "linux",
    // Base64 rather than a readable prefix, so "never stored in the clear" is a real assertion.
    encrypt: vi.fn(async (plainText: string) =>
        Buffer.from(Buffer.from(plainText, "utf8").toString("base64"), "utf8")),
    decrypt: vi.fn(async (buffer: Buffer) => ({
        result: Buffer.from(buffer.toString("utf8"), "base64").toString("utf8"),
        shouldReEncrypt: false
    })),
    errors: [] as string[]
}));

// In-memory shim for the passphrase file only, so the developer's real data directory is untouched.
const isPassphrasePath = (p: unknown) => String(p).includes("backup-passphrase.bin");
vi.mock("fs", async (importOriginal) => {
    const actual = await importOriginal<typeof import("fs") & { default?: typeof import("fs") }>();
    const real = actual.default ?? actual;
    const existsSync = (p: fs.PathLike) =>
        (isPassphrasePath(p) ? h.fileStore.has(String(p)) : real.existsSync(p));
    const readFileSync = ((p: fs.PathLike, enc?: unknown) =>
        isPassphrasePath(p)
            ? h.fileStore.get(String(p))
            : real.readFileSync(p, enc as never)) as typeof real.readFileSync;
    const writeFileSync = ((p: fs.PathLike, data: Buffer) => {
        h.fileStore.set(String(p), Buffer.from(data));
    }) as typeof real.writeFileSync;
    const renameSync = ((from: fs.PathLike, to: fs.PathLike) => {
        const data = h.fileStore.get(String(from));
        if (data) {
            h.fileStore.set(String(to), data);
            h.fileStore.delete(String(from));
        }
    }) as typeof real.renameSync;
    const rmSync = ((p: fs.PathLike) => {
        h.fileStore.delete(String(p));
    }) as typeof real.rmSync;
    const patched = { ...real, existsSync, readFileSync, writeFileSync, renameSync, rmSync };
    return {
        ...actual,
        default: patched,
        existsSync,
        readFileSync,
        writeFileSync,
        renameSync,
        rmSync
    };
});

vi.mock("i18next", () => ({ t: (key: string) => key }));

vi.mock("electron", () => ({
    default: {
        app: { isReady: () => h.isReady },
        dialog: { showMessageBox: h.showMessageBox },
        safeStorage: {
            isEncryptionAvailable: () => h.encryptionAvailable,
            getSelectedStorageBackend: () => h.storageBackend,
            encryptStringAsync: (plainText: string) => h.encrypt(plainText),
            decryptStringAsync: (buffer: Buffer) => h.decrypt(buffer)
        },
        ipcMain: {
            handle(channel: string, handler: (event: unknown, ...args: unknown[]) => unknown) {
                h.handlers.set(channel, handler);
            }
        }
    }
}));

vi.mock("@triliumnext/core", () => ({
    getLog: () => ({ error: (message: string) => h.errors.push(message) })
}));

type ConfirmCase = [string, [string, ...unknown[]]];

const passphrase = await import("./backup_passphrase.js");

describe("backup passphrase storage", () => {
    beforeEach(() => {
        h.fileStore.clear();
        h.errors.length = 0;
        h.isReady = true;
        h.encryptionAvailable = true;
        h.storageBackend = "gnome_libsecret";
        Object.defineProperty(process, "platform", { value: h.platform, configurable: true });
        h.decrypt.mockClear();
        h.encrypt.mockClear();
    });

    it("stores a passphrase encrypted, and never in the clear", async () => {
        expect(await passphrase.storeBackupPassphrase("hunter2")).toBe(true);

        const stored = [ ...h.fileStore.values() ];
        expect(stored).toHaveLength(1);
        expect(stored[0].toString()).not.toContain("hunter2");
        expect(h.encrypt).toHaveBeenCalledWith("hunter2");
        expect(await passphrase.getBackupPassphrase()).toBe("hunter2");
    });

    it("replaces an existing passphrase rather than accumulating files", async () => {
        await passphrase.storeBackupPassphrase("first");
        await passphrase.storeBackupPassphrase("second");

        expect(h.fileStore.size).toBe(1);
        expect(await passphrase.getBackupPassphrase()).toBe("second");
    });

    it("reports status without disclosing anything", () => {
        expect(passphrase.getBackupPassphraseStatus()).toEqual({ available: true, set: false });
    });

    it("forgets the passphrase on clear", async () => {
        await passphrase.storeBackupPassphrase("hunter2");
        passphrase.clearBackupPassphrase();

        expect(passphrase.isPassphraseSet()).toBe(false);
        expect(await passphrase.getBackupPassphrase()).toBeNull();
    });

    it("rewrites the file when the OS says its key rotated", async () => {
        await passphrase.storeBackupPassphrase("hunter2");
        h.decrypt.mockResolvedValueOnce({ result: "hunter2", shouldReEncrypt: true });
        h.encrypt.mockClear();

        expect(await passphrase.getBackupPassphrase()).toBe("hunter2");
        expect(h.encrypt).toHaveBeenCalledWith("hunter2");
    });

    it("returns null and logs, without the passphrase, when the blob will not open", async () => {
        await passphrase.storeBackupPassphrase("hunter2");
        h.decrypt.mockRejectedValueOnce(new Error("keyring is locked"));

        expect(await passphrase.getBackupPassphrase()).toBeNull();
        expect(h.errors.join()).toContain("keyring is locked");
        expect(h.errors.join()).not.toContain("hunter2");
    });

    it("takes on a restored backup's password, and drops the old one when it brings none", async () => {
        // The passphrase is not in the database, so a restore replaces every option saying how this
        // instance backs up and leaves the password those options are carried out with. Kept, the
        // instance encrypts with a password belonging to a database that is no longer here.
        await passphrase.storeBackupPassphrase("the previous database's");

        await passphrase.adoptBackupPassphrase("the restored database's");
        expect(await passphrase.getBackupPassphrase()).toBe("the restored database's");

        await passphrase.adoptBackupPassphrase(null);
        expect(await passphrase.getBackupPassphrase()).toBeNull();
    });
});

describe("keyring availability", () => {
    beforeEach(() => {
        h.fileStore.clear();
        h.isReady = true;
        h.encryptionAvailable = true;
        h.storageBackend = "gnome_libsecret";
        Object.defineProperty(process, "platform", { value: "linux", configurable: true });
    });

    it.each([
        [ "the app is not ready yet", () => { h.isReady = false; } ],
        [ "the platform offers no encryption", () => { h.encryptionAvailable = false; } ],
        [
            "Linux falls back to the hardcoded-password backend",
            () => { h.storageBackend = "basic_text"; }
        ]
    ])("treats the keyring as unavailable when %s", async (_label, arrange) => {
        arrange();

        expect(passphrase.isKeyringAvailable()).toBe(false);
        expect(await passphrase.storeBackupPassphrase("hunter2")).toBe(false);
        expect(h.fileStore.size).toBe(0);
    });

    it("ignores the backend name away from Linux, where it is not reported", () => {
        Object.defineProperty(process, "platform", { value: "win32", configurable: true });
        h.storageBackend = "basic_text";

        expect(passphrase.isKeyringAvailable()).toBe(true);
    });

    it("refuses an empty passphrase", async () => {
        expect(await passphrase.storeBackupPassphrase("")).toBe(false);
        expect(h.fileStore.size).toBe(0);
    });

    it("cannot read a stored passphrase once the keyring goes away", async () => {
        await passphrase.storeBackupPassphrase("hunter2");
        h.encryptionAvailable = false;

        expect(await passphrase.getBackupPassphrase()).toBeNull();
    });
});

describe("IPC handlers", () => {
    const invoke = (channel: string, ...args: unknown[]) => h.handlers.get(channel)?.({}, ...args);

    beforeEach(() => {
        h.fileStore.clear();
        h.handlers.clear();
        h.isReady = true;
        h.encryptionAvailable = true;
        h.storageBackend = "gnome_libsecret";
        h.showMessageBox.mockClear();
        h.showMessageBox.mockResolvedValue({ response: 1 });
        passphrase.registerBackupPassphraseIpcHandlers();
    });

    it("registers status, set and clear, and nothing that reads the passphrase back", () => {
        expect([ ...h.handlers.keys() ].sort()).toEqual([
            "backup-passphrase-clear",
            "backup-passphrase-set",
            "backup-passphrase-status"
        ]);
    });

    it("drives the whole lifecycle over IPC", async () => {
        expect(await invoke("backup-passphrase-status")).toEqual({ available: true, set: false });
        expect(await invoke("backup-passphrase-set", "hunter2")).toBe("applied");
        expect(await invoke("backup-passphrase-status")).toEqual({ available: true, set: true });

        expect(await invoke("backup-passphrase-clear")).toBe("applied");
        expect(await invoke("backup-passphrase-status")).toEqual({ available: true, set: false });
    });

    it.each([
        [ "set", [ "backup-passphrase-set", "hunter2" ] ],
        [ "clear", [ "backup-passphrase-clear" ] ]
    ] as ConfirmCase[])("asks the OS before it %ss, with no escape from asking", async (
        _label,
        call
    ) => {
        await invoke(...call);

        expect(h.showMessageBox).toHaveBeenCalledOnce();
        const options = h.showMessageBox.mock.calls[0][0];
        expect(options).toMatchObject({ type: "warning", cancelId: 0 });
        // The security settings offer "don't ask again"; skipping the question is the vulnerability
        // here.
        expect(options).not.toHaveProperty("checkboxLabel");
    });

    it("stores nothing when the confirmation is declined", async () => {
        h.showMessageBox.mockResolvedValue({ response: 0 });

        expect(await invoke("backup-passphrase-set", "hunter2")).toBe("cancelled");
        expect(h.fileStore.size).toBe(0);
    });

    it("keeps the stored passphrase when a clear is declined", async () => {
        await invoke("backup-passphrase-set", "hunter2");
        h.showMessageBox.mockResolvedValue({ response: 0 });

        expect(await invoke("backup-passphrase-clear")).toBe("cancelled");
        expect(await invoke("backup-passphrase-status")).toEqual({ available: true, set: true });
    });

    it("does not ask about something it could not do anyway", async () => {
        h.encryptionAvailable = false;

        expect(await invoke("backup-passphrase-set", "hunter2")).toBe("unavailable");
        expect(await invoke("backup-passphrase-set", "")).toBe("unavailable");
        expect(h.showMessageBox).not.toHaveBeenCalled();
    });

    it("never asks when the OS rotates its key under a backup, which runs unattended", async () => {
        await invoke("backup-passphrase-set", "hunter2");
        h.showMessageBox.mockClear();
        h.decrypt.mockResolvedValueOnce({ result: "hunter2", shouldReEncrypt: true });

        expect(await passphrase.getBackupPassphrase()).toBe("hunter2");
        expect(h.showMessageBox).not.toHaveBeenCalled();
    });
});
