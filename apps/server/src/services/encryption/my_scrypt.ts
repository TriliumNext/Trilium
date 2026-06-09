/**
 * Server-side scrypt service.
 *
 * Password-related functions (getVerificationHash, getPasswordDerivedKey, getScryptHash)
 * have been moved to @triliumnext/core. Import them from there:
 *
 *   import { scrypt } from "@triliumnext/core";
 *   await scrypt.getVerificationHash(password);
 *
 * This file only contains OpenID-specific functions that use synchronous crypto.
 */
import crypto from "crypto";

const SCRYPT_OPTIONS = { N: 16384, r: 8, p: 1 };

/**
 * Sync scrypt hash for OpenID functions (server-only).
 */
function getScryptHashSync(password: crypto.BinaryLike, salt: crypto.BinaryLike): Buffer {
    return crypto.scryptSync(password, salt, 32, SCRYPT_OPTIONS);
}

/**
 * Gets the verification hash for an OpenID subject identifier.
 */
function getSubjectIdentifierVerificationHash(
    guessedUserId: string | crypto.BinaryLike,
    salt: string
): Buffer {
    return getScryptHashSync(guessedUserId, salt);
}

/**
 * Gets the derived key for an OpenID subject identifier.
 */
function getSubjectIdentifierDerivedKey(
    subjectIdentifer: crypto.BinaryLike,
    salt: string
): Buffer {
    return getScryptHashSync(subjectIdentifer, salt);
}

export default {
    getSubjectIdentifierVerificationHash,
    getSubjectIdentifierDerivedKey
};
