import { describe, expect, it } from "vitest";
import aesjs from "aes-js";

import BrowserCryptoProvider from "./crypto_provider.js";

const provider = new BrowserCryptoProvider();

describe("BrowserCryptoProvider hashing", () => {
    it("produces fixed-length digests for md5/sha1/sha512", () => {
        expect(provider.createHash("md5", "hello")).toHaveLength(16);
        expect(provider.createHash("sha1", "hello")).toHaveLength(20);
        expect(provider.createHash("sha512", "hello")).toHaveLength(64);
    });

    it("accepts Uint8Array input", () => {
        const bytes = new Uint8Array([1, 2, 3]);
        expect(provider.createHash("md5", bytes)).toHaveLength(16);
    });

    it("hmac returns a base64 string", () => {
        const mac = provider.hmac("secret", "value");
        expect(typeof mac).toBe("string");
        // base64 of a 32-byte sha256 digest is 44 chars
        expect(mac).toHaveLength(44);
    });
});

describe("BrowserCryptoProvider random helpers", () => {
    it("randomBytes returns the requested size", () => {
        expect(provider.randomBytes(8)).toHaveLength(8);
    });

    it("randomString returns the requested length using the allowed alphabet", () => {
        const str = provider.randomString(20);
        expect(str).toHaveLength(20);
        expect(str).toMatch(/^[0-9A-Za-z]+$/);
    });
});

describe("BrowserCryptoProvider constantTimeCompare", () => {
    it("returns true for equal arrays", () => {
        expect(provider.constantTimeCompare(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 3]))).toBe(true);
    });

    it("returns false for different lengths", () => {
        expect(provider.constantTimeCompare(new Uint8Array([1, 2]), new Uint8Array([1, 2, 3]))).toBe(false);
    });

    it("returns false for same-length differing content", () => {
        expect(provider.constantTimeCompare(new Uint8Array([1, 2, 3]), new Uint8Array([1, 2, 4]))).toBe(false);
    });
});

describe("BrowserCryptoProvider scrypt", () => {
    it("derives a key of the requested length", async () => {
        const key = await provider.scrypt("password", "salt", 16, { N: 16, r: 1, p: 1 });
        expect(key).toHaveLength(16);
    });

    it("uses default scrypt parameters when none are supplied", async () => {
        const key = await provider.scrypt(new Uint8Array([1]), new Uint8Array([2]), 8, { N: 2 });
        expect(key).toHaveLength(8);
    });
});

describe("AesJsCipher (via createCipheriv/createDecipheriv)", () => {
    const key = new Uint8Array(16).fill(7);
    const iv = new Uint8Array(16).fill(9);

    it("round-trips data through encryption and decryption", () => {
        const plain = new TextEncoder().encode("the quick brown fox");

        const cipher = provider.createCipheriv("aes-128-cbc", key, iv);
        cipher.update(plain);
        const encrypted = cipher.final();

        const decipher = provider.createDecipheriv("aes-128-cbc", key, iv);
        decipher.update(encrypted);
        const decrypted = decipher.final();

        expect(new TextDecoder().decode(decrypted)).toBe("the quick brown fox");
    });

    it("throws when update() is called after final()", () => {
        const cipher = provider.createCipheriv("aes-128-cbc", key, iv);
        cipher.update(new Uint8Array([1]));
        cipher.final();
        expect(() => cipher.update(new Uint8Array([2]))).toThrow("Cipher has already been finalized");
    });

    it("throws when final() is called twice", () => {
        const cipher = provider.createCipheriv("aes-128-cbc", key, iv);
        cipher.final();
        expect(() => cipher.final()).toThrow("Cipher has already been finalized");
    });

    it("returns decrypted bytes unchanged when the trailing padding byte is invalid", () => {
        // Craft a single raw block whose decrypted last byte is 0 (an invalid
        // PKCS7 padding length), exercising the non-stripping branch in final().
        const plain = new Uint8Array(16).fill(65);
        plain[15] = 0;
        const rawCipher = new Uint8Array(
            new aesjs.ModeOfOperation.cbc(Array.from(key), Array.from(iv)).encrypt(plain)
        );

        const decipher = provider.createDecipheriv("aes-128-cbc", key, iv);
        decipher.update(rawCipher);
        const out = decipher.final();

        expect(out).toHaveLength(16);
        expect(out[15]).toBe(0);
    });
});
