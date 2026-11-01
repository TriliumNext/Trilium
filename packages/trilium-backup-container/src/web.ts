/**
 * Reader and writer for the Trilium backup container: one SQLite database wrapped with
 * optional gzip compression and optional AES-256-GCM encryption.
 *
 * This is the browser entry point, `@triliumnext/backup-container/web`: the same operations as
 * the Node entry point, taking Web Streams instead of Node streams. AES-256-GCM and randomness
 * come from WebCrypto, gzip from the platform's `CompressionStream`, and scrypt and incremental
 * SHA-256, which WebCrypto does not offer, from `@noble/hashes`. The format layer and every check
 * are shared with the Node entry point, so a container written by either is read by both.
 *
 * WebCrypto's `subtle` interface only exists in secure contexts (HTTPS, localhost, workers of
 * either), so encrypted containers cannot be handled on a page served over plain HTTP.
 *
 * @example Unwrapping a picked file into an OPFS destination
 * ```ts
 * const handle = await directory.getFileHandle("document.db", { create: true });
 * const info = await readBackupContainer(file.stream(), await handle.createWritable(), {
 *     passphrase,
 *     onProgress: (progress) => report(Math.round(progress * 100))
 * });
 * ```
 *
 * @module
 */

export {
    BackupContainerError,
    type BackupContainerErrorReason,
    isBackupContainerError
} from "./errors.js";
export {
    FIXED_HEADER_BYTES,
    FORMAT_VERSION,
    FRAME_SIZE,
    SCRYPT_BOUNDS,
    SCRYPT_DEFAULTS,
    type ScryptParams,
    containerSize,
    type ContainerTrailer,
    decodeTrailer,
    encodeTrailer,
    TRAILER_BYTES
} from "./format.js";
export {
    DEFAULT_PROGRESS_INTERVAL_MS,
    type ProgressCallback,
    type ProgressOptions
} from "./progress.js";
export {
    type BackupContainerSummary,
    type ContainerHead,
    DEFAULT_MAX_OUTPUT_BYTES,
    getInfo,
    type ReadBackupContainerOptions,
    type ReadBackupContainerResult,
    type SupportedBackupContainer
} from "./read.js";
export { readBackupContainer, writeBackupContainer } from "./web-streams.js";
export {
    type WriteBackupContainerOptions,
    type WriteBackupContainerResult
} from "./write.js";
