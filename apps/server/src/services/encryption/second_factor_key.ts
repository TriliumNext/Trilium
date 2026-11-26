/**
 * @module
 *
 * The key of the second factor, kept in `second_factor_key.txt` in the data directory instead of
 * the database: backups, anonymized databases and WebSocket messages hold the options of the
 * factor, but none of them holds this file. The TOTP secret and the recovery codes are sealed with
 * keys derived from it: AES-128-CBC, with an HMAC tag over the field name, the IV and the
 * ciphertext.
 */
import { getLog } from "@triliumnext/core";
import crypto from "crypto";
import fs from "fs";
import path from "path";

import dataDir from "../data_dir.js";

/** The prefix of a sealed value, which the legacy forms (base64 or hex) never start with. */
const SEALED_PREFIX = "sealed1:";
const KEY_FILE_NAME = "second_factor_key.txt";
const IV_LENGTH = 16;
const TAG_LENGTH = 16;

export function getKeyFilePath() {
    return path.join(dataDir.TRILIUM_DATA_DIR, KEY_FILE_NAME);
}

/** Reads the key from the file, or returns `null` when it is missing or unreadable. */
function readKey(): Buffer | null {
    try {
        const key = Buffer.from(fs.readFileSync(getKeyFilePath(), "ascii").trim(), "base64");
        return key.length === 32 ? key : null;
    } catch {
        return null;
    }
}

/**
 * Returns the key, creating the file once, readable only by the server's user, and never
 * replacing it.
 */
function ensureKey(): Buffer {
    const existing = readKey();
    if (existing) {
        return existing;
    }

    // `wx` fails when the file exists, so a key that another process wrote first is kept.
    try {
        fs.writeFileSync(getKeyFilePath(), crypto.randomBytes(32).toString("base64"),
            { encoding: "ascii", mode: 0o600, flag: "wx" });
        getLog().info(`Created the key of the second factor in ${KEY_FILE_NAME}.`);
    } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "EEXIST") {
            throw e;
        }
    }

    const key = readKey();
    if (!key) {
        throw new Error(`The key of the second factor in ${KEY_FILE_NAME} cannot be read.`);
    }
    return key;
}

export function isSealed(value: string | null | undefined): boolean {
    return !!value?.startsWith(SEALED_PREFIX);
}

/** Seals a value of the factor with the key, creating the key file when it is missing. */
export function seal(field: string, value: string): string {
    const { encryptionKey, macKey } = deriveKeys(ensureKey());
    const iv = crypto.randomBytes(IV_LENGTH);
    const cipher = crypto.createCipheriv("aes-128-cbc", encryptionKey, iv);
    const cipherText = Buffer.concat([ cipher.update(value, "utf-8"), cipher.final() ]);

    return SEALED_PREFIX + Buffer.concat([
        iv, cipherText, tag(macKey, field, iv, cipherText)
    ]).toString("base64");
}

/**
 * Opens a sealed value of the factor.
 *
 * @returns the value, or `null` when the key file is missing, the tag does not match, or the value
 *          was sealed for another field.
 */
export function open(field: string, sealed: string): string | null {
    const key = readKey();
    if (!key || !isSealed(sealed)) {
        return null;
    }

    const bytes = Buffer.from(sealed.slice(SEALED_PREFIX.length), "base64");
    if (bytes.length < IV_LENGTH + TAG_LENGTH + 16) {
        return null;
    }
    const iv = bytes.subarray(0, IV_LENGTH);
    const cipherText = bytes.subarray(IV_LENGTH, bytes.length - TAG_LENGTH);
    const storedTag = bytes.subarray(bytes.length - TAG_LENGTH);

    const { encryptionKey, macKey } = deriveKeys(key);
    if (!crypto.timingSafeEqual(storedTag, tag(macKey, field, iv, cipherText))) {
        return null;
    }

    try {
        const decipher = crypto.createDecipheriv("aes-128-cbc", encryptionKey, iv);
        return Buffer.concat([ decipher.update(cipherText), decipher.final() ]).toString("utf-8");
    } catch {
        return null;
    }
}

function deriveKeys(key: Buffer) {
    return {
        encryptionKey: deriveKey(key, "trilium:second-factor-key:v1"),
        macKey: deriveKey(key, "trilium:second-factor-mac:v1")
    };
}

/**
 * Derives a 16-byte key: the first 16 bytes of HMAC-SHA256 over the UTF-8 label, keyed with `key`.
 */
function deriveKey(key: Buffer, label: string): Buffer {
    return crypto.createHmac("sha256", key).update(label, "utf-8").digest().subarray(0, 16);
}

/**
 * The first 16 bytes of HMAC-SHA256 over the field, the IV and the ciphertext, each
 * length-prefixed.
 */
function tag(macKey: Buffer, field: string, iv: Buffer, cipherText: Buffer): Buffer {
    const hmac = crypto.createHmac("sha256", macKey);
    for (const part of [ Buffer.from(field, "utf-8"), iv, cipherText ]) {
        const length = Buffer.alloc(4);
        length.writeUInt32BE(part.length);
        hmac.update(length).update(part);
    }
    return hmac.digest().subarray(0, TAG_LENGTH);
}
