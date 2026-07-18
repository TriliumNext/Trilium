import type { Cipher, CryptoProvider, ScryptOptions } from "@triliumnext/core";
import { binary_utils } from "@triliumnext/core";
import { sha1 } from "js-sha1";
import { sha256 } from "js-sha256";
import { sha512 } from "js-sha512";
import { md5 } from "js-md5";
import { scrypt } from "scrypt-js";
import aesjs from "aes-js";

const CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";

// Test-only (Vite define): force the pure-JS base64 fallback, reproducing WebViews below Chrome 140
// that lack native Uint8Array.fromBase64/toBase64 — e.g. the Android WebView 136 that OOMs on sync.
// Never set in production builds.
declare const __TRILIUM_FORCE_B64_FALLBACK__: boolean;
const FORCE_B64_FALLBACK = typeof __TRILIUM_FORCE_B64_FALLBACK__ !== "undefined" && __TRILIUM_FORCE_B64_FALLBACK__;

/**
 * Crypto provider for browser environments using pure JavaScript crypto libraries.
 * Uses aes-js for synchronous AES encryption (matching Node.js behavior).
 */
export default class BrowserCryptoProvider implements CryptoProvider {

    createHash(algorithm: "md5" | "sha1" | "sha512", content: string | Uint8Array): Uint8Array {
        const data = binary_utils.unwrapStringOrBuffer(content);

        let hexHash: string;
        if (algorithm === "md5") {
            hexHash = md5(data);
        } else if (algorithm === "sha1") {
            hexHash = sha1(data);
        } else {
            hexHash = sha512(data);
        }

        // Convert hex string to Uint8Array
        const bytes = new Uint8Array(hexHash.length / 2);
        for (let i = 0; i < hexHash.length; i += 2) {
            bytes[i / 2] = parseInt(hexHash.substr(i, 2), 16);
        }
        return bytes;
    }

    createCipheriv(algorithm: "aes-128-cbc", key: Uint8Array, iv: Uint8Array): Cipher {
        return new AesJsCipher(algorithm, key, iv, "encrypt");
    }

    createDecipheriv(algorithm: "aes-128-cbc", key: Uint8Array, iv: Uint8Array): Cipher {
        return new AesJsCipher(algorithm, key, iv, "decrypt");
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

    hmac(secret: string | Uint8Array, value: string | Uint8Array): string {
        const secretStr = binary_utils.unwrapStringOrBuffer(secret);
        const valueStr = binary_utils.unwrapStringOrBuffer(value);
        // sha256.hmac returns hex, convert to base64 to match Node's behavior
        const hexHash = sha256.hmac(secretStr, valueStr);
        const bytes = new Uint8Array(hexHash.length / 2);
        for (let i = 0; i < hexHash.length; i += 2) {
            bytes[i / 2] = parseInt(hexHash.substr(i, 2), 16);
        }
        return btoa(String.fromCharCode(...bytes));
    }

    async scrypt(
        password: Uint8Array | string,
        salt: Uint8Array | string,
        keyLength: number,
        options: ScryptOptions = {}
    ): Promise<Uint8Array> {
        const { N = 16384, r = 8, p = 1 } = options;
        const passwordBytes = binary_utils.wrapStringOrBuffer(password);
        const saltBytes = binary_utils.wrapStringOrBuffer(salt);

        return scrypt(passwordBytes, saltBytes, N, r, p, keyLength);
    }

    constantTimeCompare(a: Uint8Array, b: Uint8Array): boolean {
        if (a.length !== b.length) {
            return false;
        }

        let result = 0;
        for (let i = 0; i < a.length; i++) {
            result |= a[i] ^ b[i];
        }
        return result === 0;
    }

    base64Encode(bytes: Uint8Array): string {
        // Prefer the native (TC39 arraybuffer-base64) encoder where available — Chrome 140+,
        // Firefox 133+, Safari 18.2+. It runs at native speed (SIMD) and avoids materializing
        // the intermediate "binary string" entirely. Detected per call so tests can stub it.
        const nativeBytes = bytes as NativeBase64Array;
        if (!FORCE_B64_FALLBACK && typeof nativeBytes.toBase64 === "function") {
            return nativeBytes.toBase64();
        }

        // Fallback: build the binary string in 32K chunks via fromCharCode.apply. This avoids both
        // the pathological per-byte string concatenation of a naive loop and the call-stack limit
        // of applying fromCharCode to the whole array at once.
        const CHUNK = 0x8000; // 32768
        let binary = "";
        for (let i = 0; i < bytes.length; i += CHUNK) {
            binary += String.fromCharCode.apply(null, bytes.subarray(i, i + CHUNK) as unknown as number[]);
        }
        return btoa(binary);
    }

    base64Decode(base64: string): Uint8Array {
        const nativeCtor = Uint8Array as unknown as NativeBase64Constructor;
        if (!FORCE_B64_FALLBACK && typeof nativeCtor.fromBase64 === "function") {
            return nativeCtor.fromBase64(base64);
        }

        return base64FallbackDecode(base64);
    }

    base64DecodeInto(base64: string, target: Uint8Array): number {
        // Native in-place decode (TC39 arraybuffer-base64, Chrome 140+) skips even the JS loop.
        const nativeTarget = target as NativeBase64Array;
        if (!FORCE_B64_FALLBACK && typeof nativeTarget.setFromBase64 === "function") {
            return nativeTarget.setFromBase64(base64).written;
        }

        return base64DecodeIntoBuffer(base64, target);
    }
}

// Sentinel for a char code that is not part of the base64 alphabet. Distinct from 0 so the decoder
// can tell a real 'A' (value 0) apart from padding / whitespace / garbage, which it skips.
const B64_INVALID = 0xff;

// Base64 alphabet → 6-bit value, indexed by char code (non-alphabet bytes map to B64_INVALID).
const B64_DECODE_TABLE = /* @__PURE__ */ (() => {
    const table = new Uint8Array(256).fill(B64_INVALID);
    const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
    for (let i = 0; i < alphabet.length; i++) {
        table[alphabet.charCodeAt(i)] = i;
    }
    return table;
})();

/**
 * Decodes standard base64 straight into a pre-sized `Uint8Array`, without `atob`'s intermediate
 * binary string. On the WebView-<140 fallback path this removes a whole extra copy of the decoded
 * blob from the peak — the copy that pushed sync's blob decode over the mobile heap.
 *
 * Non-alphabet characters (padding `=` and any ASCII whitespace, e.g. newlines in line-wrapped
 * base64) are skipped rather than decoded as zero bytes, matching `atob` / native `fromBase64`
 * semantics. This is done in a single streaming pass over the input via a bit accumulator, so it
 * stays allocation-free (no sanitized copy of the whole string) and preserves the memory win.
 */
function base64FallbackDecode(base64: string): Uint8Array {
    // Upper bound: every 4 alphabet symbols yield 3 bytes. Padding/whitespace only ever reduce the
    // real output, so this never under-allocates; the exact length is returned as a view at the end.
    const bytes = new Uint8Array((base64.length * 3) >> 2);
    const o = base64DecodeIntoBuffer(base64, bytes);

    return o === bytes.length ? bytes : bytes.subarray(0, o);
}

/** The streaming decode pass shared by the allocating and the in-place (pooled) decode paths. */
function base64DecodeIntoBuffer(base64: string, bytes: Uint8Array): number {
    const len = base64.length;
    const table = B64_DECODE_TABLE;

    let o = 0;
    let acc = 0; // bit accumulator holding up to three pending 6-bit symbols
    let accBits = 0;
    for (let i = 0; i < len; i++) {
        const v = table[base64.charCodeAt(i)];
        if (v === B64_INVALID) {
            continue; // '=' padding or whitespace — ignore, don't emit a zero byte
        }

        acc = (acc << 6) | v;
        accBits += 6;
        if (accBits >= 8) {
            accBits -= 8;
            bytes[o++] = (acc >> accBits) & 0xff;
        }
    }

    return o;
}

/**
 * Structural types for the TC39 "arraybuffer-base64" Uint8Array methods, which are newer than the
 * ES2022 lib this package compiles against. Both are probed with `typeof` before use.
 */
interface NativeBase64Array extends Uint8Array {
    toBase64?(): string;
    setFromBase64?(base64: string): { read: number; written: number };
}
interface NativeBase64Constructor {
    fromBase64?(base64: string): Uint8Array;
}

/**
 * A synchronous cipher implementation using aes-js.
 * Matches Node.js crypto behavior with update() and final() methods.
 */
class AesJsCipher implements Cipher {
    private chunks: Uint8Array[] = [];
    private key: Uint8Array;
    private iv: Uint8Array;
    private mode: "encrypt" | "decrypt";
    private finalized = false;

    constructor(
        _algorithm: "aes-128-cbc",
        key: Uint8Array,
        iv: Uint8Array,
        mode: "encrypt" | "decrypt"
    ) {
        this.key = key;
        this.iv = iv;
        this.mode = mode;
    }

    update(data: Uint8Array): Uint8Array {
        if (this.finalized) {
            throw new Error("Cipher has already been finalized");
        }
        // Buffer the data - we process everything in final() to match streaming behavior
        this.chunks.push(data);
        // Return empty array since aes-js CBC doesn't support true streaming
        return new Uint8Array(0);
    }

    final(): Uint8Array {
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

        if (this.mode === "encrypt") {
            // PKCS7 padding for encryption
            const blockSize = 16;
            const paddingLength = blockSize - (data.length % blockSize);
            const paddedData = new Uint8Array(data.length + paddingLength);
            paddedData.set(data);
            paddedData.fill(paddingLength, data.length);

            const aesCbc = new aesjs.ModeOfOperation.cbc(
                Array.from(this.key),
                Array.from(this.iv)
            );
            return new Uint8Array(aesCbc.encrypt(paddedData));
        } else {
            // Decryption
            const aesCbc = new aesjs.ModeOfOperation.cbc(
                Array.from(this.key),
                Array.from(this.iv)
            );
            const decrypted = new Uint8Array(aesCbc.decrypt(data));

            // Remove PKCS7 padding
            const paddingLength = decrypted[decrypted.length - 1];
            if (paddingLength > 0 && paddingLength <= 16) {
                return decrypted.slice(0, decrypted.length - paddingLength);
            }
            return decrypted;
        }
    }
}
