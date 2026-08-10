import { createCipheriv, createDecipheriv, createHash, randomBytes, scrypt } from "node:crypto";
import { once } from "node:events";
import type { Duplex } from "node:stream";
import { createGunzip, createGzip } from "node:zlib";

import type { ByteSource, ContainerBackend } from "./backend.js";
import { BackupContainerError } from "./errors.js";
import { KEY_BYTES } from "./format.js";

/**
 * The zero-dependency backend: OpenSSL's scrypt and AES-256-GCM, zlib's gzip, all through the Node
 * standard library.
 */
export const nodeBackend: ContainerBackend = {

    randomBytes(size) {
        return randomBytes(size);
    },

    createSha256() {
        const hash = createHash("sha256");

        return {
            update(chunk: Uint8Array) {
                hash.update(chunk);
            },
            digest() {
                return hash.digest();
            }
        };
    },

    deriveKey(passphrase, salt, params, maxMemoryBytes) {
        const options = {
            N: 2 ** params.log2N,
            r: params.r,
            p: params.p,
            maxmem: maxMemoryBytes
        };

        return new Promise((resolve, reject) => {
            // scrypt rejects impossible parameters synchronously and everything else through the
            // callback.
            try {
                scrypt(
                    passphrase,
                    salt,
                    KEY_BYTES,
                    options,
                    (error, key) => (error ? reject(error) : resolve(key))
                );
            } catch (error) {
                reject(error);
            }
        });
    },

    async gcmSeal(key, nonce, aad, plaintext) {
        const cipher = createCipheriv("aes-256-gcm", key as Uint8Array, nonce);
        cipher.setAAD(aad);

        const ciphertext = Buffer.concat([ cipher.update(plaintext), cipher.final() ]);

        return { ciphertext, tag: cipher.getAuthTag() };
    },

    async gcmOpen(key, nonce, aad, ciphertext, tag) {
        const decipher = createDecipheriv("aes-256-gcm", key as Uint8Array, nonce);
        decipher.setAAD(aad);
        decipher.setAuthTag(tag);

        try {
            return Buffer.concat([ decipher.update(ciphertext), decipher.final() ]);
        } catch {
            return null;
        }
    },

    gzip(source, level) {
        return throughZlib(source, createGzip({ level }), (error) => error);
    },

    gunzip(source) {
        return throughZlib(source, createGunzip(), translateZlibError);
    }

};

/**
 * Runs a byte source through a zlib stream, yielding what comes out the other side.
 *
 * The writing half runs as its own task so a full internal buffer never deadlocks against an
 * unread output side. A failure on either half destroys the stream, which makes the other half
 * fail too; `translate` then decides what the surfaced error means, so the decompressor can call
 * a decode failure a damaged payload while everything else passes through untranslated.
 */
async function* throughZlib(
    source: ByteSource,
    transform: Duplex,
    translate: (error: unknown) => unknown
): AsyncGenerator<Uint8Array> {
    // The stream can be destroyed with an error after its iterator has detached, so a spare
    // listener keeps that from escalating into an uncaught exception.
    transform.on("error", () => {});

    const abort = new AbortController();
    const writing = pumpInto(source, transform, abort.signal);

    try {
        for await (const chunk of transform) {
            yield chunk as Uint8Array;
        }
        await writing;
    } catch (error) {
        throw translate(error);
    } finally {
        abort.abort();
        transform.destroy();
    }
}

/**
 * Feeds the source into the zlib stream, honouring its backpressure. Never rejects: a source
 * failure is planted into the stream instead, where the reading half picks it up, so the returned
 * promise needs no handler of its own.
 */
async function pumpInto(source: ByteSource, transform: Duplex, signal: AbortSignal): Promise<void> {
    try {
        for await (const chunk of source) {
            if (!transform.write(chunk)) {
                await once(transform, "drain", { signal });
            }
        }
        transform.end();
    } catch (error) {
        if (!transform.destroyed) {
            transform.destroy(error as Error);
        }
    }
}

/**
 * zlib decode failures mean a damaged payload; everything else, e.g. an error the payload source
 * threw, belongs to the caller.
 */
function translateZlibError(error: unknown): unknown {
    const code = (error as NodeJS.ErrnoException | undefined)?.code;
    if (typeof code === "string" && code.startsWith("Z_")) {
        return new BackupContainerError(
            "damaged-payload",
            `Compressed payload could not be read: ${code}.`
        );
    }

    return error;
}
