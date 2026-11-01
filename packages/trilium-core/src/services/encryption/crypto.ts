export interface Cipher {
    update(data: Uint8Array): Uint8Array;
    final(): Uint8Array;
}

export interface ScryptOptions {
    /** CPU/memory cost parameter (default: 16384) */
    N?: number;
    /** Block size (default: 8) */
    r?: number;
    /** Parallelization (default: 1) */
    p?: number;
}

export interface CryptoProvider {
    createHash(algorithm: "md5" | "sha1" | "sha512", content: string | Uint8Array): Uint8Array;
    randomBytes(size: number): Uint8Array;
    randomString(length: number): string;
    createCipheriv(algorithm: "aes-128-cbc", key: Uint8Array, iv: Uint8Array): Cipher;
    createDecipheriv(algorithm: "aes-128-cbc", key: Uint8Array, iv: Uint8Array): Cipher;
    hmac(secret: string | Uint8Array, value: string | Uint8Array): string;

    /**
     * Derives a key from a password using the scrypt algorithm.
     * @param password - The password to derive from
     * @param salt - The salt to use
     * @param keyLength - The length of the derived key in bytes
     * @param options - Scrypt parameters (N, r, p)
     */
    scrypt(
        password: Uint8Array | string,
        salt: Uint8Array | string,
        keyLength: number,
        options?: ScryptOptions
    ): Promise<Uint8Array>;

    /**
     * Constant-time comparison of two byte arrays to prevent timing attacks.
     * @returns true if arrays are equal, false otherwise
     */
    constantTimeCompare(a: Uint8Array, b: Uint8Array): boolean;

    /**
     * Encodes raw bytes to a standard (RFC 4648) base64 string. Platform-optimized: server and
     * desktop use Node's native `Buffer`; standalone uses a chunked browser implementation.
     */
    base64Encode(bytes: Uint8Array): string;

    /** Decodes a standard (RFC 4648) base64 string back into raw bytes. */
    base64Decode(base64: string): Uint8Array;

    /**
     * Decodes a standard (RFC 4648) base64 string into a caller-provided buffer, returning the
     * number of bytes written. Optional — implemented where avoiding a fresh allocation per
     * decode matters (the browser/WASM build, whose renderer accumulates uncollected
     * ArrayBuffer backing stores during initial sync). The target must be at least
     * `(base64.length * 3) >> 2` bytes.
     */
    base64DecodeInto?(base64: string, target: Uint8Array): number;
}

let crypto: CryptoProvider | null = null;

export function initCrypto(cryptoProvider: CryptoProvider) {
    crypto = cryptoProvider;
}

export function getCrypto() {
    if (!crypto) throw new Error("Crypto not initialized.");
    return crypto;
}
