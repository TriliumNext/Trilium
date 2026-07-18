import { options } from "@triliumnext/core";
import { Totp } from "time2fa";

import recoveryCodesService from "./encryption/recovery_codes.js";
import totpEncryptionService from "./encryption/totp_encryption.js";

function isTotpEnabled(): boolean {
    return options.getOptionOrNull("mfaMethod") === "totp" &&
        totpEncryptionService.isTotpSecretSet();
}

/**
 * Generates a fresh TOTP secret but deliberately does NOT persist it. The caller must first confirm
 * the user can produce a valid code for this secret (via {@link validateTOTPForSecret}) and only
 * then activate it with {@link setSecret}. Persisting only after this proof-of-possession check
 * prevents the user from locking themselves out by enabling TOTP for a secret their authenticator
 * never received correctly.
 *
 * Returns both the bare secret (for manual entry) and the `otpauth://` URL the authenticator expects,
 * which the client renders as a scannable QR code. `accountName` is only the human-readable label
 * shown next to the "Trilium" issuer in the authenticator app (typically the instance host).
 */
function generateSecret(accountName = "Trilium"): { success: boolean; message?: string; url?: string } {
    try {
        const key = Totp.generateKey({ issuer: "Trilium", user: accountName });

        return {
            success: true,
            message: key.secret,
            url: key.url
        };
    } catch (e) {
        console.error("Failed to create TOTP secret:", e);
        return {
            success: false,
            message: e instanceof Error ? e.message : "Unknown error occurred"
        };
    }
}

/** Persists a (previously verified) TOTP secret, making TOTP the active second factor at login. */
function setSecret(secret: string): void {
    totpEncryptionService.setTotpSecret(secret);
}

function getTotpSecret(): string | null {
    return totpEncryptionService.getTotpSecret();
}

function checkForTotpSecret(): boolean {
    return totpEncryptionService.isTotpSecretSet();
}

/**
 * Validates a passcode against an explicitly supplied secret. Used during enrollment to verify the
 * user's authenticator before the secret is persisted (see {@link generateSecret}).
 */
function validateTOTPForSecret(secret: string, submittedPasscode: string): boolean {
    if (!secret) return false;

    try {
        return Totp.validate({
            passcode: submittedPasscode,
            secret: secret.trim()
        });
    } catch (e) {
        console.error("Failed to validate TOTP:", e);
        return false;
    }
}

/** Validates a passcode against the persisted secret. Used at login. */
function validateTOTP(submittedPasscode: string): boolean {
    const secret = getTotpSecret();
    if (!secret) return false;

    return validateTOTPForSecret(secret, submittedPasscode);
}

function resetTotp(): void {
    totpEncryptionService.resetTotpSecret();
    recoveryCodesService.clearRecoveryCodes();
}

export default {
    isTotpEnabled,
    generateSecret,
    setSecret,
    getTotpSecret,
    checkForTotpSecret,
    validateTOTP,
    validateTOTPForSecret,
    resetTotp
};
