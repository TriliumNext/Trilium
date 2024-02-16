"use strict";

import log = require('./log');
import dataEncryptionService = require('./encryption/data_encryption');

let dataKey: Buffer | null = null;

function setDataKey(decryptedDataKey: Buffer) {
    dataKey = Buffer.from(decryptedDataKey);
}

function getDataKey() {
    return dataKey;
}

function resetDataKey() {
    dataKey = null;
}

function isProtectedSessionAvailable() {
    return !!dataKey;
}

function encrypt(plainText: string | Buffer) {
    const dataKey = getDataKey();
    if (plainText === null || dataKey === null) {
        return null;
    }

    return dataEncryptionService.encrypt(dataKey, plainText);
}

function decrypt(cipherText: string | Buffer) {
    const dataKey = getDataKey();
    if (cipherText === null || dataKey === null) {
        return null;
    }

    return dataEncryptionService.decrypt(dataKey, cipherText);
}

function decryptString(cipherText: string) {
    const dataKey = getDataKey();
    if (dataKey === null) {
        return null;
    }
    return dataEncryptionService.decryptString(dataKey, cipherText);
}

let lastProtectedSessionOperationDate: number | null = null;

function touchProtectedSession() {
    if (isProtectedSessionAvailable()) {
        lastProtectedSessionOperationDate = Date.now();
    }
}

function checkProtectedSessionExpiration() {
    const options = require('./options.js');
    const protectedSessionTimeout = options.getOptionInt('protectedSessionTimeout');
    if (isProtectedSessionAvailable()
        && lastProtectedSessionOperationDate
        && Date.now() - lastProtectedSessionOperationDate > protectedSessionTimeout * 1000) {

        resetDataKey();

        log.info("Expiring protected session");

        require('./ws.js').reloadFrontend("leaving protected session");
    }
}

module.exports = {
    setDataKey,
    resetDataKey,
    isProtectedSessionAvailable,
    encrypt,
    decrypt,
    decryptString,
    touchProtectedSession,
    checkProtectedSessionExpiration
};
