import optionService = require('../options.js');
import myScryptService = require('./my_scrypt.js');
import utils = require('../utils');
import dataEncryptionService = require('./data_encryption.js');

function verifyPassword(password: string) {
    const givenPasswordHash = utils.toBase64(myScryptService.getVerificationHash(password));

    const dbPasswordHash = optionService.getOptionOrNull('passwordVerificationHash');

    if (!dbPasswordHash) {
        return false;
    }

    return givenPasswordHash === dbPasswordHash;
}

function setDataKey(password: string, plainTextDataKey: string | Buffer) {
    const passwordDerivedKey = myScryptService.getPasswordDerivedKey(password);

    const newEncryptedDataKey = dataEncryptionService.encrypt(passwordDerivedKey, plainTextDataKey);

    optionService.setOption('encryptedDataKey', newEncryptedDataKey);
}

function getDataKey(password: string) {
    const passwordDerivedKey = myScryptService.getPasswordDerivedKey(password);

    const encryptedDataKey = optionService.getOption('encryptedDataKey');

    const decryptedDataKey = dataEncryptionService.decrypt(passwordDerivedKey, encryptedDataKey);

    return decryptedDataKey;
}

export = {
    verifyPassword,
    getDataKey,
    setDataKey
};
