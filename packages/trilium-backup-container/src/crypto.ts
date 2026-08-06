import { createCipheriv, createDecipheriv, scrypt } from "node:crypto";

import { BackupContainerError } from "./errors.js";
import {
    KEY_BYTES,
    nonceFor,
    type ScryptParams,
    scryptMemoryBytes,
    TAG_BYTES,
    VERIFIER_COUNTER
} from "./format.js";

/**
 * OpenSSL needs a little more than the `128 * N * r` working set, so the ceiling handed to Node
 * sits above what {@link scryptMemoryBytes} reports. It is a limit, not an allocation.
 */
const MAXMEM_SLACK_BYTES = 1024 * 1024;

/**
 * Derives the 32-byte file key.
 *
 * The passphrase is normalised to Unicode NFC and encoded as UTF-8, which is part of the format:
 * neither JavaScript nor Node normalises implicitly, so a composed and a decomposed `é` would
 * otherwise derive different keys on different machines.
 */
export function deriveKey(passphrase: string, salt: Buffer, params: ScryptParams): Promise<Buffer> {
    const secret = Buffer.from(passphrase.normalize("NFC"), "utf8");
    const options = {
        N: 2 ** params.log2N,
        r: params.r,
        p: params.p,
        maxmem: scryptMemoryBytes(params) + MAXMEM_SLACK_BYTES
    };

    return new Promise((resolve, reject) => {
        const fail = (error: Error) =>
            reject(new BackupContainerError(
                "invalid-kdf-params",
                `Key derivation failed: ${error.message}`
            ));

        // scrypt rejects impossible parameters synchronously and everything else through the
        // callback.
        try {
            scrypt(
                secret,
                salt,
                KEY_BYTES,
                options,
                (error, key) => (error ? fail(error) : resolve(key))
            );
        } catch (error) {
            fail(error as Error);
        }
    });
}

/** Seals one frame, returning `length || ciphertext || tag` ready to be written. */
export function sealFrame(
    key: Buffer,
    noncePrefix: Buffer,
    aad: Buffer,
    counter: number,
    lengthField: Buffer,
    plaintext: Buffer
): Buffer {
    const cipher = createCipheriv("aes-256-gcm", key, nonceFor(noncePrefix, counter));
    cipher.setAAD(Buffer.concat([ aad, lengthField ]));

    const ciphertext = Buffer.concat([ cipher.update(plaintext), cipher.final() ]);

    return Buffer.concat([ lengthField, ciphertext, cipher.getAuthTag() ]);
}

/** Opens one frame, throwing `damaged-payload` when the tag does not match. */
export function openFrame(
    key: Buffer,
    noncePrefix: Buffer,
    aad: Buffer,
    counter: number,
    lengthField: Buffer,
    ciphertext: Buffer,
    tag: Buffer,
    offset: number
): Buffer {
    const decipher = createDecipheriv("aes-256-gcm", key, nonceFor(noncePrefix, counter));
    decipher.setAAD(Buffer.concat([ aad, lengthField ]));
    decipher.setAuthTag(tag);

    try {
        return Buffer.concat([ decipher.update(ciphertext), decipher.final() ]);
    } catch {
        throw new BackupContainerError(
            "damaged-payload",
            `Frame ${counter} failed authentication at byte offset ${offset}.`
        );
    }
}

/** Computes the verifier tag: GCM over an empty plaintext, on the reserved counter. */
export function computeVerifierTag(key: Buffer, noncePrefix: Buffer, aad: Buffer): Buffer {
    const cipher = createCipheriv("aes-256-gcm", key, nonceFor(noncePrefix, VERIFIER_COUNTER));
    cipher.setAAD(aad);
    cipher.final();

    return cipher.getAuthTag();
}

/**
 * Checks the verifier tag, which tells a wrong passphrase from a usable one before any frame is
 * read.
 *
 * A mismatch cannot distinguish a wrong passphrase from a bit flip in the salt, nonce prefix or
 * tag, which is why the reason covers both.
 */
export function verifyPassphrase(
    key: Buffer,
    noncePrefix: Buffer,
    aad: Buffer,
    expectedTag: Buffer
): void {
    const decipher = createDecipheriv("aes-256-gcm", key, nonceFor(noncePrefix, VERIFIER_COUNTER));
    decipher.setAAD(aad);
    decipher.setAuthTag(expectedTag.subarray(0, TAG_BYTES));

    try {
        decipher.final();
    } catch {
        throw new BackupContainerError(
            "wrong-passphrase-or-damaged-header",
            "Verifier tag did not match."
        );
    }
}
