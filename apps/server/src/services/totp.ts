import { device_records, options, TOTP_STEP_MS } from "@triliumnext/core";
import { generateConfig, Hotp, Totp } from "time2fa";

import recoveryCodesService from "./encryption/recovery_codes.js";
import totpEncryptionService from "./encryption/totp_encryption.js";

/**
 * Bytes in a new secret: 160 bits, the length RFC 4226 (section 4) recommends and the output size
 * of HMAC-SHA-1. It encodes to 32 base32 characters with no `=` padding.
 */
const SECRET_SIZE = 20;

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
        const key = Totp.generateKey(
            { issuer: "Trilium", user: accountName }, { secretSize: SECRET_SIZE });

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

/**
 * Persists a (previously verified) TOTP secret, making TOTP the active second factor at login, and
 * clears the time step the previous secret last used (see {@link verifyTOTP}).
 */
function setSecret(secret: string): void {
    totpEncryptionService.setTotpSecret(secret);
    options.setOption("totpLastUsedStep", "");
}

function getTotpSecret(): string | null {
    return totpEncryptionService.getTotpSecret();
}

function checkForTotpSecret(): boolean {
    return totpEncryptionService.isTotpSecretSet();
}

/** Time steps accepted on either side of the current one, so clocks a step apart still agree. */
const CLOCK_DRIFT_STEPS = 1;

/**
 * Returns the time step `submittedPasscode` was generated for, or `null` if it matches none of the
 * steps within `drift` of the current one. Steps up to `lastUsedStep` are never tried.
 */
function findTimeStep(
    secret: string,
    submittedPasscode: string,
    drift: number,
    lastUsedStep = -Infinity
): number | null {
    const config = generateConfig({ secretSize: getSecretSize(secret) });
    const currentStep = Math.floor(Date.now() / 1000 / config.period);
    const firstStep = Math.max(currentStep - drift, lastUsedStep + 1);

    try {
        for (let step = firstStep; step <= currentStep + drift; step++) {
            const code = { passcode: submittedPasscode, secret: secret.trim(), counter: step };
            if (Hotp.validate(code, config)) return step;
        }
    } catch (e) {
        console.error("Failed to validate TOTP:", e);
    }

    return null;
}

/**
 * Returns the byte length of a base32 `secret`. `Hotp.validate` rejects a secret whose length
 * differs from `secretSize`, and secrets enrolled before v0.107.0 are 10 bytes long.
 */
function getSecretSize(secret: string): number {
    return Math.floor(secret.trim().replaceAll("=", "").length * 5 / 8);
}

/**
 * Validates a passcode against an explicitly supplied secret. Used during enrollment to verify the
 * user's authenticator before the secret is persisted (see {@link generateSecret}).
 */
function validateTOTPForSecret(secret: string, submittedPasscode: string): boolean {
    if (!secret) return false;

    return findTimeStep(secret, submittedPasscode, CLOCK_DRIFT_STEPS) !== null;
}

/**
 * Validates a passcode for the current step only, since it records nothing. Used by the setup
 * wizard, which must not write options while becca is unloaded (see `SetupSecondFactor.verify`).
 */
function validateTOTP(submittedPasscode: string): boolean {
    const secret = getTotpSecret();
    if (!secret) return false;

    return findTimeStep(secret, submittedPasscode, 0) !== null;
}

/**
 * Validates a passcode against the persisted secret and records its time step, so that neither it
 * nor a code from an earlier step is accepted again (RFC 6238, section 5.2). Used at login.
 */
function verifyTOTP(submittedPasscode: string): boolean {
    const secret = getTotpSecret();
    if (!secret) return false;

    const lastUsedStep = getLastUsedStep();
    const step = findTimeStep(secret, submittedPasscode, CLOCK_DRIFT_STEPS, lastUsedStep);
    if (step === null) return false;

    options.setOption("totpLastUsedStep", String(step));
    return true;
}

/**
 * Returns the time step of the last accepted code. A step that has stayed later than now for a day,
 * which a clock running ahead wrote, is cleared; until then it refuses every code.
 */
function getLastUsedStep(): number {
    const step = Number(options.getOptionOrNull("totpLastUsedStep"));
    if (!(step > 0)) {
        return -Infinity;
    }

    if (device_records.isTimeAheadForADay("totpLastUsedStep", step * TOTP_STEP_MS)) {
        options.setOption("totpLastUsedStep", "");
        device_records.addDeviceRecordEntries("startupRepairRecord", [ "totpLastUsedStep" ]);
        return -Infinity;
    }
    return step;
}

/**
 * Returns when codes are accepted again after a clock running ahead stored the time step of the
 * last accepted code, or `null` while codes are checked.
 */
function getStepWaitUntil(now = Date.now()): number | null {
    const step = Number(options.getOptionOrNull("totpLastUsedStep"));
    const currentStep = Math.floor(now / TOTP_STEP_MS);
    if (!(step >= currentStep + CLOCK_DRIFT_STEPS)) {
        return null;
    }
    return (step - CLOCK_DRIFT_STEPS + 1) * TOTP_STEP_MS;
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
    verifyTOTP,
    getStepWaitUntil,
    resetTotp
};
