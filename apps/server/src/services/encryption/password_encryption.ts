import { data_encryption } from "@triliumnext/core";

import optionService from "../options.js";
import { constantTimeCompare,toBase64 } from "../utils.js";
import myScryptService from "./my_scrypt.js";

function verifyPassword(password: string) {
    const givenPasswordHash = toBase64(myScryptService.getVerificationHash(password));

    const dbPasswordHash = optionService.getOptionOrNull("passwordVerificationHash");

    if (!dbPasswordHash) {
        return false;
    }

    return constantTimeCompare(givenPasswordHash, dbPasswordHash);
}

function setDataKey(password: string, plainTextDataKey: string | Buffer | Uint8Array) {
    const passwordDerivedKey = myScryptService.getPasswordDerivedKey(password);

    const newEncryptedDataKey = data_encryption.encrypt(passwordDerivedKey, plainTextDataKey);

    optionService.setOption("encryptedDataKey", newEncryptedDataKey);
}

function getDataKey(password: string) {
    const passwordDerivedKey = myScryptService.getPasswordDerivedKey(password);

    const encryptedDataKey = optionService.getOption("encryptedDataKey");

    const decryptedDataKey = data_encryption.decrypt(passwordDerivedKey, encryptedDataKey);

    return decryptedDataKey;
}

export default {
    verifyPassword,
    getDataKey,
    setDataKey
};
