import {
    type ByteSink,
    type ByteSource,
    type ContainerBackend,
    deriveContainerKey
} from "./backend.js";
import { bytesEqual, concatBytes, constantTimeEqual, readU32LE } from "./bytes.js";
import { ByteReader } from "./byte-reader.js";
import { BackupContainerError } from "./errors.js";
import {
    authenticatedHeaderEnd,
    type ContainerHeader,
    type ContainerTrailer,
    DEFAULT_MAX_HEADER_BYTES,
    DEFAULT_MAX_KDF_MEMORY_BYTES,
    decodeFixedHeader,
    decodeHeader,
    decodeTrailer,
    encodeHeader,
    type EncryptionHeader,
    FIXED_HEADER_BYTES,
    FRAME_FINAL_FLAG,
    FRAME_LENGTH_MASK,
    FRAME_SIZE,
    MAGIC,
    nonceFor,
    SQLITE_HEADER_BYTES,
    TAG_BYTES,
    TRAILER_BYTES,
    validateScryptParams,
    validateSqliteHeader,
    VERIFIER_COUNTER
} from "./format.js";
import { createProgressReporter, type ProgressOptions, type ProgressReporter } from "./progress.js";

const EMPTY = new Uint8Array(0);

/** Ceiling on unwrapped output when the container does not record a smaller size. */
export const DEFAULT_MAX_OUTPUT_BYTES = 64 * 1024 * 1024 * 1024;

export interface ReadBackupContainerOptions extends ProgressOptions {
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

/** The head of a container, however the caller happens to be holding it. */
export type ContainerHead = ArrayBuffer | ArrayBufferView;

/**
 * What a container says about itself, before any of its payload is read.
 *
 * Three answers rather than two, because "not a backup" and "a backup this build is too old to
 * open" call for entirely different things to be said to the user, and the fields below only exist
 * for the third: a version whose layout this module does not implement is one whose flags and sizes
 * it would only be guessing at.
 */
export type BackupContainerSummary =
    /** Not a container at all: whatever else this file is, it did not come from here. */
    | { isValid: false }
    /** One of ours, but past what this module implements: nothing beyond the version is known. */
    | { isValid: true; isSupported: false; version: number }
    | SupportedBackupContainer;

/** A container this module can act on, which is the only case any of these fields is known in. */
export interface SupportedBackupContainer {
    isValid: true;
    isSupported: true;
    version: number;
    /**
     * Size of the database inside, before compression, or 0 where the writer did not record it. Not
     * the size of the file, which is this plus the wrapping and, once compressed, less than this by
     * an amount nothing states in advance.
     */
    size: number;
    /** When the backup was taken, in milliseconds since the Unix epoch, or 0 when not recorded. */
    creationTimestamp: number;
    isCompressed: boolean;
    isEncrypted: boolean;
}

/**
 * Identifies a container from its first {@link FIXED_HEADER_BYTES} bytes, without touching the
 * payload and without the passphrase: what a container is, is stated in the clear.
 *
 * Built for listing a directory of them, so it is O(1) over a view of what it is given, copies
 * nothing, and never throws: one damaged or foreign file among a hundred costs the listing a row,
 * not the listing.
 *
 * @param head at least {@link FIXED_HEADER_BYTES} bytes from offset 0 of the file. Anything longer
 *             is fine and nothing past those bytes is read, so a caller holding the whole file may
 *             pass it as it stands.
 * @param maxHeaderBytes ceiling above which a header is not worth describing.
 */
export function getInfo(
    head: ContainerHead,
    maxHeaderBytes: number = DEFAULT_MAX_HEADER_BYTES
): BackupContainerSummary {
    const bytes = asBytes(head);

    // Settled here rather than by catching what the decoder throws, because this is the rejection
    // that happens in bulk: a folder of backups is also a folder of everything else the user keeps
    // there, and each of those should cost a comparison rather than an exception.
    const isContainer = bytes.length >= FIXED_HEADER_BYTES
        && bytesEqual(bytes.subarray(0, MAGIC.length), MAGIC);
    if (!isContainer) {
        return { isValid: false };
    }

    // Past the magic, so this field is where the format has always promised to keep it, which is
    // the one thing that stays true of a version written after this module.
    const version = bytes[MAGIC.length];

    try {
        const { timestamp, compressed, encrypted, plaintextSize } = decodeFixedHeader(
            bytes.subarray(0, FIXED_HEADER_BYTES),
            maxHeaderBytes
        );

        return {
            isValid: true,
            isSupported: true,
            version,
            size: plaintextSize,
            creationTimestamp: timestamp,
            isCompressed: compressed,
            isEncrypted: encrypted
        };
    } catch {
        // Every remaining way the head can be refused says the same thing to a listing: ours, and
        // not for this build to open. A version it does not implement and a header that does not
        // measure what this version requires are both answered by pointing at the version.
        return { isValid: true, isSupported: false, version };
    }
}

/** Views whatever the caller holds as bytes, copying none of them. */
function asBytes(head: ContainerHead): Uint8Array {
    if (head instanceof Uint8Array) {
        return head;
    }

    return ArrayBuffer.isView(head)
        ? new Uint8Array(head.buffer, head.byteOffset, head.byteLength)
        : new Uint8Array(head);
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
 * Unwraps a container back into a database. This is the runtime-neutral core; the Node and web
 * entry points wrap it with their stream types and their backend.
 *
 * Frames are authenticated before any of their plaintext is emitted, the output ceiling is applied
 * before bytes reach the destination, and the payload digest and recorded size are checked at the
 * end.
 *
 * @param input the container bytes.
 * @param output the destination for the database, which is ended by this call.
 * @param backend the platform's crypto and compression primitives.
 * @param options see {@link ReadBackupContainerOptions}.
 * @returns what was read, see {@link ReadBackupContainerResult}.
 * @throws BackupContainerError with a `reason` property identifying the failure.
 */
export async function readContainer(
    input: ByteSource,
    output: ByteSink,
    backend: ContainerBackend,
    options: ReadBackupContainerOptions = {}
): Promise<ReadBackupContainerResult> {
    const reader = new ByteReader(input);
    const header = await readHeader(reader, options.maxHeaderBytes ?? DEFAULT_MAX_HEADER_BYTES);

    let key: unknown = null;
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
        key = await deriveContainerKey(
            backend,
            options.passphrase,
            header.encryption.salt,
            header.encryption
        );

        if (options.skipVerifier !== true) {
            await verifyPassphrase(backend, key, header, header.encryption);
        }
    }

    // A recorded size may only tighten the ceiling, never widen it: it is unauthenticated in a
    // plain container, so a crafted value would otherwise disable the guard entirely.
    const ceiling = Math.min(
        options.maxOutputBytes ?? DEFAULT_MAX_OUTPUT_BYTES,
        header.plaintextSize > 0 ? header.plaintextSize : Number.POSITIVE_INFINITY
    );
    // The recorded size is the only total there is: the container's own length measures the payload
    // as stored, which for a compressed one is not what comes out the other end.
    const progress = createProgressReporter(header.plaintextSize, options);
    const guard = new OutputGuard(ceiling, options.requireSqliteHeader !== false, progress);

    const found: FoundTrailer = { trailer: null };
    const payload = header.encryption && key !== null
        ? readFrames(reader, header, header.encryption, key, backend, found)
        : readPlainPayload(reader, backend, found);

    const unwrapped = header.compressed ? backend.gunzip(payload) : payload;
    for await (const chunk of unwrapped) {
        guard.accept(chunk);
        await output.write(chunk);
    }
    guard.finish();
    await output.end();

    // The payload readers always leave one behind or throw, so this is a guard on their contract
    // rather than on the file.
    const trailer = found.trailer;
    /* v8 ignore next 3 -- no input reaches it: both readers end by decoding a trailer, which either
       assigns this or throws `truncated` itself. It stands so a reader added later cannot return
       having quietly skipped the digest. */
    if (!trailer) {
        throw new BackupContainerError("truncated", "The container ended without a trailer.");
    }

    // The trailer's size is the authoritative one, counted as the payload was written rather than
    // promised in advance, and it is what an unencrypted container leans on to notice truncation.
    if (guard.bytesWritten !== trailer.plaintextSize) {
        throw new BackupContainerError(
            "size-mismatch",
            `Output is ${guard.bytesWritten} bytes, the container records ${trailer.plaintextSize}.`
        );
    }
    // Both stated the size, and they disagree: whichever is wrong, the file is not intact.
    if (header.plaintextSize > 0 && header.plaintextSize !== trailer.plaintextSize) {
        throw new BackupContainerError(
            "size-mismatch",
            `Header records ${header.plaintextSize} bytes, the trailer ${trailer.plaintextSize}.`
        );
    }

    progress?.complete();

    return {
        version: header.version,
        compressed: header.compressed,
        encrypted: header.encrypted,
        plaintextSize: header.plaintextSize,
        bytesWritten: guard.bytesWritten
    };
}

/**
 * Guards the unwrapped output: enforces the ceiling before bytes reach the destination, checks the
 * SQLite header as soon as enough of it has passed, and counts what was written.
 *
 * The count it already keeps is what the reader's progress is a fraction of, so the reporting is
 * done from here rather than from a tap of its own.
 */
class OutputGuard {

    #written = 0;
    #head: Uint8Array[] = [];
    #headBytes = 0;
    #headChecked = false;

    constructor(
        private readonly ceiling: number,
        private readonly requireSqliteHeader: boolean,
        private readonly progress: ProgressReporter | null
    ) {}

    get bytesWritten(): number {
        return this.#written;
    }

    /** Vets one chunk on its way to the destination, throwing before a bad one reaches it. */
    accept(chunk: Uint8Array): void {
        if (this.#written + chunk.length > this.ceiling) {
            throw new BackupContainerError(
                "output-too-large",
                `Output would exceed the ${this.ceiling} byte ceiling.`
            );
        }
        this.#written += chunk.length;

        if (this.requireSqliteHeader && !this.#headChecked) {
            this.#head.push(chunk);
            this.#headBytes += chunk.length;

            if (this.#headBytes >= SQLITE_HEADER_BYTES) {
                this.#headChecked = true;
                validateSqliteHeader(concatBytes(...this.#head));
                this.#head = [];
            }
        }

        // Reported only once the chunk has passed every check, so a rejected output never reports
        // having got anywhere.
        this.progress?.at(this.#written);
    }

    /** Called once the payload has ended, to catch an output too short to have been checked. */
    finish(): void {
        if (this.requireSqliteHeader && !this.#headChecked) {
            throw new BackupContainerError(
                "not-a-database",
                "Output is too short to be a SQLite database."
            );
        }
    }

}

async function readHeader(reader: ByteReader, maxHeaderBytes: number): Promise<ContainerHeader> {
    const fixedBytes = await reader.readUpTo(FIXED_HEADER_BYTES);

    // Too short to hold a header. An empty file identifies itself as nothing; anything else is
    // judged on whether what is there could be the start of the magic.
    if (fixedBytes.length < FIXED_HEADER_BYTES) {
        const prefix = MAGIC.subarray(0, Math.min(fixedBytes.length, MAGIC.length));
        const couldBeMagic = fixedBytes.length > 0
            && bytesEqual(fixedBytes.subarray(0, prefix.length), prefix);
        if (!couldBeMagic) {
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

    return decodeHeader(concatBytes(fixedBytes, rest), maxHeaderBytes);
}

/** Re-encodes the header so the authenticated span comes from the same layout the writer used. */
function aadOf(header: ContainerHeader): Uint8Array {
    return encodeHeader(header).subarray(0, authenticatedHeaderEnd(header.headerLength));
}

/**
 * Checks the verifier tag, which tells a wrong passphrase from a usable one before any frame is
 * read: the tag is GCM over an empty plaintext on the reserved counter, so opening it against an
 * empty ciphertext is the check.
 *
 * A mismatch cannot distinguish a wrong passphrase from a bit flip in the salt, nonce prefix or
 * tag, which is why the reason covers both.
 */
async function verifyPassphrase(
    backend: ContainerBackend,
    key: unknown,
    header: ContainerHeader,
    encryption: EncryptionHeader
): Promise<void> {
    const opened = await backend.gcmOpen(
        key,
        nonceFor(encryption.noncePrefix, VERIFIER_COUNTER),
        aadOf(header),
        EMPTY,
        encryption.verifierTag.subarray(0, TAG_BYTES)
    );

    if (opened === null) {
        throw new BackupContainerError(
            "wrong-passphrase-or-damaged-header",
            "Verifier tag did not match."
        );
    }
}

/** Yields the plaintext of each frame, after that frame has been authenticated. */
async function* readFrames(
    reader: ByteReader,
    header: ContainerHeader,
    encryption: EncryptionHeader,
    key: unknown,
    backend: ContainerBackend,
    found: FoundTrailer
): AsyncGenerator<Uint8Array> {
    const aad = aadOf(header);
    const hash = backend.createSha256();
    let counter = 0;

    for (;;) {
        const offset = reader.consumed;
        const lengthField = await reader.readExactly(4);
        const raw = readU32LE(lengthField, 0);
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
        hash.update(lengthField);
        hash.update(ciphertext);
        hash.update(tag);

        const plaintext = await backend.gcmOpen(
            key,
            nonceFor(encryption.noncePrefix, counter),
            concatBytes(aad, lengthField),
            ciphertext,
            tag
        );
        if (plaintext === null) {
            throw new BackupContainerError(
                "damaged-payload",
                `Frame ${counter} failed authentication at byte offset ${offset}.`
            );
        }
        yield plaintext;

        if (final) {
            break;
        }
        counter++;
    }

    // The frames say where they end, so the trailer is simply what follows the final one.
    found.trailer = decodeTrailer(await reader.readExactly(TRAILER_BYTES));

    if (!(await reader.atEof())) {
        throw new BackupContainerError(
            "trailing-data",
            `Bytes follow the trailer at offset ${reader.consumed}.`
        );
    }

    verifyDigest(hash.digest(), found.trailer.digest);
}

/**
 * Yields the payload of an unencrypted container, which runs to the trailer.
 *
 * Nothing announces where that is, so the last {@link TRAILER_BYTES} bytes are held back as they go
 * past and whatever is still held when the input ends is the trailer. That keeps the reader
 * forward-only: it never has to know the file's length, let alone seek to it, which is what lets the
 * same code read a file, a download and a stream that is still arriving.
 */
async function* readPlainPayload(
    reader: ByteReader,
    backend: ContainerBackend,
    found: FoundTrailer
): AsyncGenerator<Uint8Array> {
    const hash = backend.createSha256();
    let held = EMPTY;

    for (;;) {
        const chunk = await reader.readUpTo(FRAME_SIZE);
        if (chunk.length === 0) {
            break;
        }

        const pending = held.length === 0 ? chunk : concatBytes(held, chunk);
        if (pending.length <= TRAILER_BYTES) {
            // Copied, since it has to outlive the reader's own view of these bytes.
            held = pending.slice();
            continue;
        }

        const payload = pending.subarray(0, pending.length - TRAILER_BYTES);
        held = pending.slice(pending.length - TRAILER_BYTES);
        hash.update(payload);
        yield payload;
    }

    found.trailer = decodeTrailer(held);
    verifyDigest(hash.digest(), found.trailer.digest);
}

/** Where a payload reader leaves the trailer it consumed, for the caller that checks it. */
interface FoundTrailer {
    trailer: ContainerTrailer | null;
}

function verifyDigest(actual: Uint8Array, expected: Uint8Array): void {
    if (!constantTimeEqual(actual, expected)) {
        throw new BackupContainerError(
            "digest-mismatch",
            "Payload digest does not match the header."
        );
    }
}
