import { createHash, timingSafeEqual } from "node:crypto";
import type { Readable, Writable } from "node:stream";
import { pipeline } from "node:stream/promises";
import { createGunzip } from "node:zlib";

import { ByteReader } from "./byte-reader.js";
import { deriveKey, openFrame, verifyPassphrase } from "./crypto.js";
import { BackupContainerError } from "./errors.js";
import {
    authenticatedHeaderEnd,
    type ContainerHeader,
    DEFAULT_MAX_HEADER_BYTES,
    DEFAULT_MAX_KDF_MEMORY_BYTES,
    decodeFixedHeader,
    decodeHeader,
    encodeHeader,
    type EncryptionHeader,
    FIXED_HEADER_BYTES,
    FRAME_FINAL_FLAG,
    FRAME_LENGTH_MASK,
    FRAME_SIZE,
    MAGIC,
    TAG_BYTES,
    validateScryptParams
} from "./format.js";
import { OutputGuard } from "./streams.js";

/** Ceiling on unwrapped output when the container does not record a smaller size. */
export const DEFAULT_MAX_OUTPUT_BYTES = 64 * 1024 * 1024 * 1024;

export interface ReadBackupContainerOptions {
    /** Required when the container is encrypted. */
    passphrase?: string;
    /**
     * Hard ceiling on unwrapped output. A recorded plaintext size may tighten it, never widen it.
     */
    maxOutputBytes?: number;
    /** Refuses a header above this size before anything is allocated. */
    maxHeaderBytes?: number;
    /** Refuses a key derivation that would need more memory than this. */
    maxKdfMemoryBytes?: number;
    /**
     * Recovery path: ignore the verifier tag and go straight to the frames.
     *
     * Useful when the verifier tag itself is the damaged part of the header, since it sits outside
     * what the frames authenticate.
     */
    skipVerifier?: boolean;
    /** Check that the output really is a SQLite database. On by default. */
    requireSqliteHeader?: boolean;
}

/** What a container says about itself, before any of its payload is read. */
export interface BackupContainerInfo {
    version: number;
    compressed: boolean;
    encrypted: boolean;
    /** Size of the wrapped database before compression, or 0 when the writer did not record it. */
    plaintextSize: number;
}

/**
 * Identifies a container from its first {@link FIXED_HEADER_BYTES} bytes, without touching the
 * payload and without the passphrase: what a container is, is stated in the clear.
 *
 * Returns `null` for anything this reader does not recognise, so that listing a directory of
 * backups is never derailed by one damaged or foreign file.
 */
export function peekBackupContainer(
    head: Buffer,
    maxHeaderBytes: number = DEFAULT_MAX_HEADER_BYTES
): BackupContainerInfo | null {
    if (head.length < FIXED_HEADER_BYTES) {
        return null;
    }

    try {
        const { version, compressed, encrypted, plaintextSize } = decodeFixedHeader(
            head.subarray(0, FIXED_HEADER_BYTES),
            maxHeaderBytes
        );

        return { version, compressed, encrypted, plaintextSize };
    } catch {
        return null;
    }
}

export interface ReadBackupContainerResult {
    version: number;
    compressed: boolean;
    encrypted: boolean;
    /** The size recorded in the header, or 0 when it was not recorded. */
    plaintextSize: number;
    /** Bytes actually written to the output. */
    bytesWritten: number;
}

/**
 * Unwraps a container back into a database.
 *
 * Frames are authenticated before any of their plaintext is emitted, the output ceiling is applied
 * before bytes reach the destination, and the payload digest and recorded size are checked at the
 * end.
 *
 * @param input the container bytes.
 * @param output the destination for the database, which is ended by this call.
 * @param options see {@link ReadBackupContainerOptions}.
 * @returns what was read, see {@link ReadBackupContainerResult}.
 * @throws BackupContainerError with a `reason` property identifying the failure.
 */
export async function readBackupContainer(
    input: Readable,
    output: Writable,
    options: ReadBackupContainerOptions = {}
): Promise<ReadBackupContainerResult> {
    const reader = new ByteReader(input);
    const header = await readHeader(reader, options.maxHeaderBytes ?? DEFAULT_MAX_HEADER_BYTES);

    let key: Buffer | null = null;
    if (header.encryption) {
        if (options.passphrase === undefined) {
            throw new BackupContainerError(
                "passphrase-required",
                "Container is encrypted but no passphrase was given."
            );
        }

        validateScryptParams(
            header.encryption,
            options.maxKdfMemoryBytes ?? DEFAULT_MAX_KDF_MEMORY_BYTES
        );
        key = await deriveKey(options.passphrase, header.encryption.salt, header.encryption);

        if (options.skipVerifier !== true) {
            verifyPassphrase(
                key,
                header.encryption.noncePrefix,
                aadOf(header),
                header.encryption.verifierTag
            );
        }
    }

    // A recorded size may only tighten the ceiling, never widen it: it is unauthenticated in a
    // plain container, so a crafted value would otherwise disable the guard entirely.
    const ceiling = Math.min(
        options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES,
        header.plaintextSize > 0 ? header.plaintextSize : Number.POSITIVE_INFINITY
    );
    const guard = new OutputGuard(ceiling, options.requireSqliteHeader !== false);

    const payload = header.encryption && key
        ? readFrames(reader, header, header.encryption, key)
        : readPlainPayload(reader, header);

    try {
        // Spelled out rather than built as an array: the source is an async generator, which only
        // the variadic overloads accept.
        if (header.compressed) {
            await pipeline(payload, createGunzip(), guard, output);
        } else {
            await pipeline(payload, guard, output);
        }
    } catch (error) {
        throw translatePipelineError(error);
    }

    if (header.plaintextSize > 0 && guard.bytesWritten !== header.plaintextSize) {
        throw new BackupContainerError(
            "size-mismatch",
            `Output is ${guard.bytesWritten} bytes, header records ${header.plaintextSize}.`
        );
    }

    return {
        version: header.version,
        compressed: header.compressed,
        encrypted: header.encrypted,
        plaintextSize: header.plaintextSize,
        bytesWritten: guard.bytesWritten
    };
}

async function readHeader(reader: ByteReader, maxHeaderBytes: number): Promise<ContainerHeader> {
    const fixedBytes = await reader.readUpTo(FIXED_HEADER_BYTES);

    // Too short to hold a header. An empty file identifies itself as nothing; anything else is
    // judged on whether what is there could be the start of the magic.
    if (fixedBytes.length < FIXED_HEADER_BYTES) {
        const prefix = MAGIC.subarray(0, Math.min(fixedBytes.length, MAGIC.length));
        if (fixedBytes.length === 0 || !fixedBytes.subarray(0, prefix.length).equals(prefix)) {
            throw new BackupContainerError(
                "not-a-container",
                "File does not start with the container magic."
            );
        }
        throw new BackupContainerError(
            "truncated",
            `File ends after ${fixedBytes.length} bytes, inside the header.`
        );
    }

    const fixed = decodeFixedHeader(fixedBytes, maxHeaderBytes);
    const rest = await reader.readExactly(fixed.headerLength - FIXED_HEADER_BYTES);

    return decodeHeader(Buffer.concat([ fixedBytes, rest ]), maxHeaderBytes);
}

/** Re-encodes the header so the authenticated span comes from the same layout the writer used. */
function aadOf(header: ContainerHeader): Buffer {
    return encodeHeader(header).subarray(0, authenticatedHeaderEnd(header.headerLength));
}

/** Yields the plaintext of each frame, after that frame has been authenticated. */
async function* readFrames(
    reader: ByteReader,
    header: ContainerHeader,
    encryption: EncryptionHeader,
    key: Buffer
): AsyncGenerator<Buffer> {
    const aad = aadOf(header);
    const hash = createHash("sha256");
    let counter = 0;

    for (;;) {
        const offset = reader.consumed;
        const lengthField = await reader.readExactly(4);
        const raw = lengthField.readUInt32LE(0);
        const final = (raw & FRAME_FINAL_FLAG) !== 0;
        const length = raw & FRAME_LENGTH_MASK;

        // Checked before the data is read: the field can claim up to 2 GiB.
        if (length > FRAME_SIZE || (!final && length !== FRAME_SIZE)) {
            throw new BackupContainerError(
                "invalid-frame-length",
                `Frame ${counter} at offset ${offset} declares ${length} bytes.`
            );
        }

        const ciphertext = await reader.readExactly(length);
        const tag = await reader.readExactly(TAG_BYTES);
        hash.update(lengthField).update(ciphertext).update(tag);

        yield openFrame(
            key,
            encryption.noncePrefix,
            aad,
            counter,
            lengthField,
            ciphertext,
            tag,
            offset
        );

        if (final) {
            break;
        }
        counter++;
    }

    if (!(await reader.atEof())) {
        throw new BackupContainerError(
            "trailing-data",
            `Bytes follow the final frame at offset ${reader.consumed}.`
        );
    }

    verifyDigest(hash.digest(), header.digest);
}

/** Yields the payload of an unencrypted container, which runs to end of file. */
async function* readPlainPayload(
    reader: ByteReader,
    header: ContainerHeader
): AsyncGenerator<Buffer> {
    const hash = createHash("sha256");

    for (;;) {
        const chunk = await reader.readUpTo(FRAME_SIZE);
        if (chunk.length === 0) {
            break;
        }
        hash.update(chunk);
        yield chunk;
    }

    verifyDigest(hash.digest(), header.digest);
}

function verifyDigest(actual: Buffer, expected: Buffer): void {
    if (!timingSafeEqual(actual, expected)) {
        throw new BackupContainerError(
            "digest-mismatch",
            "Payload digest does not match the header."
        );
    }
}

/**
 * zlib failures mean a damaged payload; everything else, e.g. a full disk, belongs to the caller.
 */
function translatePipelineError(error: unknown): unknown {
    const code = (error as NodeJS.ErrnoException | undefined)?.code;
    if (typeof code === "string" && code.startsWith("Z_")) {
        return new BackupContainerError(
            "damaged-payload",
            `Compressed payload could not be read: ${code}.`
        );
    }

    return error;
}
