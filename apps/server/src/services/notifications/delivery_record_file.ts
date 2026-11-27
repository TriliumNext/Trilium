/**
 * @module
 *
 * The files of the notification channels in the data directory, each written whole: the delivery
 * record of the forwarder here, and the secrets file of the webhooks through the same helpers.
 */
import type {
    DeliveryRecordPort
} from "@triliumnext/core/src/services/notifications/channels/types.js";
import fs from "fs";
import path from "path";

import dataDir from "../data_dir.js";

const DELIVERY_RECORD_NAME = "notification-deliveries.json";

/** The delivery record of the forwarder: `notification-deliveries.json` in the data directory. */
export function createDeliveryRecordFile(): DeliveryRecordPort {
    const filePath = path.join(dataDir.TRILIUM_DATA_DIR, DELIVERY_RECORD_NAME);
    return {
        name: DELIVERY_RECORD_NAME,
        read: () => readFileIfExists(filePath),
        write: (text) => writeFileAtomically(filePath, text)
    };
}

/**
 * Reads a text file.
 *
 * @returns its text, or `null` when it does not exist.
 * @throws when it exists and cannot be read, naming the file and the code of the error only.
 */
export async function readFileIfExists(filePath: string): Promise<string | null> {
    try {
        return await fs.promises.readFile(filePath, "utf-8");
    } catch (e) {
        if (getErrorCode(e) === "ENOENT") {
            return null;
        }
        throw new Error(`${path.basename(filePath)} cannot be read: ${getErrorCode(e)}`);
    }
}

/**
 * Writes a text file so that a crash leaves the old text or the new one: a temporary file created
 * with mode `0600`, which the rename keeps, flushed and renamed over the file, then the folder
 * flushed where the platform allows.
 *
 * @throws when the file cannot be written, naming the file and the code of the error only.
 */
export async function writeFileAtomically(filePath: string, text: string): Promise<void> {
    const temporaryPath = `${filePath}.tmp`;
    try {
        // `wx` creates the file with the mode, which an existing file would keep from before.
        await fs.promises.rm(temporaryPath, { force: true });
        const handle = await fs.promises.open(temporaryPath, "wx", 0o600);
        try {
            await handle.writeFile(text, "utf-8");
            await handle.sync();
        } finally {
            await handle.close();
        }
        await fs.promises.rename(temporaryPath, filePath);
    } catch (e) {
        await fs.promises.rm(temporaryPath, { force: true });
        throw new Error(`${path.basename(filePath)} cannot be written: ${getErrorCode(e)}`);
    }
    await syncFolder(path.dirname(filePath));
}

/** Flushes a folder, so that a rename in it survives a crash. */
export async function syncFolder(folder: string): Promise<void> {
    try {
        const handle = await fs.promises.open(folder, "r");
        try {
            await handle.sync();
        } finally {
            await handle.close();
        }
    } catch {
        // Windows opens no folder for a flush.
    }
}

/** The code of a file system error, such as `ENOENT`. */
export function getErrorCode(error: unknown) {
    return (error as NodeJS.ErrnoException).code;
}
