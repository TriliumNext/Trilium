import { options } from "@triliumnext/core";
import type { Request } from "express";

import recoveryCodesService from "../../services/encryption/recovery_codes.js";
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
    totpService.setSecret(secret);
    recoveryCodesService.setRecoveryCodes(recoveryCodes.join(","));
    return { success: true };
}

function getTOTPStatus() {
    return {
        success: true,
        message: totpService.isTotpEnabled(),
        set: totpService.checkForTotpSecret()
    };
}

function getSecret() {
    return totpService.getTotpSecret();
}

function resetTOTP() {
    totpService.resetTotp();
    return { success: true };
}

export default {
    generateSecret: generateTOTPSecret,
    verifySecret: verifyTOTPSecret,
    enableSecret: enableTOTP,
    getTOTPStatus,
    getSecret,
    resetTOTP
};
