import { Readable, Writable } from "node:stream";

import { SQLITE_MAGIC, type ScryptParams } from "./format.js";
import {
    readBackupContainer,
    type ReadBackupContainerOptions,
    type ReadBackupContainerResult
} from "./read.js";
import {
    writeBackupContainer,
    type WriteBackupContainerOptions,
    type WriteBackupContainerResult
} from "./write.js";

/** Cheap scrypt cost, so the suite is not dominated by key derivation. */
export const FAST_SCRYPT: ScryptParams = { log2N: 10, r: 8, p: 1 };

export class MemorySink extends Writable {

    readonly chunks: Buffer[] = [];

    override _write(
        chunk: Buffer,
        _encoding: BufferEncoding,
        callback: (error?: Error | null) => void
    ): void {
        this.chunks.push(Buffer.from(chunk));
        callback();
    }

    toBuffer(): Buffer {
        return Buffer.concat(this.chunks);
    }

}

/** A byte pattern that starts with a valid SQLite header and compresses well. */
export function fakeDatabase(size = 4096, pageSize = 4096): Buffer {
    const database = Buffer.alloc(Math.max(size, 18));
    SQLITE_MAGIC.copy(database, 0);
    database.writeUInt16BE(pageSize, 16);
    database.fill("trilium notes ", 18);

    return database.subarray(0, size);
}

/** Splits a buffer so the reader and writer are exercised across chunk boundaries. */
export function chunked(data: Buffer, chunkSize: number): Readable {
    const chunks: Buffer[] = [];
    for (let offset = 0; offset < data.length; offset += chunkSize) {
        chunks.push(data.subarray(offset, offset + chunkSize));
    }

    return Readable.from(chunks.length > 0 ? chunks : [ Buffer.alloc(0) ]);
}

export interface WrittenContainer {
    bytes: Buffer;
    result: WriteBackupContainerResult;
    patchedAt: number[];
}

/** Writes a container in memory, applying the digest patch the way a file destination would. */
export async function writeToBuffer(
    input: Buffer | Readable,
    options: Omit<WriteBackupContainerOptions, "patchHeader"> = {}
): Promise<WrittenContainer> {
    const sink = new MemorySink();
    const patches: { offset: number; data: Buffer }[] = [];

    const result = await writeBackupContainer(
        Buffer.isBuffer(input) ? Readable.from([ input ]) : input,
        sink,
        {
            ...options,
            patchHeader: (offset, data) => { patches.push({ offset, data: Buffer.from(data) }); }
        }
    );

    const bytes = sink.toBuffer();
    for (const patch of patches) {
        patch.data.copy(bytes, patch.offset);
    }

    return { bytes, result, patchedAt: patches.map((patch) => patch.offset) };
}

export interface ReadContainer {
    bytes: Buffer;
    result: ReadBackupContainerResult;
}

export async function readFromBuffer(
    container: Buffer,
    options: ReadBackupContainerOptions = {}
): Promise<ReadContainer> {
    const sink = new MemorySink();
    const result = await readBackupContainer(Readable.from([ container ]), sink, options);

    return { bytes: sink.toBuffer(), result };
}

/** Returns a copy with one byte flipped, for tamper tests. */
export function flipByte(data: Buffer, offset: number): Buffer {
    const copy = Buffer.from(data);
    copy[offset] ^= 0xff;

    return copy;
}

/** The `reason` reading these bytes fails with, which most of the failure tests assert on. */
export function failureOf(
    container: Buffer,
    options: ReadBackupContainerOptions = {}
): Promise<string> {
    return reasonOf(readFromBuffer(container, options));
}

/** Runs `read` and returns the `reason` of the BackupContainerError it throws. */
export async function reasonOf(operation: Promise<unknown>): Promise<string> {
    try {
        await operation;
    } catch (error) {
        return (error as { reason?: string }).reason ?? `no reason: ${String(error)}`;
    }

    return "did not throw";
}
