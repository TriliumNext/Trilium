import type { CryptoProvider } from "@triliumnext/core";
import { sha1 } from "js-sha1";
import { sha512 } from "js-sha512";

interface Cipher {
    update(data: Uint8Array): Uint8Array;
    final(): Uint8Array;
}

const CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

/**
 * Crypto provider for browser environments using the Web Crypto API.
 */
export default class BrowserCryptoProvider implements CryptoProvider {

    createHash(algorithm: "sha1" | "sha512", content: string | Uint8Array): Uint8Array {
        const data = typeof content === "string" ? content :
                new TextDecoder().decode(content);

        const hexHash = algorithm === "sha1" ? sha1(data) : sha512(data);

        // Convert hex string to Uint8Array
        const bytes = new Uint8Array(hexHash.length / 2);
        for (let i = 0; i < hexHash.length; i += 2) {
            bytes[i / 2] = parseInt(hexHash.substr(i, 2), 16);
        }
        return bytes;
    }

    createCipheriv(algorithm: "aes-128-cbc", key: Uint8Array, iv: Uint8Array): Cipher {
        // Web Crypto API doesn't support streaming cipher like Node.js
        // We need to implement a wrapper that collects data and encrypts on final()
        return new WebCryptoCipher(algorithm, key, iv, "encrypt");
    }

    createDecipheriv(algorithm: "aes-128-cbc", key: Uint8Array, iv: Uint8Array): Cipher {
        return new WebCryptoCipher(algorithm, key, iv, "decrypt");
    }

    randomBytes(size: number): Uint8Array {
        const bytes = new Uint8Array(size);
        crypto.getRandomValues(bytes);
        return bytes;
    }

    randomString(length: number): string {
        const bytes = this.randomBytes(length);
        let result = "";
        for (let i = 0; i < length; i++) {
            result += CHARS[bytes[i] % CHARS.length];
        }
        return result;
    }
}

/**
 * A cipher implementation that wraps Web Crypto API.
 * Note: This buffers all data until final() is called, which differs from
 * Node.js's streaming cipher behavior.
 */
class WebCryptoCipher implements Cipher {
    private chunks: Uint8Array[] = [];
    private algorithm: string;
    private key: Uint8Array;
    private iv: Uint8Array;
    private mode: "encrypt" | "decrypt";
    private finalized = false;

    constructor(
        algorithm: "aes-128-cbc",
        key: Uint8Array,
        iv: Uint8Array,
        mode: "encrypt" | "decrypt"
    ) {
        this.algorithm = algorithm;
        this.key = key;
        this.iv = iv;
        this.mode = mode;
    }

    update(data: Uint8Array): Uint8Array {
        if (this.finalized) {
            throw new Error("Cipher has already been finalized");
        }
        // Buffer the data - Web Crypto doesn't support streaming
        this.chunks.push(data);
        // Return empty array since we process everything in final()
        return new Uint8Array(0);
    }

    final(): Uint8Array {
        if (this.finalized) {
            throw new Error("Cipher has already been finalized");
        }
        this.finalized = true;

        // Web Crypto API is async, but we need sync behavior
        // This is a fundamental limitation that requires architectural changes
        // For now, throw an error directing users to use async methods
        throw new Error(
            "Synchronous cipher finalization not available in browser. " +
            "The Web Crypto API is async-only. Use finalizeAsync() instead."
        );
    }

    /**
     * Async version that actually performs the encryption/decryption.
     */
    async finalizeAsync(): Promise<Uint8Array> {
        if (this.finalized) {
            throw new Error("Cipher has already been finalized");
        }
        this.finalized = true;

        // Concatenate all chunks
        const totalLength = this.chunks.reduce((sum, chunk) => sum + chunk.length, 0);
        const data = new Uint8Array(totalLength);
        let offset = 0;
        for (const chunk of this.chunks) {
            data.set(chunk, offset);
            offset += chunk.length;
        }

        // Copy key and iv to ensure they're plain ArrayBuffer-backed
        const keyBuffer = new Uint8Array(this.key);
        const ivBuffer = new Uint8Array(this.iv);

        // Import the key
        const cryptoKey = await crypto.subtle.importKey(
            "raw",
            keyBuffer,
            { name: "AES-CBC" },
            false,
            [this.mode]
        );

        // Perform encryption/decryption
        const result = this.mode === "encrypt"
            ? await crypto.subtle.encrypt({ name: "AES-CBC", iv: ivBuffer }, cryptoKey, data)
            : await crypto.subtle.decrypt({ name: "AES-CBC", iv: ivBuffer }, cryptoKey, data);

        return new Uint8Array(result);
    }
}
