import type { ChangePasswordResponse } from "@triliumnext/commons";
import options from "../options.js";
import { getSql } from "../sql/index.js";
import scryptService from "./scrypt.js";
import passwordEncryptionService from "./password_encryption.js";
import { encodeBase64 } from "../utils/binary.js";
import { getCrypto } from "./crypto.js";

/**
 * Generates a random secure token encoded as base64.
 * @param bytes - Number of random bytes to generate
 */
function randomSecureToken(bytes: number): string {
    return encodeBase64(getCrypto().randomBytes(bytes));
}

/**
 * Checks if a password has been set.
 */
export function isPasswordSet(): boolean {
    const sql = getSql();
    return !!sql.getValue("SELECT value FROM options WHERE name = 'passwordVerificationHash'");
}

/**
 * Changes the password from currentPassword to newPassword.
 * Re-encrypts the data key with the new password.
 */
export async function changePassword(
    currentPassword: string,
    newPassword: string
): Promise<ChangePasswordResponse> {
    if (!isPasswordSet()) {
        throw new Error("Password has not been set yet, so it cannot be changed. Use 'setPassword' instead.");
    }

    if (!(await passwordEncryptionService.verifyPassword(currentPassword))) {
        return {
            success: false,
            message: "Given current password doesn't match hash"
        };
    }

    const sql = getSql();
    const decryptedDataKey = await passwordEncryptionService.getDataKey(currentPassword);

    sql.transactional(() => {
        options.setOption("passwordVerificationSalt", randomSecureToken(32));
        options.setOption("passwordDerivedKeySalt", randomSecureToken(32));
    });

    const newPasswordVerificationKey = encodeBase64(
        await scryptService.getVerificationHash(newPassword)
    );

    if (decryptedDataKey) {
        await passwordEncryptionService.setDataKey(newPassword, decryptedDataKey);
    }

    options.setOption("passwordVerificationHash", newPasswordVerificationKey);

    return {
        success: true
    };
}

/**
 * Sets the initial password for a new installation.
 * Creates all necessary password-related options.
 */
export async function setPassword(password: string): Promise<ChangePasswordResponse> {
    if (isPasswordSet()) {
        throw new Error("Password is set already. Either change it or perform 'reset password' first.");
    }

    options.createOption("passwordVerificationSalt", randomSecureToken(32), true);
    options.createOption("passwordDerivedKeySalt", randomSecureToken(32), true);

    const passwordVerificationKey = encodeBase64(
        await scryptService.getVerificationHash(password)
    );
    options.createOption("passwordVerificationHash", passwordVerificationKey, true);

    // passwordEncryptionService expects these options to already exist
    options.createOption("encryptedDataKey", "", true);

    // Generate a random 16-byte data key and encrypt it with the password
    const randomDataKey = getCrypto().randomBytes(16);
    await passwordEncryptionService.setDataKey(password, randomDataKey);

    return {
        success: true
    };
}

/**
 * Resets the password by clearing all password-related options.
 * This should be used when the user has forgotten their password.
 * WARNING: This will make all protected notes inaccessible.
 */
export function resetPassword(): ChangePasswordResponse {
    const sql = getSql();
    sql.transactional(() => {
        options.setOption("passwordVerificationSalt", "");
        options.setOption("passwordDerivedKeySalt", "");
        options.setOption("encryptedDataKey", "");
        options.setOption("passwordVerificationHash", "");
    });

    return {
        success: true
    };
}

export default {
    isPasswordSet,
    changePassword,
    setPassword,
    resetPassword
};
