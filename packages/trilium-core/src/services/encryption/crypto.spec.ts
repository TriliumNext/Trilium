import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";

import { decodeUtf8, encodeUtf8 } from "../utils/binary.js";
import { type CryptoProvider, getCrypto, initCrypto } from "./crypto.js";

// The global server spec setup (apps/server/spec/setup.ts) calls initializeCore,
// which calls initCrypto(new NodejsCryptoProvider()). So getCrypto() returns the
// real Node.js-backed provider here. No DB/becca/CLS is involved.
//
// `crypto` is a module-level singleton shared across this whole spec file. The
// provider is installed in the global beforeAll, so it must only be read inside
// hooks/tests (not at describe-collection time). Tests that swap the provider via
// initCrypto() restore the original in afterEach so the rest of the file keeps
// seeing the real provider.

// scrypt (N=16384) runs in pure JS (scrypt-js) under the browser provider, which is
// ~10x slower under V8 coverage instrumentation than Node's native scryptSync. Give the
// standalone (happy-dom) suite a larger timeout; the server suite keeps the strict
// default. The derived bytes are identical across runtimes — only the speed differs.
const isBrowserRuntime = typeof window !== "undefined";
if (isBrowserRuntime) {
    vi.setConfig({ testTimeout: 60000, hookTimeout: 60000 });
}

describe("crypto registry", () => {
    let original: CryptoProvider;

    beforeAll(() => {
        original = getCrypto();
    });

    afterEach(() => {
        // Restore whatever the global setup wired up so provider swaps don't leak.
        initCrypto(original);
    });

    describe("getCrypto / initCrypto", () => {
        it("returns the provider installed by initializeCore (the real Node.js provider)", () => {
            const provider = getCrypto();
            expect(provider).toBe(original);
            expect(typeof provider.createHash).toBe("function");
            expect(typeof provider.randomBytes).toBe("function");
            expect(typeof provider.hmac).toBe("function");
            expect(typeof provider.scrypt).toBe("function");
            expect(typeof provider.constantTimeCompare).toBe("function");
        });

        it("initCrypto replaces the active provider returned by getCrypto", () => {
            const stub = { tag: "stub-provider" } as unknown as CryptoProvider;

            initCrypto(stub);
            expect(getCrypto()).toBe(stub);

            initCrypto(original);
            expect(getCrypto()).toBe(original);
        });

        it("returns the same singleton instance on repeated calls", () => {
            expect(getCrypto()).toBe(getCrypto());
        });
    });
});

// The behavioural surface of this module is the CryptoProvider contract it hands
// out via getCrypto(). Exercising the wired-up provider proves the registry hands
// back a working implementation and locks the documented behaviour of each method.
describe("CryptoProvider behaviour (wired-up provider)", () => {
    let crypto: CryptoProvider;

    beforeAll(() => {
        crypto = getCrypto();
    });

    describe("createHash", () => {
        it("is deterministic and produces algorithm-specific digest lengths", () => {
            const md5a = crypto.createHash("md5", "hello");
            const md5b = crypto.createHash("md5", "hello");
            expect(Array.from(md5a)).toEqual(Array.from(md5b));
            expect(md5a.length).toBe(16);

            expect(crypto.createHash("sha1", "hello").length).toBe(20);
            expect(crypto.createHash("sha512", "hello").length).toBe(64);
        });

        it("produces different digests for different content and accepts Uint8Array input", () => {
            const fromString = crypto.createHash("sha512", "hello");
            const fromBytes = crypto.createHash("sha512", encodeUtf8("hello"));
            expect(Array.from(fromString)).toEqual(Array.from(fromBytes));

            const other = crypto.createHash("sha512", "world");
            expect(Array.from(fromString)).not.toEqual(Array.from(other));
        });
    });

    describe("randomBytes / randomString", () => {
        it("returns the requested number of bytes and varies between calls", () => {
            const a = crypto.randomBytes(16);
            const b = crypto.randomBytes(16);
            expect(a.length).toBe(16);
            expect(b.length).toBe(16);
            // Two 16-byte random draws colliding is astronomically unlikely.
            expect(Array.from(a)).not.toEqual(Array.from(b));

            expect(crypto.randomBytes(0).length).toBe(0);
        });

        it("returns a non-empty random string that differs between calls", () => {
            const s1 = crypto.randomString(32);
            const s2 = crypto.randomString(32);
            expect(typeof s1).toBe("string");
            expect(s1.length).toBeGreaterThan(0);
            expect(s1).not.toBe(s2);
        });
    });

    describe("createCipheriv / createDecipheriv", () => {
        it("round-trips data through aes-128-cbc", () => {
            const key = crypto.randomBytes(16);
            const iv = crypto.randomBytes(16);
            const plaintext = encodeUtf8("a secret message");

            const cipher = crypto.createCipheriv("aes-128-cbc", key, iv);
            const encrypted = Uint8Array.from([
                ...cipher.update(plaintext),
                ...cipher.final()
            ]);
            expect(encrypted.length).toBeGreaterThan(0);
            expect(Array.from(encrypted)).not.toEqual(Array.from(plaintext));

            const decipher = crypto.createDecipheriv("aes-128-cbc", key, iv);
            const decrypted = Uint8Array.from([
                ...decipher.update(encrypted),
                ...decipher.final()
            ]);
            expect(decodeUtf8(decrypted)).toBe("a secret message");
        });

        it("fails to recover the plaintext with the wrong key", () => {
            const key = crypto.randomBytes(16);
            const wrongKey = crypto.randomBytes(16);
            const iv = crypto.randomBytes(16);

            const cipher = crypto.createCipheriv("aes-128-cbc", key, iv);
            const encrypted = Uint8Array.from([
                ...cipher.update(encodeUtf8("top secret")),
                ...cipher.final()
            ]);

            let recovered: string | null = null;
            try {
                const decipher = crypto.createDecipheriv("aes-128-cbc", wrongKey, iv);
                recovered = decodeUtf8(
                    Uint8Array.from([...decipher.update(encrypted), ...decipher.final()])
                );
            } catch {
                recovered = null;
            }
            expect(recovered).not.toBe("top secret");
        });
    });

    describe("hmac", () => {
        it("is deterministic, base64-encoded, and key/value sensitive", () => {
            const a = crypto.hmac("secret", "message");
            const b = crypto.hmac("secret", "message");
            expect(a).toBe(b);
            // base64 output decodes back to a 32-byte sha256 digest.
            expect(/^[A-Za-z0-9+/]+=*$/.test(a)).toBe(true);

            expect(crypto.hmac("other-secret", "message")).not.toBe(a);
            expect(crypto.hmac("secret", "different")).not.toBe(a);
        });

        it("accepts a Uint8Array secret/value and stays deterministic", () => {
            // Whether Uint8Array inputs collide with their string equivalents is a
            // provider-specific implementation detail (they differ under Node but
            // match under the BrowserCryptoProvider), so we only assert the portable
            // contract: equal Uint8Array inputs hash deterministically to a string.
            const a = crypto.hmac(encodeUtf8("secret"), encodeUtf8("message"));
            const b = crypto.hmac(encodeUtf8("secret"), encodeUtf8("message"));
            expect(a).toBe(b);
            expect(typeof a).toBe("string");
            expect(a.length).toBeGreaterThan(0);
        });
    });

    describe("scrypt", () => {
        it("derives a key of the requested length, deterministically per (password, salt)", async () => {
            const key1 = await crypto.scrypt("password", "salt", 16);
            const key2 = await crypto.scrypt("password", "salt", 16);
            expect(key1.length).toBe(16);
            expect(Array.from(key1)).toEqual(Array.from(key2));

            const longer = await crypto.scrypt("password", "salt", 32);
            expect(longer.length).toBe(32);
        });

        it("produces different keys for different salts, passwords, and cost params", async () => {
            const base = await crypto.scrypt("password", "salt", 16);

            expect(Array.from(await crypto.scrypt("password", "other-salt", 16))).not.toEqual(
                Array.from(base)
            );
            expect(Array.from(await crypto.scrypt("other-password", "salt", 16))).not.toEqual(
                Array.from(base)
            );
            // A different N (CPU/memory cost) yields a different derived key.
            expect(
                Array.from(await crypto.scrypt("password", "salt", 16, { N: 1024 }))
            ).not.toEqual(Array.from(base));
        });

        it("accepts Uint8Array password and salt equivalently to strings", async () => {
            const fromStrings = await crypto.scrypt("password", "salt", 16);
            const fromBytes = await crypto.scrypt(encodeUtf8("password"), encodeUtf8("salt"), 16);
            expect(Array.from(fromBytes)).toEqual(Array.from(fromStrings));
        });
    });

    describe("constantTimeCompare", () => {
        it("returns true only for byte-identical equal-length arrays", () => {
            expect(
                crypto.constantTimeCompare(Uint8Array.from([1, 2, 3]), Uint8Array.from([1, 2, 3]))
            ).toBe(true);

            expect(
                crypto.constantTimeCompare(Uint8Array.from([1, 2, 3]), Uint8Array.from([1, 2, 4]))
            ).toBe(false);
        });

        it("returns false for differing lengths without throwing", () => {
            expect(
                crypto.constantTimeCompare(Uint8Array.from([1, 2, 3]), Uint8Array.from([1, 2]))
            ).toBe(false);

            expect(
                crypto.constantTimeCompare(new Uint8Array(0), new Uint8Array(0))
            ).toBe(true);
        });
    });
});
