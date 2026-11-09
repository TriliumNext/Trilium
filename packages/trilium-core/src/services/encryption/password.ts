import type { ChangePasswordResponse } from "@triliumnext/commons";
import { t } from "i18next";
import events from "../events.js";
import options from "../options.js";
import protectedSessionService from "../protected_session.js";
import { getSql } from "../sql/index.js";
import scryptService from "./scrypt.js";
import data_encryption from "./data_encryption.js";
import { encodeBase64, encodeUtf8 } from "../utils/binary.js";
import { getCrypto } from "./crypto.js";
import ws from "../ws.js";

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
 * Re-encrypts the data key with the new password and closes the protected session.
 *
 * Every key is derived from one snapshot of the password options and the result is written in one
 * transaction, which fails the change when another one has committed since the snapshot. Without
 * that, two overlapping changes can each store salts that belong to the other's hash.
 */
export async function changePassword(
    currentPassword: string,
    newPassword: string
): Promise<ChangePasswordResponse> {
    if (!isPasswordSet()) {
        throw new Error("Password has not been set yet, so it cannot be changed. Use 'setPassword' instead.");
    }

    const stored = readPasswordOptions();
    const currentHash = encodeBase64(
        await scryptService.getScryptHash(currentPassword, stored.passwordVerificationSalt)
    );

    if (!getCrypto().constantTimeCompare(encodeUtf8(currentHash), encodeUtf8(stored.passwordVerificationHash))) {
        return {
            success: false,
            message: "Given current password doesn't match hash"
        };
    }

    const currentDerivedKey = await scryptService.getScryptHash(currentPassword, stored.passwordDerivedKeySalt);
    const dataKey = data_encryption.decrypt(currentDerivedKey, stored.encryptedDataKey);
    const next = await derivePasswordOptions(newPassword, dataKey || null, stored.encryptedDataKey);

    const result = getSql().transactional((): ChangePasswordResponse => {
        const now = readPasswordOptions();

        if (PASSWORD_OPTIONS.some((name) => now[name] !== stored[name])) {
            return {
                success: false,
                message: t("password.changed-concurrently")
            };
        }

        for (const name of PASSWORD_OPTIONS) {
            options.setOption(name, next[name]);
        }

        return {
            success: true
        };
    });

    if (result.success && protectedSessionService.isProtectedSessionAvailable()) {
        protectedSessionService.resetDataKey();
        events.emit(events.LEAVE_PROTECTED_SESSION);
        ws.sendMessageToAllClients({ type: "protectedSessionLogout" });
    }

    return result;
}

/**
 * Sets the initial password for a new installation.
 * Creates all necessary password-related options.
 */
export async function setPassword(password: string): Promise<ChangePasswordResponse> {
    if (isPasswordSet()) {
        throw new Error(PASSWORD_SET_ALREADY);
    }

    // Generate a random 16-byte data key and encrypt it with the password
    const next = await derivePasswordOptions(password, getCrypto().randomBytes(16), "");

    getSql().transactional(() => {
        // Another request can have set a password while the keys were derived.
        if (isPasswordSet()) {
            throw new Error(PASSWORD_SET_ALREADY);
        }

        for (const name of PASSWORD_OPTIONS) {
            options.createOption(name, next[name], true);
        }
    });

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

const PASSWORD_OPTIONS = [
    "passwordVerificationSalt",
    "passwordDerivedKeySalt",
    "passwordVerificationHash",
    "encryptedDataKey"
] as const;

type PasswordOptions = Record<(typeof PASSWORD_OPTIONS)[number], string>;

const PASSWORD_SET_ALREADY = "Password is set already. Either change it or perform 'reset password' first.";

function readPasswordOptions(): PasswordOptions {
    return {
        passwordVerificationSalt: options.getOption("passwordVerificationSalt"),
        passwordDerivedKeySalt: options.getOption("passwordDerivedKeySalt"),
        passwordVerificationHash: options.getOption("passwordVerificationHash"),
        encryptedDataKey: options.getOption("encryptedDataKey")
    };
}

/**
 * Derives the password options for `password` under fresh salts, from arguments alone. Without a
 * data key, `encryptedDataKey` is kept as it is.
 */
async function derivePasswordOptions(
    password: string,
    dataKey: Uint8Array | null,
    encryptedDataKey: string
): Promise<PasswordOptions> {
    const passwordVerificationSalt = randomSecureToken(32);
    const passwordDerivedKeySalt = randomSecureToken(32);
    const verificationHash = await scryptService.getScryptHash(password, passwordVerificationSalt);
    const derivedKey = await scryptService.getScryptHash(password, passwordDerivedKeySalt);

    return {
        passwordVerificationSalt,
        passwordDerivedKeySalt,
        passwordVerificationHash: encodeBase64(verificationHash),
        encryptedDataKey: dataKey ? data_encryption.encrypt(derivedKey, dataKey) : encryptedDataKey
    };
}

export default {
    isPasswordSet,
    changePassword,
    setPassword,
    resetPassword
};
