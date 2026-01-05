import { getLog } from "../log.js";
import { concat2, decodeBase64, decodeUtf8, encodeBase64 } from "../utils/binary.js";
import { getCrypto } from "./crypto.js";

function arraysIdentical(a: any[] | Uint8Array, b: any[] | Uint8Array) {
    let i = a.length;
    if (i !== b.length) return false;
    while (i--) {
        if (a[i] !== b[i]) return false;
    }
    return true;
}

function shaArray(content: string | Uint8Array) {
    // we use this as a simple checksum and don't rely on its security, so SHA-1 is good enough
    return getCrypto().createHash("sha1", content);
}

function pad(data: Uint8Array): Uint8Array {
    if (data.length > 16) {
        data = data.slice(0, 16);
    } else if (data.length < 16) {
        const zeros = Array(16 - data.length).fill(0);

        data = concat2(data, Uint8Array.from(zeros));
    }

    return Uint8Array.from(data);
}

function encrypt(key: Uint8Array, plainText: Uint8Array | string) {
    if (!key) {
        throw new Error("No data key!");
    }

    const plainTextUint8Array = ArrayBuffer.isView(plainText) ? plainText : Uint8Array.from(plainText);

    const iv = getCrypto().randomBytes(16);
    const cipher = getCrypto().createCipheriv("aes-128-cbc", pad(key), pad(iv));

    const digest = shaArray(plainTextUint8Array).slice(0, 4);

    const digestWithPayload = concat2(digest, plainTextUint8Array);

    const encryptedData = concat2(cipher.update(digestWithPayload), cipher.final());

    const encryptedDataWithIv = concat2(iv, encryptedData);

    return encodeBase64(encryptedDataWithIv);
}

function decrypt(key: Uint8Array, cipherText: string | Uint8Array): Uint8Array | false | null {
    if (cipherText === null) {
        return null;
    }

    if (!key) {
        return Uint8Array.from("[protected]");
    }

    try {
        const cipherTextStr = typeof cipherText === "string" ? cipherText : decodeUtf8(cipherText);
        const cipherTextUint8ArrayWithIv = decodeBase64(cipherTextStr);

        // old encrypted data can have IV of length 13, see some details here: https://github.com/zadam/trilium/issues/3017
        const ivLength = cipherTextUint8ArrayWithIv.length % 16 === 0 ? 16 : 13;

        const iv = cipherTextUint8ArrayWithIv.slice(0, ivLength);

        const cipherTextUint8Array = cipherTextUint8ArrayWithIv.slice(ivLength);

        const decipher = getCrypto().createDecipheriv("aes-128-cbc", pad(key), pad(iv));

        const decryptedBytes = concat2(decipher.update(cipherTextUint8Array), decipher.final());

        const digest = decryptedBytes.slice(0, 4);
        const payload = decryptedBytes.slice(4);

        const computedDigest = shaArray(payload).slice(0, 4);

        if (!arraysIdentical(digest, computedDigest)) {
            return false;
        }

        return payload;
    } catch (e: any) {
        // recovery from https://github.com/zadam/trilium/issues/510
        if (e.message?.includes("WRONG_FINAL_BLOCK_LENGTH") || e.message?.includes("wrong final block length")) {
            getLog().info("Caught WRONG_FINAL_BLOCK_LENGTH, returning cipherText instead");

            return (ArrayBuffer.isView(cipherText) ? cipherText : Uint8Array.from(cipherText));
        }
        throw e;
    }
}

function decryptString(dataKey: Uint8Array, cipherText: string) {
    const buffer = decrypt(dataKey, cipherText);

    if (buffer === null) {
        return null;
    } else if (buffer === false) {
        getLog().error(`Could not decrypt string. Uint8Array: ${buffer}`);

        throw new Error("Could not decrypt string.");
    }

    return decodeUtf8(buffer);
}

export default {
    encrypt,
    decrypt,
    decryptString
};
