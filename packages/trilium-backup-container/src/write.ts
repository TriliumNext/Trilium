import {
    type ByteSink,
    type ByteSource,
    type ContainerBackend,
    deriveContainerKey
} from "./backend.js";
import { concatBytes, writeU32LE } from "./bytes.js";
import { BackupContainerError } from "./errors.js";
import {
    authenticatedHeaderEnd,
    type ContainerHeader,
    DEFAULT_MAX_KDF_MEMORY_BYTES,
    DIGEST_BYTES,
    digestOffset,
    encodeHeader,
    FORMAT_VERSION,
    FRAME_FINAL_FLAG,
    FRAME_SIZE,
    GZIP_OS_UNKNOWN,
    headerLengthFor,
    KDF_SCRYPT,
    MAX_FRAME_COUNTER,
    NONCE_PREFIX_BYTES,
    nonceFor,
    SALT_BYTES,
    type ScryptParams,
    SCRYPT_DEFAULTS,
    TAG_BYTES,
    validateScryptParams,
    VERIFIER_COUNTER
} from "./format.js";
import { createProgressReporter, type ProgressOptions, type ProgressReporter } from "./progress.js";

const EMPTY = new Uint8Array(0);

/**
 * Writes `data` at an absolute offset in the destination that is already being streamed to.
 *
 * The payload digest is only known once the payload has been written, so it is patched into the
 * header afterwards. A destination that cannot be written out of order cannot hold this format.
 */
export type PatchHeader = (offset: number, data: Uint8Array) => Promise<void> | void;

export interface WriteBackupContainerOptions extends ProgressOptions {
    /**
     * Patches the payload digest into the header once the payload is complete. Required, except
     * for a {@link streamed} container, which records no digest and never writes backwards.
     */
    patchHeader?: PatchHeader;
    /**
     * Write front to back, recording no payload digest â€” for a destination that cannot be
     * revisited, such as a download already on its way to the user.
     *
     * Encrypted, the GCM frame tags stand in for the digest. Unencrypted, {@link
     * WriteBackupContainerOptions.plaintextSize} does, so it is required: without either, nothing
     * about the payload could be checked.
     */
    streamed?: boolean;
    /** Compress the payload with gzip. */
    compress?: boolean;
    /** Encrypt the payload. Encryption is on exactly when a passphrase is given. */
    passphrase?: string;
    /**
     * Size of the wrapped database, recorded as a hint for restore progress and used as the total
     * this write reports its own progress against. Omit when unknown.
     */
    plaintextSize?: number;
    /** scrypt cost. Defaults to {@link SCRYPT_DEFAULTS}. */
    scrypt?: ScryptParams;
    /** Refuses a cost above this many bytes, guarding the writer's own memory. */
    maxKdfMemoryBytes?: number;
    /**
     * gzip compression level. 6 is the speed to ratio sweet spot. Only honoured where the
     * platform's compressor takes a level, which the browser's does not.
     */
    compressionLevel?: number;
}

export interface WriteBackupContainerResult {
    headerLength: number;
    compressed: boolean;
    encrypted: boolean;
    /** SHA-256 of the payload as stored, i.e. what was patched into the header. */
    digest: Uint8Array;
    /** Payload bytes written, excluding the header. */
    payloadBytes: number;
}

/**
 * Wraps a database into a container. This is the runtime-neutral core; the Node and web entry
 * points wrap it with their stream types and their backend.
 *
 * The header is written first with a zeroed digest, then the payload streams through gzip and the
 * frame encryptor as configured, and finally the digest is patched into the header.
 *
 * @param input the database bytes.
 * @param output the destination, which is ended by this call.
 * @param backend the platform's crypto and compression primitives.
 * @param options see {@link WriteBackupContainerOptions}; `patchHeader` is required.
 * @returns what was written, see {@link WriteBackupContainerResult}.
 * @throws BackupContainerError with `reason` set, see {@link BackupContainerErrorReason}.
 */
export async function writeContainer(
    input: ByteSource,
    output: ByteSink,
    backend: ContainerBackend,
    options: WriteBackupContainerOptions
): Promise<WriteBackupContainerResult> {
    const streamed = options.streamed === true;
    if (streamed && options.passphrase === undefined && !(options.plaintextSize ?? 0)) {
        throw new BackupContainerError(
            "invalid-options",
            "A streamed container that is not encrypted must record its plaintext size: with "
                + "neither that nor frame tags, nothing about the payload could be checked."
        );
    }
    if (!streamed && typeof options.patchHeader !== "function") {
        throw new BackupContainerError(
            "invalid-options",
            "patchHeader is required to write the payload digest."
        );
    }

    const plaintextSize = options.plaintextSize ?? 0;
    if (!Number.isSafeInteger(plaintextSize) || plaintextSize < 0) {
        throw new BackupContainerError(
            "invalid-options",
            `plaintextSize must be a non-negative safe integer, got ${plaintextSize}.`
        );
    }

    const compressed = options.compress === true;
    const encrypted = options.passphrase !== undefined;
    const progress = createProgressReporter(plaintextSize, options);

    // Build the header first: the verifier tag authenticates the bytes before it, so those must be
    // final.
    const header: ContainerHeader = {
        version: FORMAT_VERSION,
        compressed,
        encrypted,
        streamed,
        plaintextSize,
        headerLength: headerLengthFor(encrypted),
        encryption: null,
        digest: new Uint8Array(DIGEST_BYTES)
    };

    let key: unknown = null;
    if (options.passphrase !== undefined) {
        const params = options.scrypt ?? SCRYPT_DEFAULTS;
        validateScryptParams(params, options.maxKdfMemoryBytes ?? DEFAULT_MAX_KDF_MEMORY_BYTES);

        header.encryption = {
            kdfId: KDF_SCRYPT,
            ...params,
            salt: backend.randomBytes(SALT_BYTES),
            noncePrefix: backend.randomBytes(NONCE_PREFIX_BYTES),
            verifierTag: new Uint8Array(TAG_BYTES)
        };
        key = await deriveContainerKey(backend, options.passphrase, header.encryption.salt, params);
    }

    const headerBytes = encodeHeader(header);
    // A copy rather than a view: the header is about to be handed to the sink, and a sink is free
    // to transfer the buffer away (the streamed download does), which would detach any view still
    // held here while every frame's authentication still needs it.
    const aad = headerBytes.slice(0, authenticatedHeaderEnd(header.headerLength));

    if (header.encryption && key !== null) {
        const verifier = await backend.gcmSeal(
            key,
            nonceFor(header.encryption.noncePrefix, VERIFIER_COUNTER),
            aad,
            EMPTY
        );
        headerBytes.set(verifier.tag, authenticatedHeaderEnd(header.headerLength));
    }

    await output.write(headerBytes);

    // input -> gzip -> frames -> digest -> output, with the stages the flags call for.
    let payload = input;
    if (progress) {
        payload = tapProgress(payload, progress);
    }
    if (compressed) {
        payload = normaliseGzipHeader(backend.gzip(payload, options.compressionLevel ?? 6));
    }
    if (header.encryption && key !== null) {
        payload = encryptFrames(backend, key, header.encryption.noncePrefix, aad, payload);
    }

    const hash = backend.createSha256();
    let payloadBytes = 0;
    for await (const chunk of payload) {
        hash.update(chunk);
        payloadBytes += chunk.length;
        await output.write(chunk);
    }
    await output.end();

    const digest = hash.digest();
    // A streamed container keeps the zeros: its frames authenticate themselves, and there is no
    // going back to the header of a destination already streamed away.
    if (!streamed) {
        await options.patchHeader?.(digestOffset(header.headerLength), digest);
    }

    // After the patch rather than after the payload: the container is not written until the digest
    // is in its header.
    progress?.complete();

    return {
        headerLength: header.headerLength,
        compressed,
        encrypted,
        digest,
        payloadBytes
    };
}

/**
 * Passes bytes through untouched while reporting how many of them have gone past.
 *
 * Sits at the head of the pipeline, where the bytes are still the ones the recorded plaintext
 * size counted: further down they are compressed, encrypted, or both, and a fraction of those is
 * a fraction of a total nobody knows in advance.
 */
async function* tapProgress(source: ByteSource, progress: ProgressReporter): ByteSource {
    let bytes = 0;
    for await (const chunk of source) {
        bytes += chunk.length;
        progress.at(bytes);
        yield chunk;
    }
}

/**
 * Forces the gzip MTIME field to zero and the OS byte to "unknown".
 *
 * Node's compressor already emits MTIME 0 and no FNAME or FEXTRA, but its OS byte follows the
 * build platform (3 on Unix, 10 on Windows), and the browser's compressor makes no promises about
 * either field. Both are informational and outside gzip's CRC, so rewriting them is safe, and
 * doing it here keeps every backend's output canonical: no timestamp and no platform hint.
 */
export async function* normaliseGzipHeader(source: ByteSource): ByteSource {
    let seen = 0;
    for await (let chunk of source) {
        if (seen < 10) {
            // Copy first: the buffer belongs to the compressor.
            chunk = chunk.slice();
            for (let index = 0; index < chunk.length; index++) {
                const offset = seen + index;
                if (offset >= 4 && offset < 8) {
                    chunk[index] = 0;                   // MTIME
                } else if (offset === 9) {
                    chunk[index] = GZIP_OS_UNKNOWN;     // OS
                }
            }
        }
        seen += chunk.length;
        yield chunk;
    }
}

/**
 * Splits the payload into authenticated frames.
 *
 * Full frames are emitted as soon as they fill and the end of the source always emits exactly one
 * final frame, which is why a payload that is an exact multiple of the frame size ends with an
 * empty one. That is the canonical framing, and it lets the writer stream without ever needing to
 * know what follows.
 *
 * @param maxCounter highest counter a frame may use. Lowered only by tests, which cannot write
 *   4 PiB.
 */
export async function* encryptFrames(
    backend: ContainerBackend,
    key: unknown,
    noncePrefix: Uint8Array,
    aad: Uint8Array,
    source: ByteSource,
    maxCounter: number = MAX_FRAME_COUNTER
): ByteSource {
    const frame = new Uint8Array(FRAME_SIZE);
    let filled = 0;
    let counter = 0;

    const seal = async (final: boolean): Promise<Uint8Array> => {
        if (counter > maxCounter) {
            throw new BackupContainerError(
                "payload-too-large",
                `Payload needs more than ${maxCounter + 1} frames.`
            );
        }

        const lengthField = new Uint8Array(4);
        writeU32LE(lengthField, 0, final ? (filled | FRAME_FINAL_FLAG) >>> 0 : filled);

        const { ciphertext, tag } = await backend.gcmSeal(
            key,
            nonceFor(noncePrefix, counter),
            concatBytes(aad, lengthField),
            frame.subarray(0, filled)
        );

        counter++;
        filled = 0;

        return concatBytes(lengthField, ciphertext, tag);
    };

    for await (const chunk of source) {
        let offset = 0;
        while (offset < chunk.length) {
            const take = Math.min(FRAME_SIZE - filled, chunk.length - offset);
            frame.set(chunk.subarray(offset, offset + take), filled);
            filled += take;
            offset += take;

            if (filled === FRAME_SIZE) {
                yield await seal(false);
            }
        }
    }

    yield await seal(true);
}
