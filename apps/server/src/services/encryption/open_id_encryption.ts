import { data_encryption } from "@triliumnext/core";

import sql from "../sql.js";
import utils from "../utils.js";
import myScryptService from "./my_scrypt.js";

function saveUser(subjectIdentifier: string, name: string, email: string) {
    if (isUserSaved()) return false;

    const verificationSalt = utils.randomSecureToken(32);
    const derivedKeySalt = utils.randomSecureToken(32);

    const verificationHash = myScryptService.getSubjectIdentifierVerificationHash(
        subjectIdentifier,
        verificationSalt
    );

    const userIDEncryptedDataKey = setDataKey(
        subjectIdentifier,
        utils.randomSecureToken(16),
        verificationSalt
    );

    const data = {
        tmpID: 0,
        userIDVerificationHash: utils.toBase64(verificationHash),
        salt: verificationSalt,
        derivedKey: derivedKeySalt,
        userIDEncryptedDataKey,
        isSetup: "true",
        username: name,
        email
    };

    sql.upsert("user_data", "tmpID", data);
    return true;
}

function isSubjectIdentifierSaved() {
    const value = sql.getValue("SELECT userIDEncryptedDataKey FROM user_data;");
    if (value === undefined || value === null || value === "") return false;
    return true;
}

function isUserSaved() {
    const isSaved = sql.getValue<string>("SELECT isSetup FROM user_data;");
    return isSaved === "true";
}

function setDataKey(
    subjectIdentifier: string,
    plainTextDataKey: string | Buffer,
    salt: string
) {
    const subjectIdentifierDerivedKey =
        myScryptService.getSubjectIdentifierDerivedKey(subjectIdentifier, salt);

    return data_encryption.encrypt(subjectIdentifierDerivedKey, plainTextDataKey);
}

export default {
    setDataKey,
    saveUser,
    isSubjectIdentifierSaved,
};
