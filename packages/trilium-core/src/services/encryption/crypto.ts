interface Cipher {
    update(data: Uint8Array): Uint8Array;
    final(): Uint8Array;
}

export interface CryptoProvider {

    createHash(algorithm: "sha1", content: string | Uint8Array): Uint8Array;
    randomBytes(size: number): Uint8Array;
    createCipheriv(algorithm: "aes-128-cbc", key: Uint8Array, iv: Uint8Array): Cipher;
    createDecipheriv(algorithm: "aes-128-cbc", key: Uint8Array, iv: Uint8Array): Cipher;
}

let crypto: CryptoProvider | null = null;

export function initCrypto(cryptoProvider: CryptoProvider) {
    crypto = cryptoProvider;
}

export function getCrypto() {
    if (!crypto) throw new Error("Crypto not initialized.");
    return crypto;
}
