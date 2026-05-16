import type { CryptoProvider, ScryptOptions } from "@triliumnext/core";
import { binary_utils } from "@triliumnext/core";
import crypto from "crypto";
import { generator } from "rand-token";

const randtoken = generator({ source: "crypto" });

export default class NodejsCryptoProvider implements CryptoProvider {

    createHash(algorithm: "md5" | "sha1" | "sha512", content: string | Uint8Array): Uint8Array {
        return crypto.createHash(algorithm).update(content).digest();
    }

    createCipheriv(algorithm: "aes-128-cbc", key: Uint8Array, iv: Uint8Array): { update(data: Uint8Array): Uint8Array; final(): Uint8Array; } {
        return crypto.createCipheriv(algorithm, key, iv);
    }

    createDecipheriv(algorithm: "aes-128-cbc", key: Uint8Array, iv: Uint8Array) {
        return crypto.createDecipheriv(algorithm, key, iv);
    }

    randomBytes(size: number): Uint8Array {
        return crypto.randomBytes(size);
    }

    randomString(length: number): string {
        return randtoken.generate(length);
    }

    hmac(secret: string | Uint8Array, value: string | Uint8Array) {
        const hmac = crypto.createHmac("sha256", Buffer.from(secret.toString(), "ascii"));
        hmac.update(value.toString());
        return hmac.digest("base64");
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
        return crypto.scryptSync(passwordBytes, saltBytes, keyLength, { N, r, p });
    }

    constantTimeCompare(a: Uint8Array, b: Uint8Array): boolean {
        const bufA = Buffer.from(a);
        const bufB = Buffer.from(b);

        if (bufA.length !== bufB.length) {
            // Compare bufA against itself to maintain constant time behavior
            crypto.timingSafeEqual(bufA, bufA);
            return false;
        }

        return crypto.timingSafeEqual(bufA, bufB);
    }
}
