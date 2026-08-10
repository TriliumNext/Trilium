import { scryptAsync } from "@noble/hashes/scrypt.js";
import { sha256 } from "@noble/hashes/sha2.js";

import type { ByteSource, ContainerBackend } from "./backend.js";
import { concatBytes } from "./bytes.js";
import { BackupContainerError } from "./errors.js";
import { KEY_BYTES, TAG_BYTES } from "./format.js";

/**
 * The browser backend: AES-256-GCM and randomness from WebCrypto, gzip from the platform's
 * `CompressionStream`, and the two primitives WebCrypto does not offer, scrypt and incremental
 * SHA-256, from `@noble/hashes`. Runs under Node just as well, which is how the cross-backend
 * tests exercise it.
 *
 * WebCrypto's `subtle` interface only exists in secure contexts (HTTPS, localhost, workers of
 * either), so this backend cannot serve a page loaded over plain HTTP.
 */
export const webBackend: ContainerBackend = {

    randomBytes(size) {
        const bytes = new Uint8Array(size);
        globalThis.crypto.getRandomValues(bytes);
        return bytes;
    },

    createSha256() {
        const hash = sha256.create();

        return {
            update(chunk: Uint8Array) {
                hash.update(chunk);
            },
            digest() {
                return hash.digest();
            }
        };
    },

    async deriveKey(passphrase, salt, params, maxMemoryBytes) {
        const raw = await scryptAsync(passphrase, salt, {
            N: 2 ** params.log2N,
            r: params.r,
            p: params.p,
            dkLen: KEY_BYTES,
            maxmem: maxMemoryBytes
        });

        // A non-extractable key: once imported, the raw bytes never need to exist again.
        return subtleOrThrow().importKey(
            "raw",
            asBytes(raw),
            "AES-GCM",
            false,
            [ "encrypt", "decrypt" ]
        );
    },

    async gcmSeal(key, nonce, aad, plaintext) {
        const sealed = new Uint8Array(await subtleOrThrow().encrypt(
            { name: "AES-GCM", iv: asBytes(nonce), additionalData: asBytes(aad) },
            key as CryptoKey,
            asBytes(plaintext)
        ));

        // WebCrypto appends the tag to the ciphertext; the format stores it separately.
        return {
            ciphertext: sealed.subarray(0, sealed.length - TAG_BYTES),
            tag: sealed.subarray(sealed.length - TAG_BYTES)
        };
    },

    async gcmOpen(key, nonce, aad, ciphertext, tag) {
        try {
            return new Uint8Array(await subtleOrThrow().decrypt(
                { name: "AES-GCM", iv: asBytes(nonce), additionalData: asBytes(aad) },
                key as CryptoKey,
                asBytes(concatBytes(ciphertext, tag))
            ));
        } catch {
            // WebCrypto reports an authentication failure as an opaque OperationError.
            return null;
        }
    },

    gzip(source) {
        // CompressionStream takes no level, so the platform default applies.
        return throughWebTransform(
            source,
            byteTransform(new CompressionStream("gzip")),
            (error) => error
        );
    },

    gunzip(source) {
        return throughWebTransform(
            source,
            byteTransform(new DecompressionStream("gzip")),
            () => new BackupContainerError(
                "damaged-payload",
                "Compressed payload could not be read."
            )
        );
    }

};

/** A transform pair as this module uses it: bytes in, bytes out. */
interface ByteTransform {
    readable: ReadableStream<Uint8Array>;
    writable: WritableStream<Uint8Array>;
}

/**
 * TypeScript models the platform codec streams over `BufferSource`, which since the typed-array
 * generics also insists on a non-shared backing buffer. Every chunk this module produces is a
 * plain `Uint8Array`, which the codecs accept, so the mismatch is nominal.
 */
function byteTransform(transform: CompressionStream | DecompressionStream): ByteTransform {
    return transform as unknown as ByteTransform;
}

/**
 * Narrows to a non-shared backing buffer, which WebCrypto's typings insist on. Nothing in this
 * package ever allocates from a `SharedArrayBuffer`.
 */
function asBytes(view: Uint8Array): Uint8Array<ArrayBuffer> {
    return view as Uint8Array<ArrayBuffer>;
}

/** The one WebCrypto probe, so an insecure context fails with an explanation, not `undefined`. */
function subtleOrThrow(): SubtleCrypto {
    const subtle = globalThis.crypto?.subtle;
    if (!subtle) {
        throw new Error(
            "WebCrypto is unavailable: backup containers need a secure context "
                + "(HTTPS, localhost, or a worker of either)."
        );
    }

    return subtle;
}

/**
 * Runs a byte source through a web `TransformStream` pair, yielding what comes out the other side.
 *
 * The writing half runs as its own task so a full internal queue never deadlocks against an unread
 * output side. Errors are kept apart by origin: a failure thrown by the source itself aborts the
 * transform and resurfaces as that same error, while a failure raised by the transform, i.e. a
 * decode error, surfaces through `translate`. Errors thrown by the consumer of this generator
 * simply stop both halves.
 */
async function* throughWebTransform(
    source: ByteSource,
    transform: { readable: ReadableStream<Uint8Array>; writable: WritableStream<Uint8Array> },
    translate: (error: unknown) => unknown
): AsyncGenerator<Uint8Array> {
    const writer = transform.writable.getWriter();
    const reader = transform.readable.getReader();

    // Set exactly when the source itself failed; the abort carries it to the read side.
    let sourceError: unknown = null;
    const writing = (async () => {
        const iterator = source[Symbol.asyncIterator]();
        for (;;) {
            let next: IteratorResult<Uint8Array>;
            try {
                next = await iterator.next();
            } catch (error) {
                sourceError = error;
                try {
                    await writer.abort(error);
                } catch {
                    // The transform had already failed on its own; the read side has it.
                }
                return;
            }
            if (next.done) {
                break;
            }
            try {
                await writer.write(next.value);
            } catch {
                // The transform refused the bytes; the read side holds the real error. The source
                // is closed so it does not sit suspended forever.
                try {
                    await iterator.return?.(undefined);
                } catch {
                    // The source's own cleanup failure has nowhere better to go.
                }
                return;
            }
        }
        try {
            await writer.close();
        } catch {
            // A decode error at the flush; it surfaces on the read side.
        }
    })();

    try {
        for (;;) {
            let result: { done: boolean; value?: Uint8Array };
            try {
                result = await reader.read();
            } catch (error) {
                // A source failure is always recorded before the abort that carries it lands
                // here, so the writing task need not be awaited: it could be sitting on a source
                // that will never speak again.
                throw sourceError ?? translate(error);
            }
            if (result.done || result.value === undefined) {
                break;
            }
            yield result.value;
        }
        // The readable only completes after a clean close, which only a cleanly ended source
        // gets, so this settles promptly and surfaces nothing but its own completion.
        await writing;
    } finally {
        // Unblocks a pending write, which in turn ends the writing task.
        try {
            await reader.cancel();
        } catch {
            // An already-errored readable refuses the cancel; that error has been dealt with.
        }
    }
}
