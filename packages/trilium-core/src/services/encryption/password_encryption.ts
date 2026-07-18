import data_encryption from "./data_encryption.js";
import scryptService from "./scrypt.js";
import options from "../options.js";
import { getCrypto } from "./crypto.js";
import { encodeBase64 } from "../utils/binary.js";

/**
 * Verifies a password against the stored hash.
 * Uses constant-time comparison to prevent timing attacks.
 */
export async function verifyPassword(password: string): Promise<boolean> {
    const givenPasswordHash = encodeBase64(await scryptService.getVerificationHash(password));
    const dbPasswordHash = options.getOptionOrNull("passwordVerificationHash");

    if (!dbPasswordHash) {
        return false;
    }

    // Use constant-time comparison to prevent timing attacks
    const givenBytes = new TextEncoder().encode(givenPasswordHash);
    const dbBytes = new TextEncoder().encode(dbPasswordHash);

    return getCrypto().constantTimeCompare(givenBytes, dbBytes);
}

/**
 * Encrypts and stores the data key using the password-derived key.
 */
export async function setDataKey(
    password: string,
    plainTextDataKey: string | Uint8Array
): Promise<void> {
    const passwordDerivedKey = await scryptService.getPasswordDerivedKey(password);
    const newEncryptedDataKey = data_encryption.encrypt(passwordDerivedKey, plainTextDataKey);
    options.setOption("encryptedDataKey", newEncryptedDataKey);
}

/**
 * Decrypts and returns the data key using the password-derived key.
 */
export async function getDataKey(password: string): Promise<Uint8Array | false | null> {
    const passwordDerivedKey = await scryptService.getPasswordDerivedKey(password);
    const encryptedDataKey = options.getOption("encryptedDataKey");
    return data_encryption.decrypt(passwordDerivedKey, encryptedDataKey);
}

export default {
    verifyPassword,
    getDataKey,
    setDataKey
};
