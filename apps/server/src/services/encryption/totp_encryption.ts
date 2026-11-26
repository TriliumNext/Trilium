/**
 * Server-side TOTP (Time-based One-Time Password) encryption service.
 *
 * This service handles encryption/decryption of TOTP secrets and remains
 * server-only because:
 * - TOTP/2FA is not supported in standalone mode
 * - Uses synchronous Node.js crypto.scryptSync for performance
 *
 * The TOTP secret is sealed with the key of `second_factor_key.txt` and stored in options. A legacy
 * secret is encrypted with `totpEncryptionSalt`, another option, and is read for the conversion at
 * startup and by the setup wizard. `totpVerificationHash` is set whenever a secret is set.
 */
import type { OptionNames } from "@triliumnext/commons";
import { binary_utils, data_encryption, options as optionService } from "@triliumnext/core";
import crypto from "crypto";

import { toBase64 } from "../utils.js";
import { isSealed, open, seal } from "./second_factor_key.js";

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

function setTotpSecret(secret: string) {
    if (!secret) {
        throw new Error("TOTP secret cannot be empty");
    }

    optionService.setOption(TOTP_OPTIONS.SALT, "");
    optionService.setOption(
        TOTP_OPTIONS.ENCRYPTED_SECRET,
        seal(TOTP_OPTIONS.ENCRYPTED_SECRET, secret)
    );
    optionService.setOption(
        TOTP_OPTIONS.VERIFICATION_HASH,
        toBase64(getTotpVerificationHash(secret))
    );
}

/** Returns the secret, sealed or legacy, or `null` when none is set or it does not open. */
function getTotpSecret(): string | null {
    const encryptedSecret = optionService.getOptionOrNull(TOTP_OPTIONS.ENCRYPTED_SECRET);
    if (!encryptedSecret) {
        return null;
    }

    return isSealed(encryptedSecret)
        ? open(TOTP_OPTIONS.ENCRYPTED_SECRET, encryptedSecret)
        : getLegacyTotpSecret(encryptedSecret);
}

/** Reads a secret in the legacy form, encrypted with `totpEncryptionSalt`. */
function getLegacyTotpSecret(encryptedSecret: string): string | null {
    const encryptionSalt = optionService.getOptionOrNull(TOTP_OPTIONS.SALT);
    if (!encryptionSalt) {
        return null;
    }

    const decryptedSecret = data_encryption.decryptStrictly(
        Buffer.from(encryptionSalt),
        encryptedSecret
    );
    return decryptedSecret ? binary_utils.decodeUtf8(decryptedSecret) : null;
}

/**
 * Seals a legacy secret with the key file and clears its salt.
 *
 * @returns whether a legacy secret was converted.
 */
function convertLegacyTotpSecret(): boolean {
    const encryptedSecret = optionService.getOptionOrNull(TOTP_OPTIONS.ENCRYPTED_SECRET);
    if (!encryptedSecret || isSealed(encryptedSecret)) {
        return false;
    }

    const secret = getLegacyTotpSecret(encryptedSecret);
    if (secret === null) {
        return false;
    }

    optionService.setOption(
        TOTP_OPTIONS.ENCRYPTED_SECRET,
        seal(TOTP_OPTIONS.ENCRYPTED_SECRET, secret)
    );
    optionService.setOption(TOTP_OPTIONS.SALT, "");
    return true;
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
    setTotpSecret,
    getTotpSecret,
    convertLegacyTotpSecret,
    resetTotpSecret,
    isTotpSecretSet
};
