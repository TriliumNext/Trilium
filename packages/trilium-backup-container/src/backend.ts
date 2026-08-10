import { utf8 } from "./bytes.js";
import { BackupContainerError } from "./errors.js";
import { type ScryptParams, scryptMemoryBytes } from "./format.js";

/** The shape every payload flows through: plain byte chunks, pulled one at a time. */
export type ByteSource = AsyncIterable<Uint8Array>;

/**
 * Where unwrapped or wrapped bytes go. `write` resolves once the destination has taken the chunk
 * and rejects with the destination's own error, which this module passes through untranslated.
 */
export interface ByteSink {
    write(chunk: Uint8Array): Promise<void>;
    end(): Promise<void>;
}

/** Incremental SHA-256, which WebCrypto cannot provide and both directions need. */
export interface StreamingHash {
    update(chunk: Uint8Array): void;
    digest(): Uint8Array;
}

/**
 * The primitives that differ between runtimes. Everything else in this module: the format, the
 * framing, the guards and the progress reporting, is shared verbatim between Node and the browser.
 *
 * The key returned by {@link ContainerBackend.deriveKey} is opaque to the core, which only ever
 * hands it back to the same backend: raw bytes under Node, a non-extractable `CryptoKey` on the
 * web.
 */
export interface ContainerBackend {
    randomBytes(size: number): Uint8Array;
    createSha256(): StreamingHash;
    /**
     * Derives the 32-byte file key with scrypt. The passphrase arrives already NFC-normalised
     * and UTF-8 encoded. Throws whatever the platform throws; the core wraps it.
     */
    deriveKey(
        passphrase: Uint8Array,
        salt: Uint8Array,
        params: ScryptParams,
        maxMemoryBytes: number
    ): Promise<unknown>;
    /** Seals one AES-256-GCM frame. */
    gcmSeal(
        key: unknown,
        nonce: Uint8Array,
        aad: Uint8Array,
        plaintext: Uint8Array
    ): Promise<{ ciphertext: Uint8Array; tag: Uint8Array }>;
    /** Opens one AES-256-GCM frame, answering `null` when authentication fails. */
    gcmOpen(
        key: unknown,
        nonce: Uint8Array,
        aad: Uint8Array,
        ciphertext: Uint8Array,
        tag: Uint8Array
    ): Promise<Uint8Array | null>;
    /** Compresses to a single RFC 1952 gzip stream. */
    gzip(source: ByteSource, level: number): ByteSource;
    /**
     * Decompresses a single gzip stream. A stream the decoder cannot make sense of must surface as
     * a `damaged-payload` {@link BackupContainerError}; errors thrown by `source` itself must pass
     * through untranslated.
     */
    gunzip(source: ByteSource): ByteSource;
}

/**
 * OpenSSL needs a little more than the `128 * N * r` working set, so the ceiling handed to the
 * backend sits above what {@link scryptMemoryBytes} reports. It is a limit, not an allocation.
 */
const MAXMEM_SLACK_BYTES = 1024 * 1024;

/**
 * Derives the 32-byte file key.
 *
 * The passphrase is normalised to Unicode NFC and encoded as UTF-8, which is part of the format:
 * no JavaScript runtime normalises implicitly, so a composed and a decomposed `é` would otherwise
 * derive different keys on different machines.
 */
export async function deriveContainerKey(
    backend: ContainerBackend,
    passphrase: string,
    salt: Uint8Array,
    params: ScryptParams
): Promise<unknown> {
    const secret = utf8(passphrase.normalize("NFC"));
    const maxMemoryBytes = scryptMemoryBytes(params) + MAXMEM_SLACK_BYTES;

    try {
        return await backend.deriveKey(secret, salt, params, maxMemoryBytes);
    } catch (error) {
        throw new BackupContainerError(
            "invalid-kdf-params",
            `Key derivation failed: ${(error as Error).message}`
        );
    }
}
