import { data_encryption } from "@triliumnext/core";
import crypto from "crypto";

import sql from "../sql.js";
import utils from "../utils.js";
import myScryptService from "./my_scrypt.js";

function saveUser(subjectIdentifier: string, name: string, email: string) {
    if (isUserSaved()) return false;

    const verificationSalt = utils.randomSecureToken(32);
    const derivedKeySalt = utils.randomSecureToken(32);

    const verificationHash = myScryptService.getSubjectIdentifierVerificationHash(
        subjectIdentifier,
        verificationSalt
    );

    const userIDEncryptedDataKey = setDataKey(
        subjectIdentifier,
        utils.randomSecureToken(16),
        verificationSalt
    );

    const data = {
        tmpID: 0,
        userIDVerificationHash: utils.toBase64(verificationHash),
        salt: verificationSalt,
        derivedKey: derivedKeySalt,
        userIDEncryptedDataKey,
        isSetup: "true",
        username: name,
        email
    };

    sql.upsert("user_data", "tmpID", data);
    return true;
}

function isSubjectIdentifierSaved() {
    const value = sql.getValue("SELECT userIDEncryptedDataKey FROM user_data;");
    if (value === undefined || value === null || value === "") return false;
    return true;
}

/**
 * Checks whether an OAuth subject identifier matches the one bound to this instance during
 * enrollment. Used at login to enforce that only the enrolled account may sign in — without it, any
 * identity the IdP authenticates would be granted access. The plaintext `sub` is never stored; we
 * recompute its scrypt verification hash against the saved salt and compare it (in constant time) to
 * the stored hash, mirroring how passwords are verified.
 */
function verifySubjectIdentifier(subjectIdentifier: string): boolean {
    const row = sql.getRowOrNull<{ userIDVerificationHash: string; salt: string }>(
        "SELECT userIDVerificationHash, salt FROM user_data;"
    );

    if (!row || !row.userIDVerificationHash || !row.salt) {
        return false;
    }

    const computedHash = utils.toBase64(
        myScryptService.getSubjectIdentifierVerificationHash(subjectIdentifier, row.salt)
    );

    return constantTimeEquals(computedHash, row.userIDVerificationHash);
}

/** Length-safe, constant-time string comparison so the match check can't be timing-probed. */
function constantTimeEquals(a: string, b: string): boolean {
    const aBuffer = Buffer.from(a);
    const bBuffer = Buffer.from(b);
    if (aBuffer.length !== bBuffer.length) {
        return false;
    }
    return crypto.timingSafeEqual(aBuffer, bBuffer);
}

function isUserSaved() {
    const isSaved = sql.getValue<string>("SELECT isSetup FROM user_data;");
    return isSaved === "true";
}

function setDataKey(
    subjectIdentifier: string,
    plainTextDataKey: string | Buffer,
    salt: string
) {
    const subjectIdentifierDerivedKey =
        myScryptService.getSubjectIdentifierDerivedKey(subjectIdentifier, salt);

    return data_encryption.encrypt(subjectIdentifierDerivedKey, plainTextDataKey);
}

export default {
    setDataKey,
    saveUser,
    isSubjectIdentifierSaved,
    verifySubjectIdentifier,
};
