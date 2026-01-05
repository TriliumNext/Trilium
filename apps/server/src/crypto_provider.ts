import { CryptoProvider } from "@triliumnext/core";
import crypto from "crypto";

export default class NodejsCryptoProvider implements CryptoProvider {

    createHash(algorithm: "sha1", content: string | Uint8Array): Uint8Array {
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

}
