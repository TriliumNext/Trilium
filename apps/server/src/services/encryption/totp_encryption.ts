/**
 * Server-side TOTP (Time-based One-Time Password) encryption service.
 *
 * This service handles encryption/decryption of TOTP secrets and remains
 * server-only because:
 * - TOTP/2FA is not supported in standalone mode
 * - Uses synchronous Node.js crypto.scryptSync for performance
 *
 * The TOTP secret is encrypted using AES and stored in options.
 * Verification uses scrypt-based hashing with constant-time comparison.
 */
import type { OptionNames } from "@triliumnext/commons";
import { data_encryption } from "@triliumnext/core";
import crypto from "crypto";

import optionService from "../options.js";
import { constantTimeCompare, randomSecureToken, toBase64 } from "../utils.js";

const TOTP_OPTIONS: Record<string, OptionNames> = {
    SALT: "totpEncryptionSalt",
    ENCRYPTED_SECRET: "totpEncryptedSecret",
    VERIFICATION_HASH: "totpVerificationHash"
};

const SCRYPT_OPTIONS = { N: 16384, r: 8, p: 1 };

/**
 * Gets verification hash for TOTP secret using the password verification salt.
 * This is server-only and uses sync scrypt.
 */
function getTotpVerificationHash(secret: string): Buffer {
    const salt = optionService.getOption("passwordVerificationSalt");
    return crypto.scryptSync(secret, salt, 32, SCRYPT_OPTIONS);
}

function verifyTotpSecret(secret: string): boolean {
    const givenSecretHash = toBase64(getTotpVerificationHash(secret));
    const dbSecretHash = optionService.getOptionOrNull(TOTP_OPTIONS.VERIFICATION_HASH);

    if (!dbSecretHash) {
        return false;
    }

    return constantTimeCompare(givenSecretHash, dbSecretHash);
}

function setTotpSecret(secret: string) {
    if (!secret) {
        throw new Error("TOTP secret cannot be empty");
    }

    const encryptionSalt = randomSecureToken(32);
    optionService.setOption(TOTP_OPTIONS.SALT, encryptionSalt);

    const verificationHash = toBase64(getTotpVerificationHash(secret));
    optionService.setOption(TOTP_OPTIONS.VERIFICATION_HASH, verificationHash);

    const encryptedSecret = data_encryption.encrypt(
        Buffer.from(encryptionSalt),
        secret
    );
    optionService.setOption(TOTP_OPTIONS.ENCRYPTED_SECRET, encryptedSecret);
}

function getTotpSecret(): string | null {
    const encryptionSalt = optionService.getOptionOrNull(TOTP_OPTIONS.SALT);
    const encryptedSecret = optionService.getOptionOrNull(TOTP_OPTIONS.ENCRYPTED_SECRET);

    if (!encryptionSalt || !encryptedSecret) {
        return null;
    }

    try {
        const decryptedSecret = data_encryption.decrypt(
            Buffer.from(encryptionSalt),
            encryptedSecret
        );

        if (!decryptedSecret) {
            return null;
        }

        return decryptedSecret.toString();
    } catch (e) {
        console.error("Failed to decrypt TOTP secret:", e);
        return null;
    }
}

function resetTotpSecret() {
    optionService.setOption(TOTP_OPTIONS.SALT, "");
    optionService.setOption(TOTP_OPTIONS.ENCRYPTED_SECRET, "");
    optionService.setOption(TOTP_OPTIONS.VERIFICATION_HASH, "");
}

function isTotpSecretSet(): boolean {
    return !!optionService.getOptionOrNull(TOTP_OPTIONS.VERIFICATION_HASH);
}

export default {
    verifyTotpSecret,
    setTotpSecret,
    getTotpSecret,
    resetTotpSecret,
    isTotpSecretSet
};
