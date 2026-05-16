/**
 * Server-side scrypt service.
 *
 * Password-related functions (getVerificationHash, getPasswordDerivedKey, getScryptHash)
 * have been moved to @triliumnext/core. Import them from there:
 *
 *   import { scrypt } from "@triliumnext/core";
 *   await scrypt.getVerificationHash(password);
 *
 * This file only contains OpenID-specific functions that use synchronous crypto
 * and access the user_data table directly.
 */
import crypto from "crypto";
import sql from "../sql.js";

const SCRYPT_OPTIONS = { N: 16384, r: 8, p: 1 };

/**
 * Sync scrypt hash for OpenID functions (server-only).
 */
function getScryptHashSync(password: crypto.BinaryLike, salt: crypto.BinaryLike): Buffer {
    return crypto.scryptSync(password, salt, 32, SCRYPT_OPTIONS);
}

/**
 * Gets the verification hash for an OpenID subject identifier.
 * Uses the salt from user_data table if not provided.
 */
function getSubjectIdentifierVerificationHash(
    guessedUserId: string | crypto.BinaryLike,
    salt?: string
): Buffer | undefined {
    if (salt != null) return getScryptHashSync(guessedUserId, salt);

    const savedSalt = sql.getValue("SELECT salt FROM user_data;");
    if (!savedSalt) {
        console.error("User salt undefined!");
        return undefined;
    }
    return getScryptHashSync(guessedUserId, savedSalt.toString());
}

/**
 * Gets the derived key for an OpenID subject identifier.
 * Uses the salt from user_data table if not provided.
 */
function getSubjectIdentifierDerivedKey(
    subjectIdentifer: crypto.BinaryLike,
    givenSalt?: string
): Buffer | undefined {
    if (givenSalt !== undefined) {
        return getScryptHashSync(subjectIdentifer, givenSalt.toString());
    }

    const salt = sql.getValue("SELECT salt FROM user_data;");
    if (!salt) return undefined;

    return getScryptHashSync(subjectIdentifer, salt.toString());
}

/**
 * Creates a derived key for an OpenID subject identifier with the given salt.
 */
function createSubjectIdentifierDerivedKey(
    subjectIdentifer: string | crypto.BinaryLike,
    salt: string | crypto.BinaryLike
): Buffer {
    return getScryptHashSync(subjectIdentifer, salt);
}

export default {
    getSubjectIdentifierVerificationHash,
    getSubjectIdentifierDerivedKey,
    createSubjectIdentifierDerivedKey
};
