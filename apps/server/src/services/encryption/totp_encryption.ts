import optionService from "../options.js";
import myScryptService from "./my_scrypt.js";
import { randomSecureToken, toBase64, constantTimeCompare } from "../utils.js";
import dataEncryptionService from "./data_encryption.js";
import type { OptionNames } from "@triliumnext/commons";

const TOTP_OPTIONS: Record<string, OptionNames> = {
    SALT: "totpEncryptionSalt",
    ENCRYPTED_SECRET: "totpEncryptedSecret",
    VERIFICATION_HASH: "totpVerificationHash"
};

function verifyTotpSecret(secret: string): boolean {
    const givenSecretHash = toBase64(myScryptService.getVerificationHash(secret));
    const dbSecretHash = optionService.getOptionOrNull(TOTP_OPTIONS.VERIFICATION_HASH);

    if (!dbSecretHash) {
        return false;
    }

    return constantTimeCompare(givenSecretHash, dbSecretHash);
}

function setTotpSecret(secret: string) {
    if (!secret) {
        throw new Error("TOTP secret cannot be empty");
    }

    const encryptionSalt = randomSecureToken(32);
    optionService.setOption(TOTP_OPTIONS.SALT, encryptionSalt);

    const verificationHash = toBase64(myScryptService.getVerificationHash(secret));
    optionService.setOption(TOTP_OPTIONS.VERIFICATION_HASH, verificationHash);

    const encryptedSecret = dataEncryptionService.encrypt(
        Buffer.from(encryptionSalt),
        secret
    );
    optionService.setOption(TOTP_OPTIONS.ENCRYPTED_SECRET, encryptedSecret);
}

function getTotpSecret(): string | null {
    const encryptionSalt = optionService.getOptionOrNull(TOTP_OPTIONS.SALT);
    const encryptedSecret = optionService.getOptionOrNull(TOTP_OPTIONS.ENCRYPTED_SECRET);

    if (!encryptionSalt || !encryptedSecret) {
        return null;
    }

    try {
        const decryptedSecret = dataEncryptionService.decrypt(
            Buffer.from(encryptionSalt),
            encryptedSecret
        );

        if (!decryptedSecret) {
            return null;
        }

        return decryptedSecret.toString();
    } catch (e) {
        console.error("Failed to decrypt TOTP secret:", e);
        return null;
    }
}

function resetTotpSecret() {
    optionService.setOption(TOTP_OPTIONS.SALT, "");
    optionService.setOption(TOTP_OPTIONS.ENCRYPTED_SECRET, "");
    optionService.setOption(TOTP_OPTIONS.VERIFICATION_HASH, "");
}

function isTotpSecretSet(): boolean {
    return !!optionService.getOptionOrNull(TOTP_OPTIONS.VERIFICATION_HASH);
}

export default {
    verifyTotpSecret,
    setTotpSecret,
    getTotpSecret,
    resetTotpSecret,
    isTotpSecretSet
};
