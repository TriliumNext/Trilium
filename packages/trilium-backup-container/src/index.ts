/**
 * Reader and writer for the Trilium backup container: one SQLite database wrapped with
 * optional gzip compression and optional AES-256-GCM encryption.
 *
 * This is the Node entry point, which depends on nothing outside the Node standard library and
 * takes Node streams. The browser entry point lives at `@triliumnext/backup-container/web`: the
 * same operations on Web Streams, with WebCrypto and `@noble/hashes` underneath. The format layer
 * and every check are shared between the two, so a container written by either is read by both.
 *
 * The module carries no translated strings and reports every failure as a
 * {@link BackupContainerError} whose `reason` is a stable machine-readable code the caller maps to
 * its own messages.
 *
 * @example Writing an encrypted, compressed container
 * ```ts
 * // One forward pass, so the destination is never written back to: write to a temporary name and
 * // rename on success, and a partial file never looks finished.
 * await writeBackupContainer(createReadStream(source), createWriteStream(partial), {
 *     compress: true,
 *     passphrase,
 *     plaintextSize: (await stat(source)).size
 * });
 * await rename(partial, final);
 * ```
 *
 * @example Reading one back, reporting how far along it is
 * ```ts
 * const info = await readBackupContainer(
 *     fs.createReadStream(container),
 *     fs.createWriteStream(database),
 *     { passphrase, onProgress: (progress) => report(Math.round(progress * 100)) }
 * );
 * ```
 *
 * @example Listing a directory of them, opening none
 * ```ts
 * const info = getInfo(await read(path, FIXED_HEADER_BYTES));
 * if (info.isValid && info.isSupported) {
 *     rows.push({ path, taken: info.creationTimestamp, size: info.size });
 * }
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
export { readBackupContainer, writeBackupContainer } from "./node-streams.js";
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
export {
    type WriteBackupContainerOptions,
    type WriteBackupContainerResult
} from "./write.js";
