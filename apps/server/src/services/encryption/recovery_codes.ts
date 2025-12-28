import crypto from 'crypto';
import optionService from '../options.js';
import sql from '../sql.js';
import { constantTimeCompare } from '../utils.js';

function isRecoveryCodeSet() {
    return optionService.getOptionBool('encryptedRecoveryCodes');
}

function setRecoveryCodes(recoveryCodes: string) {
    const iv = crypto.randomBytes(16);
    const securityKey = crypto.randomBytes(32);
    const cipher = crypto.createCipheriv('aes-256-cbc', securityKey, iv);
    const encryptedRecoveryCodes = cipher.update(recoveryCodes, 'utf-8', 'hex');

    sql.transactional(() => {
        optionService.setOption('recoveryCodeInitialVector', iv.toString('hex'));
        optionService.setOption('recoveryCodeSecurityKey', securityKey.toString('hex'));
        optionService.setOption('recoveryCodesEncrypted', encryptedRecoveryCodes + cipher.final('hex'));
        optionService.setOption('encryptedRecoveryCodes', 'true');
        return true;
    });
    return false;
}

function getRecoveryCodes() {
    if (!isRecoveryCodeSet()) {
        return []
    }

    return sql.transactional<string[]>(() => {
        const iv = Buffer.from(optionService.getOption('recoveryCodeInitialVector'), 'hex');
        const securityKey = Buffer.from(optionService.getOption('recoveryCodeSecurityKey'), 'hex');
        const encryptedRecoveryCodes = optionService.getOption('recoveryCodesEncrypted');

        const decipher = crypto.createDecipheriv('aes-256-cbc', securityKey, iv);
        const decryptedData = decipher.update(encryptedRecoveryCodes, 'hex', 'utf-8');

        const decryptedString = decryptedData + decipher.final('utf-8');
        return decryptedString.split(',');
    });
}

function removeRecoveryCode(usedCode: string) {
    const oldCodes = getRecoveryCodes();
    const today = new Date();
    oldCodes[oldCodes.indexOf(usedCode)] = today.toJSON().replace(/-/g, '/');
    setRecoveryCodes(oldCodes.toString());
}

function verifyRecoveryCode(recoveryCodeGuess: string) {
    const recoveryCodeRegex = RegExp(/^.{22}==$/gm);
    if (!recoveryCodeRegex.test(recoveryCodeGuess)) {
        return false;
    }

    const recoveryCodes = getRecoveryCodes();
    let loginSuccess = false;
    let matchedCode: string | null = null;

    // Check ALL codes to prevent timing attacks - do not short-circuit
    for (const recoveryCode of recoveryCodes) {
        if (constantTimeCompare(recoveryCodeGuess, recoveryCode)) {
            matchedCode = recoveryCode;
            loginSuccess = true;
            // Continue checking all codes to maintain constant time
        }
    }

    // Remove the matched code only after checking all codes
    if (matchedCode) {
        removeRecoveryCode(matchedCode);
    }

    return loginSuccess;
}

export default {
    setRecoveryCodes,
    getRecoveryCodes,
    verifyRecoveryCode,
    isRecoveryCodeSet
};