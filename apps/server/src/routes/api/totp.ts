import type { SignInRecords } from "@triliumnext/commons";
import { device_records, options, ValidationError } from "@triliumnext/core";
import type { Request } from "express";

import recoveryCodesService from "../../services/encryption/recovery_codes.js";
import { setAsideUnreadableKey } from "../../services/encryption/second_factor_key.js";
import {
    getSecondFactorCheck,
    getSecondFactorState,
    getWaitUntil,
    markEnrolled,
    readWrongCodes
} from "../../services/second_factor.js";
import totpService from "../../services/totp.js";

function generateTOTPSecret(req: Request) {
    // The hostname is only a human-readable account label in the authenticator app (under the
    // "Trilium" issuer), helping users with several instances tell them apart.
    return totpService.generateSecret(req.hostname);
}

/**
 * Verifies a freshly generated secret by checking a code the user produced for it, WITHOUT
 * persisting anything. On success we issue recovery codes (also unpersisted) so they can be shown as
 * the next enrollment step. The secret only becomes active once {@link enableTOTP} commits it — so
 * abandoning the flow here (e.g. closing the dialog without saving the recovery codes) leaves TOTP
 * disabled and can never lock the user out.
 */
function verifyTOTPSecret(req: Request) {
    const secret = req.body?.secret;
    const token = req.body?.token;

    if (typeof secret !== "string" || !secret || typeof token !== "string" || !token) {
        return { success: false };
    }

    if (!totpService.validateTOTPForSecret(secret, token)) {
        return { success: false };
    }

    return { success: true, recoveryCodes: recoveryCodesService.createRecoveryCodes() };
}

/**
 * Commits a verified secret together with its recovery codes, activating TOTP. This is the final
 * enrollment step, reached only after the user confirms they've saved the recovery codes, so this
 * is the single point where anything is persisted.
 */
function enableTOTP(req: Request) {
    const secret = req.body?.secret;
    const recoveryCodes = req.body?.recoveryCodes;

    const hasSecret = typeof secret === "string" && secret.length > 0;
    const hasCodes = Array.isArray(recoveryCodes) && recoveryCodes.length > 0;
    if (!hasSecret || !hasCodes) {
        return { success: false };
    }

    // Committing a secret must also select TOTP as the MFA method: login enforcement
    // (totpService.isTotpEnabled) gates on mfaMethod === "totp", and an upgraded install can carry a
    // stale value (e.g. the "" an older resetTotp left behind) that the sign-in dropdown never
    // rewrites while it already reads as "local". Setting it here makes "secret committed" always
    // imply "TOTP enforced at login".
    options.setOption("mfaMethod", "totp");
    setAsideUnreadableKey();
    totpService.setSecret(secret);
    recoveryCodesService.setRecoveryCodes(recoveryCodes.join(","));
    // A new secret makes the factor in every older copy of the database worthless.
    markEnrolled();
    return { success: true };
}

/**
 * Writes `mfaMethod`, which decides the factor the login asks for; the options route refuses it.
 */
function setMethod(req: Request) {
    const method = req.body?.method;
    if (method !== "totp" && method !== "oauth") {
        throw new ValidationError("Unknown sign-in method.");
    }

    options.setOption("mfaMethod", method);
    return { success: true };
}

function getTOTPStatus() {
    return {
        success: true,
        message: totpService.isTotpEnabled(),
        set: totpService.checkForTotpSecret(),
        // Whether `checkCredentials()` asks for a code besides the password.
        isCodeAsked: getSecondFactorCheck() !== "none"
    };
}

function resetTOTP() {
    totpService.resetTotp();
    return { success: true };
}

/** Returns the security records of this device, which no route clears. */
function getSignInRecords(): SignInRecords {
    const wrongCodes = readWrongCodes();
    return {
        secondFactorState: getSecondFactorState(),
        repairs: device_records.readDeviceRecord("startupRepairRecord"),
        attempts: device_records.readDeviceRecord("signInAttemptRecord"),
        wrongCodeCount: wrongCodes.count,
        waitUntil: getWaitUntil(wrongCodes)
    };
}

export default {
    generateSecret: generateTOTPSecret,
    verifySecret: verifyTOTPSecret,
    enableSecret: enableTOTP,
    setMethod,
    getTOTPStatus,
    resetTOTP,
    getSignInRecords
};
