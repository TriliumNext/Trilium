import { BackupContainerError } from "./errors.js";

/** ASCII magic that opens every container. */
export const MAGIC = Buffer.from("Trilium Notes Backup", "ascii");

/** Format version this module reads and writes. Version 0 is never valid. */
export const FORMAT_VERSION = 1;

export const FLAG_COMPRESSED = 0b0000_0001;
export const FLAG_ENCRYPTED = 0b0000_0010;
export const FLAG_RESERVED = 0b1111_1100;

export const FIXED_HEADER_BYTES = 32;
export const DIGEST_BYTES = 32;
export const TAG_BYTES = 16;
export const SALT_BYTES = 16;
export const NONCE_PREFIX_BYTES = 8;
export const NONCE_BYTES = 12;
export const KEY_BYTES = 32;

/** Header length is fixed per flag combination in version 1, and readers require equality. */
export const HEADER_BYTES_PLAIN = 64;
export const HEADER_BYTES_ENCRYPTED = 108;

/** Default ceiling on the header, applied before anything is allocated or sought. */
export const DEFAULT_MAX_HEADER_BYTES = 4096;

export const FRAME_SIZE = 1_048_576;
export const FRAME_FINAL_FLAG = 0x8000_0000;
export const FRAME_LENGTH_MASK = 0x7fff_ffff;

/** Reserved for the verifier, so frames may use 0 through 0xFFFFFFFE. */
export const VERIFIER_COUNTER = 0xffff_ffff;
export const MAX_FRAME_COUNTER = VERIFIER_COUNTER - 1;

export const KDF_SCRYPT = 1;

/** Bounds a reader accepts for scrypt, so a crafted header cannot exhaust memory. */
export const SCRYPT_BOUNDS = {
    log2N: { min: 10, max: 20 },
    r: { min: 1, max: 16 },
    p: { min: 1, max: 8 }
} as const;

/** Recommended cost for new containers: about 300 ms and 128 MiB per derivation. */
export const SCRYPT_DEFAULTS: ScryptParams = { log2N: 17, r: 8, p: 1 };

/** Default ceiling on a single key derivation, in bytes. */
export const DEFAULT_MAX_KDF_MEMORY_BYTES = 512 * 1024 * 1024;

/** RFC 1952 "unknown" operating system, so the gzip header carries no platform hint. */
export const GZIP_OS_UNKNOWN = 255;

/** First 16 bytes of any SQLite database file. */
export const SQLITE_MAGIC = Buffer.from("SQLite format 3\0", "latin1");

/** Bytes of output needed before the SQLite header can be checked. */
export const SQLITE_HEADER_BYTES = 18;

export interface ScryptParams {
    log2N: number;
    r: number;
    p: number;
}

export interface EncryptionHeader extends ScryptParams {
    kdfId: number;
    salt: Buffer;
    noncePrefix: Buffer;
    verifierTag: Buffer;
}

export interface ContainerHeader {
    version: number;
    compressed: boolean;
    encrypted: boolean;
    /**
     * Size of the wrapped database before compression, or 0 when unknown. A hint, never an
     * instruction.
     */
    plaintextSize: number;
    headerLength: number;
    encryption: EncryptionHeader | null;
    digest: Buffer;
}

/** Header length implied by the flags, which readers require exactly. */
export function headerLengthFor(encrypted: boolean): number {
    return encrypted ? HEADER_BYTES_ENCRYPTED : HEADER_BYTES_PLAIN;
}

/**
 * End of the span that the verifier tag and every frame authenticate.
 *
 * The verifier tag and the payload digest are the last two fields of the header and are both
 * written after the fact, so neither can be inside what the header authenticates. Stopping here
 * also keeps a bit flip in the verifier tag from invalidating every frame in the file.
 */
export function authenticatedHeaderEnd(headerLength: number): number {
    return headerLength - TAG_BYTES - DIGEST_BYTES;
}

/** Offset of the payload digest, always the last 32 bytes of the header. */
export function digestOffset(headerLength: number): number {
    return headerLength - DIGEST_BYTES;
}

/** Memory a scrypt derivation needs, which is what the reader ceiling is applied to. */
export function scryptMemoryBytes({ log2N, r }: ScryptParams): number {
    return 128 * 2 ** log2N * r;
}

/** 12-byte GCM nonce for a frame counter, or for {@link VERIFIER_COUNTER}. */
export function nonceFor(noncePrefix: Buffer, counter: number): Buffer {
    const nonce = Buffer.allocUnsafe(NONCE_BYTES);
    noncePrefix.copy(nonce, 0);
    nonce.writeUInt32LE(counter, NONCE_PREFIX_BYTES);
    return nonce;
}

/**
 * Serialises a header. The digest is written as supplied, so a writer passes zeros and patches
 * later.
 */
export function encodeHeader(header: ContainerHeader): Buffer {
    const buffer = Buffer.alloc(header.headerLength);

    MAGIC.copy(buffer, 0);
    buffer.writeUInt8(header.version, MAGIC.length);
    const compressed = header.compressed ? FLAG_COMPRESSED : 0;
    const encrypted = header.encrypted ? FLAG_ENCRYPTED : 0;
    buffer.writeUInt8(compressed | encrypted, 21);
    buffer.writeUInt16LE(header.headerLength, 22);
    buffer.writeBigUInt64LE(BigInt(header.plaintextSize), 24);

    if (header.encryption) {
        const { kdfId, log2N, r, p, salt, noncePrefix, verifierTag } = header.encryption;
        buffer.writeUInt8(kdfId, 32);
        buffer.writeUInt8(log2N, 33);
        buffer.writeUInt8(r, 34);
        buffer.writeUInt8(p, 35);
        salt.copy(buffer, 36);
        noncePrefix.copy(buffer, 52);
        verifierTag.copy(buffer, 60);
    }

    header.digest.copy(buffer, digestOffset(header.headerLength));

    return buffer;
}

export interface FixedHeader {
    version: number;
    compressed: boolean;
    encrypted: boolean;
    plaintextSize: number;
    headerLength: number;
}

/**
 * Parses and validates the 32 bytes every container starts with, which is as far as a reader can
 * get before it knows how long the header is.
 *
 * @param buffer the first {@link FIXED_HEADER_BYTES} bytes of the file.
 * @param maxHeaderBytes ceiling above which a header is refused outright.
 */
export function decodeFixedHeader(buffer: Buffer, maxHeaderBytes: number): FixedHeader {
    if (!buffer.subarray(0, MAGIC.length).equals(MAGIC)) {
        throw new BackupContainerError(
            "not-a-container",
            "File does not start with the container magic."
        );
    }

    const version = buffer.readUInt8(MAGIC.length);
    if (version === 0) {
        throw new BackupContainerError("unsupported-version", "Version 0 is never valid.");
    }
    if (version > FORMAT_VERSION) {
        throw new BackupContainerError(
            "unsupported-version",
            `Container version ${version} is newer than ${FORMAT_VERSION}.`
        );
    }

    const flags = buffer.readUInt8(21);
    if (flags & FLAG_RESERVED) {
        throw new BackupContainerError(
            "unsupported-flags",
            `Reserved flag bits are set: 0x${flags.toString(16)}.`
        );
    }
    const encrypted = (flags & FLAG_ENCRYPTED) !== 0;

    const headerLength = buffer.readUInt16LE(22);
    if (headerLength > maxHeaderBytes) {
        throw new BackupContainerError(
            "invalid-header-length",
            `Header of ${headerLength} bytes exceeds the ${maxHeaderBytes} byte ceiling.`
        );
    }
    if (headerLength !== headerLengthFor(encrypted)) {
        throw new BackupContainerError(
            "invalid-header-length",
            `Header of ${headerLength} bytes does not match version ${version} `
                + `with flags 0x${flags.toString(16)}.`
        );
    }

    // A hint that may only ever tighten a bound, so an unrepresentable value is the same as
    // "unknown".
    const plaintextSize = buffer.readBigUInt64LE(24);

    return {
        version,
        compressed: (flags & FLAG_COMPRESSED) !== 0,
        encrypted,
        plaintextSize: plaintextSize > BigInt(Number.MAX_SAFE_INTEGER) ? 0 : Number(plaintextSize),
        headerLength
    };
}

/**
 * Parses the fields after the fixed header. `buffer` is the whole header, `headerLength` bytes
 * long.
 */
export function decodeHeader(buffer: Buffer, maxHeaderBytes: number): ContainerHeader {
    const fixed = decodeFixedHeader(buffer.subarray(0, FIXED_HEADER_BYTES), maxHeaderBytes);

    let encryption: EncryptionHeader | null = null;
    if (fixed.encrypted) {
        const kdfId = buffer.readUInt8(32);
        if (kdfId !== KDF_SCRYPT) {
            throw new BackupContainerError(
                "unsupported-kdf",
                `Key derivation function ${kdfId} is not supported.`
            );
        }

        encryption = {
            kdfId,
            log2N: buffer.readUInt8(33),
            r: buffer.readUInt8(34),
            p: buffer.readUInt8(35),
            salt: buffer.subarray(36, 52),
            noncePrefix: buffer.subarray(52, 60),
            verifierTag: buffer.subarray(60, 76)
        };
    }

    return {
        ...fixed,
        encryption,
        digest: buffer.subarray(digestOffset(fixed.headerLength), fixed.headerLength)
    };
}

/**
 * Rejects scrypt parameters that are out of bounds or too expensive.
 *
 * The memory ceiling is the protection that matters, and it is applied before the derivation runs
 * rather than caught afterwards: a crafted `log2N` of 30 would ask for more than 128 GiB.
 */
export function validateScryptParams(params: ScryptParams, maxMemoryBytes: number): void {
    const inRange = (value: number, bounds: { min: number; max: number }) =>
        Number.isInteger(value) && value >= bounds.min && value <= bounds.max;

    const withinBounds = inRange(params.log2N, SCRYPT_BOUNDS.log2N)
        && inRange(params.r, SCRYPT_BOUNDS.r)
        && inRange(params.p, SCRYPT_BOUNDS.p);

    if (!withinBounds) {
        throw new BackupContainerError(
            "invalid-kdf-params",
            `scrypt parameters out of bounds: log2N=${params.log2N}, r=${params.r}, p=${params.p}.`
        );
    }

    const needed = scryptMemoryBytes(params);
    if (needed > maxMemoryBytes) {
        throw new BackupContainerError(
            "invalid-kdf-params",
            `scrypt would need ${needed} bytes, above the ${maxMemoryBytes} byte ceiling.`
        );
    }
}

/**
 * Checks that unwrapped output really is a SQLite database.
 *
 * @param head at least {@link SQLITE_HEADER_BYTES} bytes from offset 0 of the output.
 */
export function validateSqliteHeader(head: Buffer): void {
    const magicMatches = head.length >= SQLITE_HEADER_BYTES
        && head.subarray(0, SQLITE_MAGIC.length).equals(SQLITE_MAGIC);

    if (!magicMatches) {
        throw new BackupContainerError(
            "not-a-database",
            "Output does not start with the SQLite file magic."
        );
    }

    // Big-endian, and the value 1 encodes 65536 because that does not fit the field.
    const pageSize = head.readUInt16BE(16);
    const isPowerOfTwo = pageSize >= 512 && pageSize <= 32768 && (pageSize & (pageSize - 1)) === 0;
    if (pageSize !== 1 && !isPowerOfTwo) {
        throw new BackupContainerError(
            "not-a-database",
            `SQLite page size ${pageSize} is not valid.`
        );
    }
}
