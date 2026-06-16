/*
 * Promise-based APIs introduced in yauzl 3.4.0 that are not yet covered by @types/yauzl.
 * Remove once the upstream types catch up.
 * See https://github.com/thejoshwolfe/yauzl/pull/171
 */

import type { Readable } from "stream";

declare module "yauzl" {
    export function openPromise(path: string, options?: Options): Promise<ZipFile>;
    export function fromFdPromise(fd: number, options?: Options): Promise<ZipFile>;
    export function fromBufferPromise(buffer: Buffer, options?: Options): Promise<ZipFile>;
    export function fromRandomAccessReaderPromise(
        reader: RandomAccessReader,
        totalSize: number,
        options?: Options
    ): Promise<ZipFile>;

    interface ZipFile {
        /**
         * Async-iterator alternative to readEntry()/"entry" events. Requires lazyEntries: true
         * (implied by the *Promise() open functions) and may only be called once per ZipFile.
         */
        eachEntry(): AsyncIterableIterator<Entry>;
        openReadStreamPromise(entry: Entry, options?: ZipFileOptions): Promise<Readable>;
        readLocalFileHeaderPromise(
            entry: Entry,
            options: { minimal: true }
        ): Promise<{ fileDataStart: number }>;
        readLocalFileHeaderPromise(
            entry: Entry,
            options?: { minimal?: boolean }
        ): Promise<LocalFileHeader>;
        openReadStreamLowLevelPromise(
            fileDataStart: number,
            compressedSize: number,
            relativeStart: number,
            relativeEnd: number,
            decompress: boolean,
            uncompressedSize: number | null
        ): Promise<Readable>;
    }
}
