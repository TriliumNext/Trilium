import { options } from '@triliumnext/core';
import { Totp, generateSecret } from 'time2fa';

import totpEncryptionService from './encryption/totp_encryption.js';

function isTotpEnabled(): boolean {
    return options.getOptionOrNull('mfaEnabled') === "true" &&
        options.getOptionOrNull('mfaMethod') === "totp" &&
        totpEncryptionService.isTotpSecretSet();
}

function createSecret(): { success: boolean; message?: string } {
    try {
        const secret = generateSecret();

        totpEncryptionService.setTotpSecret(secret);

        return {
            success: true,
            message: secret
        };
    } catch (e) {
        console.error('Failed to create TOTP secret:', e);
        return {
            success: false,
            message: e instanceof Error ? e.message : 'Unknown error occurred'
        };
    }
}

function getTotpSecret(): string | null {
    return totpEncryptionService.getTotpSecret();
}

function checkForTotpSecret(): boolean {
    return totpEncryptionService.isTotpSecretSet();
}

function validateTOTP(submittedPasscode: string): boolean {
    const secret = getTotpSecret();
    if (!secret) return false;

    try {
        return Totp.validate({
            passcode: submittedPasscode,
            secret: secret.trim()
        });
    } catch (e) {
        console.error('Failed to validate TOTP:', e);
        return false;
    }
}

function resetTotp(): void {
    totpEncryptionService.resetTotpSecret();
    options.setOption('mfaEnabled', 'false');
    options.setOption('mfaMethod', '');
}

export default {
    isTotpEnabled,
    createSecret,
    getTotpSecret,
    checkForTotpSecret,
    validateTOTP,
    resetTotp
};
