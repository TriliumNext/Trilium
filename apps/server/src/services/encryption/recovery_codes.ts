import { options as optionService } from '@triliumnext/core';
import crypto from 'crypto';

import sql from '../sql.js';
import { constantTimeCompare } from '../utils.js';
import { isSealed, open, seal } from './second_factor_key.js';

/**
 * What a recovery code looks like: 22 characters and the base64 padding.
 *
 * Deliberately without the `g` flag the inline copies of this pattern carried. A `g` regex kept in a
 * variable remembers where it last matched, so `test` on a shared one answers correctly only every
 * other call.
 */
export const RECOVERY_CODE_SHAPE = /^.{22}==$/;

function isRecoveryCodeSet() {
    return optionService.getOptionBool('encryptedRecoveryCodes');
}

/** Stores the codes sealed with the key of `second_factor_key.txt`. */
function setRecoveryCodes(recoveryCodes: string) {
    sql.transactional(() => {
        optionService.setOption('recoveryCodeInitialVector', '');
        optionService.setOption('recoveryCodeSecurityKey', '');
        optionService.setOption('recoveryCodesEncrypted',
            seal('recoveryCodesEncrypted', recoveryCodes));
        optionService.setOption('encryptedRecoveryCodes', 'true');
    });
}

/**
 * Seals legacy codes with the key file and clears their key and IV.
 *
 * @returns whether legacy codes were converted.
 */
function convertLegacyRecoveryCodes(): boolean {
    const stored = optionService.getOptionOrNull('recoveryCodesEncrypted');
    if (!isRecoveryCodeSet() || !stored || isSealed(stored)) {
        return false;
    }

    const codes = readLegacyRecoveryCodes(stored);
    if (codes === null) {
        return false;
    }

    setRecoveryCodes(codes);
    return true;
}

/**
 * Reads codes in the legacy form, sealed with a key and an IV stored in options, or returns `null`.
 */
function readLegacyRecoveryCodes(stored: string): string | null {
    try {
        const iv = Buffer.from(optionService.getOption('recoveryCodeInitialVector'), 'hex');
        const securityKey = Buffer.from(optionService.getOption('recoveryCodeSecurityKey'), 'hex');
        const decipher = crypto.createDecipheriv('aes-256-cbc', securityKey, iv);
        return decipher.update(stored, 'hex', 'utf-8') + decipher.final('utf-8');
    } catch {
        return null;
    }
}

/** Generates a fresh set of recovery codes WITHOUT persisting them (the caller decides when to commit). */
function createRecoveryCodes(): string[] {
    return Array.from({ length: 8 }, () => crypto.randomBytes(16).toString('base64'));
}

function clearRecoveryCodes() {
    sql.transactional(() => {
        optionService.setOption('recoveryCodeInitialVector', '');
        optionService.setOption('recoveryCodeSecurityKey', '');
        optionService.setOption('recoveryCodesEncrypted', '');
        optionService.setOption('encryptedRecoveryCodes', 'false');
        return true;
    });
}

/** Returns the codes, sealed or legacy, or an empty list when they do not open. */
function getRecoveryCodes(): string[] {
    if (!isRecoveryCodeSet()) {
        return []
    }

    const stored = optionService.getOption('recoveryCodesEncrypted');
    const codes = isSealed(stored)
        ? open('recoveryCodesEncrypted', stored)
        : readLegacyRecoveryCodes(stored);
    return codes === null ? [] : codes.split(',');
}

function removeRecoveryCode(usedCode: string) {
    const oldCodes = getRecoveryCodes();
    const today = new Date();
    oldCodes[oldCodes.indexOf(usedCode)] = today.toJSON().replace(/-/g, '/');
    setRecoveryCodes(oldCodes.toString());
}

/**
 * Whether `recoveryCodeGuess` is one of the codes, leaving it where it is.
 *
 * The consuming check below is the one login uses, and the one to reach for by default. This exists
 * for the setup wizard, which runs against a database that is attached but not migrated, with becca
 * unloaded: `setOption` there would create a duplicate row rather than update one, and a code spent
 * in that state would still read as unspent everywhere else in a sync cluster. So the wizard trades
 * the single use for being able to check at all — see `setup_auth` in core.
 */
function matchesRecoveryCode(recoveryCodeGuess: string) {
    if (!RECOVERY_CODE_SHAPE.test(recoveryCodeGuess)) {
        return false;
    }

    // Every code is compared even once one has matched, so the time taken says nothing about which.
    return getRecoveryCodes().reduce(
        (matched, recoveryCode) => constantTimeCompare(recoveryCodeGuess, recoveryCode) || matched,
        false
    );
}

function verifyRecoveryCode(recoveryCodeGuess: string) {
    if (!RECOVERY_CODE_SHAPE.test(recoveryCodeGuess)) {
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
    convertLegacyRecoveryCodes,
    createRecoveryCodes,
    clearRecoveryCodes,
    getRecoveryCodes,
    matchesRecoveryCode,
    verifyRecoveryCode,
    isRecoveryCodeSet
};