import sql from "../sql.js";
import optionService from "../options.js";
import myScryptService from "./my_scrypt.js";
import { randomSecureToken, toBase64 } from "../utils.js";
import passwordEncryptionService from "./password_encryption.js";
import { ChangePasswordResponse } from "@triliumnext/commons";

function isPasswordSet() {
    return !!sql.getValue("SELECT value FROM options WHERE name = 'passwordVerificationHash'");
}

function changePassword(currentPassword: string, newPassword: string): ChangePasswordResponse {
    if (!isPasswordSet()) {
        throw new Error("Password has not been set yet, so it cannot be changed. Use 'setPassword' instead.");
    }

    if (!passwordEncryptionService.verifyPassword(currentPassword)) {
        return {
            success: false,
            message: "Given current password doesn't match hash"
        };
    }

    sql.transactional(() => {
        const decryptedDataKey = passwordEncryptionService.getDataKey(currentPassword);

        optionService.setOption("passwordVerificationSalt", randomSecureToken(32));
        optionService.setOption("passwordDerivedKeySalt", randomSecureToken(32));

        const newPasswordVerificationKey = toBase64(myScryptService.getVerificationHash(newPassword));

        if (decryptedDataKey) {
            // TODO: what should happen if the decrypted data key is null?
            passwordEncryptionService.setDataKey(newPassword, decryptedDataKey);
        }

        optionService.setOption("passwordVerificationHash", newPasswordVerificationKey);
    });

    return {
        success: true
    };
}

function setPassword(password: string): ChangePasswordResponse {
    if (isPasswordSet()) {
        throw new Error("Password is set already. Either change it or perform 'reset password' first.");
    }

    optionService.createOption("passwordVerificationSalt", randomSecureToken(32), true);
    optionService.createOption("passwordDerivedKeySalt", randomSecureToken(32), true);

    const passwordVerificationKey = toBase64(myScryptService.getVerificationHash(password));
    optionService.createOption("passwordVerificationHash", passwordVerificationKey, true);

    // passwordEncryptionService expects these options to already exist
    optionService.createOption("encryptedDataKey", "", true);

    passwordEncryptionService.setDataKey(password, randomSecureToken(16));

    return {
        success: true
    };
}

function resetPassword() {
    // user forgot the password,
    sql.transactional(() => {
        optionService.setOption("passwordVerificationSalt", "");
        optionService.setOption("passwordDerivedKeySalt", "");
        optionService.setOption("encryptedDataKey", "");
        optionService.setOption("passwordVerificationHash", "");
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
