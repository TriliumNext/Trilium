import {
    bytesEqual,
    readU16BE,
    readU16LE,
    readU64LE,
    utf8,
    writeU16LE,
    writeU32LE,
    writeU64LE
} from "./bytes.js";
import { BackupContainerError } from "./errors.js";

/** ASCII magic that opens every container. */
export const MAGIC = utf8("Trilium Notes Backup");

/** Format version this module reads and writes. Version 0 is never valid. */
export const FORMAT_VERSION = 1;

export const FLAG_COMPRESSED = 0b0000_0001;
export const FLAG_ENCRYPTED = 0b0000_0010;
export const FLAG_RESERVED = 0b1111_1100;

export const FIXED_HEADER_BYTES = 40;
export const DIGEST_BYTES = 32;
export const TAG_BYTES = 16;
export const SALT_BYTES = 16;
export const NONCE_PREFIX_BYTES = 8;
export const NONCE_BYTES = 12;
export const KEY_BYTES = 32;
export const TIMESTAMP_BYTES = 8;
export const SIZE_BYTES = 8;

/** Header length is fixed per flag combination, and readers require equality. */
export const HEADER_BYTES_PLAIN = 40;
export const HEADER_BYTES_ENCRYPTED = 84;

/**
 * What follows the payload: the digest over it, and the length it actually came to.
 *
 * Both are only knowable once the payload has been written, which is why they sit at the end rather
 * than in the header. Nothing in a container therefore has to be written back to, so any writer can
 * produce one in a single forward pass, and every container carries a digest whatever its flags
 * say, including the plain uncompressed unencrypted one, which would otherwise have nothing at all
 * standing behind its contents.
 */
export const TRAILER_BYTES = DIGEST_BYTES + SIZE_BYTES;

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
export const SQLITE_MAGIC = utf8("SQLite format 3\0");

/** Bytes of output needed before the SQLite header can be checked. */
export const SQLITE_HEADER_BYTES = 18;

export interface ScryptParams {
    log2N: number;
    r: number;
    p: number;
}

export interface EncryptionHeader extends ScryptParams {
    kdfId: number;
    salt: Uint8Array;
    noncePrefix: Uint8Array;
    verifierTag: Uint8Array;
}

export interface ContainerHeader {
    version: number;
    /**
     * When the backup was taken, in milliseconds since the Unix epoch, or `0` when not recorded.
     *
     * Stated in the clear so that a directory of backups can be dated without opening any of them,
     * and without depending on a filesystem timestamp that copying does not preserve.
     */
    timestamp: number;
    compressed: boolean;
    encrypted: boolean;
    /**
     * Size of the wrapped database before compression, or 0 when unknown. A hint, never an
     * instruction: the authoritative figure is the one the trailer records once the payload is
     * written. This one is here for what has to be known in advance, such as the length of a
     * download or a progress bar to draw against.
     */
    plaintextSize: number;
    headerLength: number;
    encryption: EncryptionHeader | null;
}

/**
 * What follows the payload, once there is a payload to describe. See {@link TRAILER_BYTES}.
 *
 * Not covered by anything the header authenticates, for the same reason the digest never was: it is
 * written after the fact. In an encrypted container the frames already make tampering detectable,
 * and here the digest does what it has always done, which is catch bit rot and truncation.
 */
export interface ContainerTrailer {
    /** SHA-256 over the payload exactly as stored. */
    digest: Uint8Array;
    /** The plaintext length as counted while writing, which the reader holds the output to. */
    plaintextSize: number;
}

/** Header length implied by the flags, which readers require exactly. */
export function headerLengthFor(encrypted: boolean): number {
    return encrypted ? HEADER_BYTES_ENCRYPTED : HEADER_BYTES_PLAIN;
}

/**
 * End of the span that the verifier tag and every frame authenticate.
 *
 * The verifier tag is the last field of the header and is written once the key exists, so it cannot
 * be inside what it authenticates. Stopping here also keeps a bit flip in the verifier tag from
 * invalidating every frame in the file. Everything before it, the timestamp included, is covered.
 */
export function authenticatedHeaderEnd(headerLength: number): number {
    return headerLength - TAG_BYTES;
}

/** Memory a scrypt derivation needs, which is what the reader ceiling is applied to. */
export function scryptMemoryBytes({ log2N, r }: ScryptParams): number {
    return 128 * 2 ** log2N * r;
}

/** 12-byte GCM nonce for a frame counter, or for {@link VERIFIER_COUNTER}. */
export function nonceFor(noncePrefix: Uint8Array, counter: number): Uint8Array {
    const nonce = new Uint8Array(NONCE_BYTES);
    nonce.set(noncePrefix, 0);
    writeU32LE(nonce, NONCE_PREFIX_BYTES, counter);
    return nonce;
}

/** Serialises a header. Every field is known before the payload, so nothing is patched in later. */
export function encodeHeader(header: ContainerHeader): Uint8Array {
    const buffer = new Uint8Array(header.headerLength);

    buffer.set(MAGIC, 0);
    buffer[MAGIC.length] = header.version;
    writeU64LE(buffer, 21, BigInt(header.timestamp));
    const compressed = header.compressed ? FLAG_COMPRESSED : 0;
    const encrypted = header.encrypted ? FLAG_ENCRYPTED : 0;
    buffer[29] = compressed | encrypted;
    writeU16LE(buffer, 30, header.headerLength);
    writeU64LE(buffer, 32, BigInt(header.plaintextSize));

    if (header.encryption) {
        const { kdfId, log2N, r, p, salt, noncePrefix, verifierTag } = header.encryption;
        buffer[40] = kdfId;
        buffer[41] = log2N;
        buffer[42] = r;
        buffer[43] = p;
        buffer.set(salt, 44);
        buffer.set(noncePrefix, 60);
        buffer.set(verifierTag, 68);
    }

    return buffer;
}

/** Serialises the trailer, which is written once the payload is complete. */
export function encodeTrailer(trailer: ContainerTrailer): Uint8Array {
    const buffer = new Uint8Array(TRAILER_BYTES);

    buffer.set(trailer.digest, 0);
    writeU64LE(buffer, DIGEST_BYTES, BigInt(trailer.plaintextSize));

    return buffer;
}

/** Parses the trailer out of exactly {@link TRAILER_BYTES} bytes. */
export function decodeTrailer(buffer: Uint8Array): ContainerTrailer {
    if (buffer.length !== TRAILER_BYTES) {
        throw new BackupContainerError(
            "truncated",
            `Trailer is ${buffer.length} bytes, expected ${TRAILER_BYTES}.`
        );
    }

    const plaintextSize = readU64LE(buffer, DIGEST_BYTES);

    return {
        digest: buffer.subarray(0, DIGEST_BYTES),
        plaintextSize: plaintextSize > BigInt(Number.MAX_SAFE_INTEGER) ? 0 : Number(plaintextSize)
    };
}

export interface FixedHeader {
    version: number;
    timestamp: number;
    compressed: boolean;
    encrypted: boolean;
    plaintextSize: number;
    headerLength: number;
}

/**
 * Parses and validates the 40 bytes every container starts with, which is as far as a reader can
 * get before it knows how long the header is.
 *
 * @param buffer the first {@link FIXED_HEADER_BYTES} bytes of the file.
 * @param maxHeaderBytes ceiling above which a header is refused outright.
 */
export function decodeFixedHeader(buffer: Uint8Array, maxHeaderBytes: number): FixedHeader {
    if (!bytesEqual(buffer.subarray(0, MAGIC.length), MAGIC)) {
        throw new BackupContainerError(
            "not-a-container",
            "File does not start with the container magic."
        );
    }

    const version = buffer[MAGIC.length];
    if (version === 0) {
        throw new BackupContainerError("unsupported-version", "Version 0 is never valid.");
    }
    if (version > FORMAT_VERSION) {
        throw new BackupContainerError(
            "unsupported-version",
            `Container version ${version} is newer than ${FORMAT_VERSION}.`
        );
    }

    const flags = buffer[29];
    if (flags & FLAG_RESERVED) {
        throw new BackupContainerError(
            "unsupported-flags",
            `Reserved flag bits are set: 0x${flags.toString(16)}.`
        );
    }
    const encrypted = (flags & FLAG_ENCRYPTED) !== 0;

    const headerLength = readU16LE(buffer, 30);
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
    // "unknown". The same goes for a date nothing could have produced.
    const plaintextSize = readU64LE(buffer, 32);
    const timestamp = readU64LE(buffer, 21);

    return {
        version,
        timestamp: timestamp > BigInt(Number.MAX_SAFE_INTEGER) ? 0 : Number(timestamp),
        compressed: (flags & FLAG_COMPRESSED) !== 0,
        encrypted,
        plaintextSize: plaintextSize > BigInt(Number.MAX_SAFE_INTEGER) ? 0 : Number(plaintextSize),
        headerLength
    };
}

/**
 * Exact byte length of an uncompressed container wrapping `plaintextSize` bytes.
 *
 * Encrypted, that is the header, the payload, the length field and tag around every frame including
 * the final one, which is empty when the payload is an exact multiple of the frame size, and the
 * trailer. Unencrypted, the payload is written as it stands between the header and the trailer.
 *
 * Exactness is the point twice over: a download that states its size correctly is one the browser
 * can draw a progress bar for, and a file that does not measure this much is one a reader can
 * refuse before reading any of it. Compression breaks the derivation, since the payload is then
 * shorter than the plaintext by a ratio nothing states in advance.
 */
export function containerSize(plaintextSize: number, encrypted: boolean): number {
    if (!encrypted) {
        return HEADER_BYTES_PLAIN + plaintextSize + TRAILER_BYTES;
    }

    const frames = Math.floor(plaintextSize / FRAME_SIZE) + 1;

    return HEADER_BYTES_ENCRYPTED + plaintextSize + frames * (4 + TAG_BYTES) + TRAILER_BYTES;
}

/**
 * Parses the fields after the fixed header. `buffer` is the whole header, `headerLength` bytes
 * long.
 */
export function decodeHeader(buffer: Uint8Array, maxHeaderBytes: number): ContainerHeader {
    const fixed = decodeFixedHeader(buffer.subarray(0, FIXED_HEADER_BYTES), maxHeaderBytes);

    let encryption: EncryptionHeader | null = null;
    if (fixed.encrypted) {
        const kdfId = buffer[40];
        if (kdfId !== KDF_SCRYPT) {
            throw new BackupContainerError(
                "unsupported-kdf",
                `Key derivation function ${kdfId} is not supported.`
            );
        }

        encryption = {
            kdfId,
            log2N: buffer[41],
            r: buffer[42],
            p: buffer[43],
            salt: buffer.subarray(44, 60),
            noncePrefix: buffer.subarray(60, 68),
            verifierTag: buffer.subarray(68, 84)
        };
    }

    return { ...fixed, encryption };
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
export function validateSqliteHeader(head: Uint8Array): void {
    const magicMatches = head.length >= SQLITE_HEADER_BYTES
        && bytesEqual(head.subarray(0, SQLITE_MAGIC.length), SQLITE_MAGIC);

    if (!magicMatches) {
        throw new BackupContainerError(
            "not-a-database",
            "Output does not start with the SQLite file magic."
        );
    }

    // Big-endian, and the value 1 encodes 65536 because that does not fit the field.
    const pageSize = readU16BE(head, 16);
    const isPowerOfTwo = pageSize >= 512 && pageSize <= 32768 && (pageSize & (pageSize - 1)) === 0;
    if (pageSize !== 1 && !isPowerOfTwo) {
        throw new BackupContainerError(
            "not-a-database",
            `SQLite page size ${pageSize} is not valid.`
        );
    }
}
