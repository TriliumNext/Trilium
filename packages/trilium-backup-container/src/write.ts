import { randomBytes } from "node:crypto";
import type { Readable, Writable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createGzip } from "node:zlib";

import { computeVerifierTag, deriveKey } from "./crypto.js";
import { BackupContainerError } from "./errors.js";
import {
    authenticatedHeaderEnd,
    type ContainerHeader,
    DEFAULT_MAX_KDF_MEMORY_BYTES,
    DIGEST_BYTES,
    digestOffset,
    encodeHeader,
    FORMAT_VERSION,
    headerLengthFor,
    KDF_SCRYPT,
    NONCE_PREFIX_BYTES,
    SALT_BYTES,
    type ScryptParams,
    SCRYPT_DEFAULTS,
    TAG_BYTES,
    validateScryptParams
} from "./format.js";
import { DigestTap, FrameEncryptor, GzipHeaderNormaliser } from "./streams.js";

/** The stream shapes `pipeline` accepts, so a built array needs no cast at the call. */
type PipelineStage = NodeJS.ReadableStream | NodeJS.WritableStream | NodeJS.ReadWriteStream;

/**
 * Writes `data` at an absolute offset in the destination that is already being streamed to.
 *
 * The payload digest is only known once the payload has been written, so it is patched into the
 * header afterwards. A destination that cannot be written out of order cannot hold this format.
 */
export type PatchHeader = (offset: number, data: Buffer) => Promise<void> | void;

export interface WriteBackupContainerOptions {
    /** Patches the payload digest into the header once the payload is complete. Required. */
    patchHeader: PatchHeader;
    /** Compress the payload with gzip. */
    compress?: boolean;
    /** Encrypt the payload. Encryption is on exactly when a passphrase is given. */
    passphrase?: string;
    /** Size of the wrapped database, recorded as a hint for restore progress. Omit when unknown. */
    plaintextSize?: number;
    /** scrypt cost. Defaults to {@link SCRYPT_DEFAULTS}. */
    scrypt?: ScryptParams;
    /** Refuses a cost above this many bytes, guarding the writer's own memory. */
    maxKdfMemoryBytes?: number;
    /** zlib compression level. 6 is the speed to ratio sweet spot. */
    compressionLevel?: number;
}

export interface WriteBackupContainerResult {
    headerLength: number;
    compressed: boolean;
    encrypted: boolean;
    /** SHA-256 of the payload as stored, i.e. what was patched into the header. */
    digest: Buffer;
    /** Payload bytes written, excluding the header. */
    payloadBytes: number;
}

/**
 * Wraps a database into a container.
 *
 * The header is written first with a zeroed digest, then the payload streams through gzip and the
 * frame encryptor as configured, and finally the digest is patched into the header.
 *
 * @param input the database bytes.
 * @param output the destination, which is ended by this call.
 * @param options see {@link WriteBackupContainerOptions}; `patchHeader` is required.
 * @returns what was written, see {@link WriteBackupContainerResult}.
 * @throws BackupContainerError with `reason` set, see {@link BackupContainerErrorReason}.
 */
export async function writeBackupContainer(
    input: Readable,
    output: Writable,
    options: WriteBackupContainerOptions
): Promise<WriteBackupContainerResult> {
    if (typeof options.patchHeader !== "function") {
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

    // Build the header first: the verifier tag authenticates the bytes before it, so those must be
    // final.
    const header: ContainerHeader = {
        version: FORMAT_VERSION,
        compressed,
        encrypted,
        plaintextSize,
        headerLength: headerLengthFor(encrypted),
        encryption: null,
        digest: Buffer.alloc(DIGEST_BYTES)
    };

    let key: Buffer | null = null;
    if (options.passphrase !== undefined) {
        const params = options.scrypt ?? SCRYPT_DEFAULTS;
        validateScryptParams(params, options.maxKdfMemoryBytes ?? DEFAULT_MAX_KDF_MEMORY_BYTES);

        header.encryption = {
            kdfId: KDF_SCRYPT,
            ...params,
            salt: randomBytes(SALT_BYTES),
            noncePrefix: randomBytes(NONCE_PREFIX_BYTES),
            verifierTag: Buffer.alloc(TAG_BYTES)
        };
        key = await deriveKey(options.passphrase, header.encryption.salt, params);
    }

    const headerBytes = encodeHeader(header);
    const aad = headerBytes.subarray(0, authenticatedHeaderEnd(header.headerLength));

    if (header.encryption && key) {
        computeVerifierTag(key, header.encryption.noncePrefix, aad).copy(
            headerBytes,
            authenticatedHeaderEnd(header.headerLength)
        );
    }

    await writeChunk(output, headerBytes);

    // input -> gzip -> frames -> digest -> output, with the stages the flags call for.
    const digestTap = new DigestTap();
    // Typed as the streams `pipeline` accepts, so the built array needs no cast at the call.
    const stages: PipelineStage[] = [ input ];
    if (compressed) {
        stages.push(
            createGzip({ level: options.compressionLevel ?? 6 }),
            new GzipHeaderNormaliser()
        );
    }
    if (header.encryption && key) {
        stages.push(new FrameEncryptor(key, header.encryption.noncePrefix, aad));
    }
    stages.push(digestTap, output);

    await pipeline(stages);

    const digest = digestTap.digest();
    await options.patchHeader(digestOffset(header.headerLength), digest);

    return {
        headerLength: header.headerLength,
        compressed,
        encrypted,
        digest,
        payloadBytes: digestTap.bytesHashed
    };
}

function writeChunk(stream: Writable, chunk: Buffer): Promise<void> {
    return new Promise((resolve, reject) => {
        stream.write(chunk, (error) => (error ? reject(error) : resolve()));
    });
}
