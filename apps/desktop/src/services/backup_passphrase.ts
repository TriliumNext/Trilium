import type { BackupPassphraseChange, BackupPassphraseStatus } from "@triliumnext/commons";
import { getLog } from "@triliumnext/core";
import dataDirs from "@triliumnext/server/src/services/data_dir.js";
import electron from "electron";
import fs from "fs";
import { t } from "i18next";
import path from "path";

/**
 * The passphrase lives outside the database on purpose: the database is what a backup wraps, so a
 * passphrase kept there would travel inside the very container it protects, and would sync to every
 * other instance besides.
 */
const PASSPHRASE_PATH = path.join(dataDirs.TRILIUM_DATA_DIR, "backup-passphrase.bin");
const TEMP_PATH = `${PASSPHRASE_PATH}.tmp`;

/**
 * Whether the OS has somewhere safe to keep the passphrase.
 *
 * `isEncryptionAvailable()` alone is not enough. On Linux without a keyring the selected backend is
 * `basic_text`, which "encrypts" with a hardcoded password, so the file would be plaintext in all
 * but name. Both that and the backend name are only meaningful once the app is ready.
 */
export function isKeyringAvailable(): boolean {
    if (!electron.app.isReady() || !electron.safeStorage.isEncryptionAvailable()) {
        return false;
    }

    return process.platform !== "linux"
        || electron.safeStorage.getSelectedStorageBackend() !== "basic_text";
}

export function isPassphraseSet(): boolean {
    return fs.existsSync(PASSPHRASE_PATH);
}

export function getBackupPassphraseStatus(): BackupPassphraseStatus {
    return { available: isKeyringAvailable(), set: isPassphraseSet() };
}

/**
 * Stores a passphrase, replacing any existing one. Returns `false` when there is no keyring to use.
 */
export async function storeBackupPassphrase(passphrase: string): Promise<boolean> {
    if (!isKeyringAvailable() || !passphrase) {
        return false;
    }

    const encrypted = await electron.safeStorage.encryptStringAsync(passphrase);

    // Written aside and renamed, so a crash cannot leave a half-written blob that reads as a
    // corrupted passphrase and silently turns off encryption on the next backup.
    fs.writeFileSync(TEMP_PATH, encrypted, { mode: 0o600 });
    fs.renameSync(TEMP_PATH, PASSPHRASE_PATH);

    return true;
}

export function clearBackupPassphrase(): void {
    fs.rmSync(PASSPHRASE_PATH, { force: true });
}

/**
 * Reads the passphrase back, for the main process alone. Never reachable from the renderer.
 *
 * Returns `null` when there is nothing stored, or when the blob cannot be decrypted — which happens
 * when the keyring is locked, or when the data directory was copied from another machine, since the
 * ciphertext is bound to the user account that wrote it.
 */
export async function getBackupPassphrase(): Promise<string | null> {
    if (!isPassphraseSet() || !isKeyringAvailable()) {
        return null;
    }

    try {
        const stored = fs.readFileSync(PASSPHRASE_PATH);
        const { result, shouldReEncrypt } = await electron.safeStorage.decryptStringAsync(stored);

        // The OS rotated its key underneath us; rewrite now or the blob eventually stops
        // decrypting.
        if (shouldReEncrypt) {
            await storeBackupPassphrase(result);
        }

        return result;
    } catch (e) {
        // The reason reaches the log, the passphrase never does.
        const reason = e instanceof Error ? e.message : String(e);
        getLog().error(`Could not read the stored backup passphrase: ${reason}`);
        return null;
    }
}

/**
 * Asks the user through the operating system, not through the app.
 *
 * A frontend script can reach the IPC channel behind this, but it cannot press a button in a window
 * the OS drew, which is the whole point: without the question, a script could quietly replace the
 * passphrase with one it knows and every later backup would be encrypted to it.
 *
 * Deliberately without the "don't ask again" escape the security settings offer. That exists there
 * to stop a script from fatiguing the user through repetition; here the question is rare enough
 * that being asked every time costs nothing, and skipping it is the whole vulnerability.
 */
async function confirmChange(action: "set" | "clear"): Promise<boolean> {
    const { response } = await electron.dialog.showMessageBox({
        type: "warning",
        buttons: [
            t("backup-password-dialog.cancel"),
            t(`backup-password-dialog.${action}-confirm`)
        ],
        defaultId: 1,
        cancelId: 0,
        title: t(`backup-password-dialog.${action}-title`),
        message: t(`backup-password-dialog.${action}-message`),
        detail: t(`backup-password-dialog.${action}-detail`)
    });

    return response === 1;
}

export function registerBackupPassphraseIpcHandlers(): void {
    electron.ipcMain.handle("backup-passphrase-status", handleStatus);
    electron.ipcMain.handle("backup-passphrase-set", handleSet);
    electron.ipcMain.handle("backup-passphrase-clear", handleClear);
}

function handleStatus(): BackupPassphraseStatus {
    return getBackupPassphraseStatus();
}

async function handleSet(_event: unknown, passphrase: string): Promise<BackupPassphraseChange> {
    // Nothing to confirm when it could not be honoured anyway.
    if (!isKeyringAvailable() || !passphrase) {
        return "unavailable";
    }
    if (!await confirmChange("set")) {
        return "cancelled";
    }

    return await storeBackupPassphrase(passphrase) ? "applied" : "unavailable";
}

async function handleClear(): Promise<BackupPassphraseChange> {
    if (!await confirmChange("clear")) {
        return "cancelled";
    }
    clearBackupPassphrase();

    return "applied";
}
