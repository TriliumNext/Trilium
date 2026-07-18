import options from "../options.js";
import { getCrypto } from "./crypto.js";

const SCRYPT_OPTIONS = { N: 16384, r: 8, p: 1 };

/**
 * Gets the password verification hash using scrypt.
 * Uses the passwordVerificationSalt option as salt.
 */
export async function getVerificationHash(password: string): Promise<Uint8Array> {
    const salt = options.getOption("passwordVerificationSalt");
    return getScryptHash(password, salt);
}

/**
 * Gets the password-derived encryption key using scrypt.
 * Uses the passwordDerivedKeySalt option as salt.
 */
export async function getPasswordDerivedKey(password: string): Promise<Uint8Array> {
    const salt = options.getOption("passwordDerivedKeySalt");
    return getScryptHash(password, salt);
}

/**
 * Computes a scrypt hash with standard parameters.
 * @param password - The password to hash
 * @param salt - The salt to use
 * @returns 32-byte derived key
 */
export async function getScryptHash(
    password: string,
    salt: string
): Promise<Uint8Array> {
    return getCrypto().scrypt(password, salt, 32, SCRYPT_OPTIONS);
}

export default {
    getVerificationHash,
    getPasswordDerivedKey,
    getScryptHash
};
