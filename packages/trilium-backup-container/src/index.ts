/**
 * Reader and writer for the Trilium backup container: one SQLite database wrapped with
 * optional gzip compression and optional AES-256-GCM encryption.
 *
 * The module depends on nothing outside the Node standard library, carries no translated strings,
 * and reports every failure as a {@link BackupContainerError} whose `reason` is a stable
 * machine-readable code the caller maps to its own messages.
 *
 * @example Writing an encrypted, compressed container
 * ```ts
 * await writeBackupContainer(createReadStream(source), createWriteStream(partial), {
 *     compress: true,
 *     passphrase,
 *     plaintextSize: (await stat(source)).size,
 *     // Reopening to patch keeps this simple. Do not hand the payload stream a FileHandle with
 *     // `autoClose: false` and patch through that handle: its `close()` then waits forever on a
 *     // stream that never emits `close`.
 *     patchHeader: async (offset, data) => {
 *         const handle = await open(partial, "r+");
 *         try {
 *             await handle.write(data, 0, data.length, offset);
 *             await handle.sync();
 *         } finally {
 *             await handle.close();
 *         }
 *     }
 * });
 * await rename(partial, final);
 * ```
 *
 * @example Reading one back
 * ```ts
 * const info = await readBackupContainer(
 *     fs.createReadStream(container),
 *     fs.createWriteStream(database),
 *     { passphrase }
 * );
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
    type ScryptParams
} from "./format.js";
export {
    type BackupContainerInfo,
    DEFAULT_MAX_OUTPUT_BYTES,
    peekBackupContainer,
    readBackupContainer,
    type ReadBackupContainerOptions,
    type ReadBackupContainerResult
} from "./read.js";
export {
    type PatchHeader,
    writeBackupContainer,
    type WriteBackupContainerOptions,
    type WriteBackupContainerResult
} from "./write.js";
