import myScryptService from "./my_scrypt.js";
import utils, { constantTimeCompare } from "../utils.js";
import dataEncryptionService from "./data_encryption.js";
import sql from "../sql.js";
import sqlInit from "../sql_init.js";
import OpenIdError from "../../errors/open_id_error.js";

function saveUser(subjectIdentifier: string, name: string, email: string) {
    if (isUserSaved()) return false;

    const verificationSalt = utils.randomSecureToken(32);
    const derivedKeySalt = utils.randomSecureToken(32);

    const verificationHash = myScryptService.getSubjectIdentifierVerificationHash(
        subjectIdentifier,
        verificationSalt
    );
    if (!verificationHash) {
        throw new OpenIdError("Verification hash undefined!")
    }

    const userIDEncryptedDataKey = setDataKey(
        subjectIdentifier,
        utils.randomSecureToken(16),
        verificationSalt
    );

    if (!userIDEncryptedDataKey) {
        console.error("UserID encrypted data key null");
        return undefined;
    }

    const data = {
        tmpID: 0,
        userIDVerificationHash: utils.toBase64(verificationHash),
        salt: verificationSalt,
        derivedKey: derivedKeySalt,
        userIDEncryptedDataKey: userIDEncryptedDataKey,
        isSetup: "true",
        username: name,
        email: email
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
    return isSaved === "true" ? true : false;
}

function verifyOpenIDSubjectIdentifier(subjectIdentifier: string) {
    if (!sqlInit.isDbInitialized()) {
        throw new OpenIdError("Database not initialized!");
    }

    if (isUserSaved()) {
        return false;
    }

    const salt = sql.getValue("SELECT salt FROM user_data;");
    if (salt == undefined) {
        console.log("Salt undefined");
        return undefined;
    }

    const givenHash = myScryptService
        .getSubjectIdentifierVerificationHash(subjectIdentifier)
        ?.toString("base64");
    if (givenHash === undefined) {
        console.log("Sub id hash undefined!");
        return undefined;
    }

    const savedHash = sql.getValue(
        "SELECT userIDVerificationHash FROM user_data"
    );
    if (savedHash === undefined) {
        console.log("verification hash undefined");
        return undefined;
    }

    return constantTimeCompare(givenHash, savedHash as string);
}

function setDataKey(
    subjectIdentifier: string,
    plainTextDataKey: string | Buffer,
    salt: string
) {
    const subjectIdentifierDerivedKey =
        myScryptService.getSubjectIdentifierDerivedKey(subjectIdentifier, salt);

    if (subjectIdentifierDerivedKey === undefined) {
        console.error("SOMETHING WENT WRONG SAVING USER ID DERIVED KEY");
        return undefined;
    }
    const newEncryptedDataKey = dataEncryptionService.encrypt(
        subjectIdentifierDerivedKey,
        plainTextDataKey
    );

    return newEncryptedDataKey;
}

function getDataKey(subjectIdentifier: string) {
    const subjectIdentifierDerivedKey =
        myScryptService.getSubjectIdentifierDerivedKey(subjectIdentifier);

    const encryptedDataKey = sql.getValue(
        "SELECT userIDEncryptedDataKey FROM user_data"
    );

    if (!encryptedDataKey) {
        console.error("Encrypted data key empty!");
        return undefined;
    }

    if (!subjectIdentifierDerivedKey) {
        console.error("SOMETHING WENT WRONG SAVING USER ID DERIVED KEY");
        return undefined;
    }
    const decryptedDataKey = dataEncryptionService.decrypt(
        subjectIdentifierDerivedKey,
        encryptedDataKey.toString()
    );

    return decryptedDataKey;
}

export default {
    verifyOpenIDSubjectIdentifier,
    getDataKey,
    setDataKey,
    saveUser,
    isSubjectIdentifierSaved,
};
