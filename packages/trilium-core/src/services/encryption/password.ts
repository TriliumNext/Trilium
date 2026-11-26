import type { ChangePasswordResponse } from "@triliumnext/commons";
import events from "../events.js";
import options from "../options.js";
import protectedSessionService from "../protected_session.js";
import { getSql } from "../sql/index.js";
import scryptService from "./scrypt.js";
import passwordEncryptionService from "./password_encryption.js";
import dataEncryption from "./data_encryption.js";
import { encodeBase64 } from "../utils/binary.js";
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
 * Refuses when the data key does not open, and writes the four options in one transaction, so that
 * no failure leaves a data key that no password opens.
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

    const dataKey = await passwordEncryptionService.getDataKey(currentPassword);
    if (!dataKey) {
        return {
            success: false,
            message: "The key of protected notes cannot be read, so the password was not changed.",
            code: "data-key-unreadable"
        };
    }

    const verificationSalt = randomSecureToken(32);
    const derivedKeySalt = randomSecureToken(32);
    const verificationHash = encodeBase64(
        await scryptService.getScryptHash(newPassword, verificationSalt)
    );
    const passwordDerivedKey = await scryptService.getScryptHash(newPassword, derivedKeySalt);
    const encryptedDataKey = dataEncryption.encrypt(passwordDerivedKey, dataKey);

    getSql().transactional(() => {
        options.setOption("passwordVerificationSalt", verificationSalt);
        options.setOption("passwordDerivedKeySalt", derivedKeySalt);
        options.setOption("encryptedDataKey", encryptedDataKey);
        options.setOption("passwordVerificationHash", verificationHash);
    });

    leaveProtectedSession();

    return {
        success: true
    };
}

/**
 * Sets the initial password for a new installation.
 * Creates all necessary password-related options.
 *
 * When `encryptedDataKey` still holds a key, only the hash row was emptied, by a fault or by a sync
 * peer, without a reset: only the password that opens the key is accepted, and the key is kept.
 */
export async function setPassword(password: string): Promise<ChangePasswordResponse> {
    if (isPasswordSet()) {
        throw new Error("Password is set already. Either change it or perform 'reset password' first.");
    }

    if (options.getOptionOrNull("encryptedDataKey")) {
        return restorePassword(password);
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

/** Writes the hash and its salt again from a password that opens the stored data key. */
async function restorePassword(password: string): Promise<ChangePasswordResponse> {
    if (!(await passwordEncryptionService.getDataKey(password))) {
        return {
            success: false,
            message: "The password of this knowledge base was removed. Enter the password it had.",
            code: "password-not-restored"
        };
    }

    const verificationSalt = randomSecureToken(32);
    const verificationHash = encodeBase64(
        await scryptService.getScryptHash(password, verificationSalt)
    );
    getSql().transactional(() => {
        options.setOption("passwordVerificationSalt", verificationSalt);
        options.setOption("passwordVerificationHash", verificationHash);
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

function leaveProtectedSession() {
    if (protectedSessionService.isProtectedSessionAvailable()) {
        protectedSessionService.resetDataKey();
        events.emit(events.LEAVE_PROTECTED_SESSION);
        ws.sendMessageToAllClients({ type: "protectedSessionLogout" });
    }
}

let lastSeenPasswordHash: string | null = null;

/**
 * Ends the protected session of this backend when sync brings a different password hash, as a
 * change made here does, so that a password a peer set finds no data key in memory. A row with the
 * hash this backend last saw changes nothing, since sync applies every row of the same date.
 */
export function startProtectedSessionEndOnPasswordChange() {
    lastSeenPasswordHash = options.getOptionOrNull("passwordVerificationHash");

    events.subscribe(events.ENTITY_CHANGED, ({ entityName, entity }) => {
        if (entityName === "options" && entity.name === "passwordVerificationHash") {
            lastSeenPasswordHash = entity.value;
        }
    });

    events.subscribe(events.ENTITY_CHANGE_SYNCED, ({ entityName, entityRow }) => {
        if (entityName !== "options" || entityRow.name !== "passwordVerificationHash"
            || entityRow.value === lastSeenPasswordHash) {
            return;
        }

        lastSeenPasswordHash = entityRow.value;
        leaveProtectedSession();
    });
}

export default {
    isPasswordSet,
    changePassword,
    setPassword,
    resetPassword,
    startProtectedSessionEndOnPasswordChange
};
