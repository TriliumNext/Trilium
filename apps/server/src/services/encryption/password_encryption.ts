import optionService from "../options.js";
import myScryptService from "./my_scrypt.js";
import { toBase64, constantTimeCompare } from "../utils.js";
import dataEncryptionService from "./data_encryption.js";

function verifyPassword(password: string) {
    const givenPasswordHash = toBase64(myScryptService.getVerificationHash(password));

    const dbPasswordHash = optionService.getOptionOrNull("passwordVerificationHash");

    if (!dbPasswordHash) {
        return false;
    }

    return constantTimeCompare(givenPasswordHash, dbPasswordHash);
}

function setDataKey(password: string, plainTextDataKey: string | Buffer) {
    const passwordDerivedKey = myScryptService.getPasswordDerivedKey(password);

    const newEncryptedDataKey = dataEncryptionService.encrypt(passwordDerivedKey, plainTextDataKey);

    optionService.setOption("encryptedDataKey", newEncryptedDataKey);
}

function getDataKey(password: string) {
    const passwordDerivedKey = myScryptService.getPasswordDerivedKey(password);

    const encryptedDataKey = optionService.getOption("encryptedDataKey");

    const decryptedDataKey = dataEncryptionService.decrypt(passwordDerivedKey, encryptedDataKey);

    return decryptedDataKey;
}

export default {
    verifyPassword,
    getDataKey,
    setDataKey
};
