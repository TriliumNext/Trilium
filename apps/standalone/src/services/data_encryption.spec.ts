import { describe, it, expect } from "vitest";
import { data_encryption } from "@triliumnext/core";

// Note: BrowserCryptoProvider is already initialized via test_setup.ts

describe("data_encryption with BrowserCryptoProvider", () => {
    it("should encrypt and decrypt ASCII text correctly", () => {
        const key = new Uint8Array(16).fill(42);
        const plainText = "Hello, World!";

        const encrypted = data_encryption.encrypt(key, plainText);
        expect(typeof encrypted).toBe("string");
        expect(encrypted.length).toBeGreaterThan(0);

        const decrypted = data_encryption.decryptString(key, encrypted);
        expect(decrypted).toBe(plainText);
    });

    it("should encrypt and decrypt UTF-8 text correctly", () => {
        const key = new Uint8Array(16).fill(42);
        const plainText = "Привет мир! 你好世界! 🎉";

        const encrypted = data_encryption.encrypt(key, plainText);
        const decrypted = data_encryption.decryptString(key, encrypted);
        expect(decrypted).toBe(plainText);
    });

    it("should encrypt and decrypt empty string", () => {
        const key = new Uint8Array(16).fill(42);
        const plainText = "";

        const encrypted = data_encryption.encrypt(key, plainText);
        const decrypted = data_encryption.decryptString(key, encrypted);
        expect(decrypted).toBe(plainText);
    });

    it("should encrypt and decrypt binary data", () => {
        const key = new Uint8Array(16).fill(42);
        const plainData = new Uint8Array([0, 1, 2, 255, 128, 64]);

        const encrypted = data_encryption.encrypt(key, plainData);
        const decrypted = data_encryption.decrypt(key, encrypted);
        expect(decrypted).toBeInstanceOf(Uint8Array);
        expect(Array.from(decrypted as Uint8Array)).toEqual(Array.from(plainData));
    });

    it("should fail decryption with wrong key", () => {
        const key1 = new Uint8Array(16).fill(42);
        const key2 = new Uint8Array(16).fill(43);
        const plainText = "Secret message";

        const encrypted = data_encryption.encrypt(key1, plainText);

        // decrypt returns false when digest doesn't match
        const result = data_encryption.decrypt(key2, encrypted);
        expect(result).toBe(false);
    });

    it("should handle large content", () => {
        const key = new Uint8Array(16).fill(42);
        const plainText = "x".repeat(100000);

        const encrypted = data_encryption.encrypt(key, plainText);
        const decrypted = data_encryption.decryptString(key, encrypted);
        expect(decrypted).toBe(plainText);
    });
});
