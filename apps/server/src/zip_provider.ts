import type { FileStream, ZipArchive, ZipArchiveEntryOptions, ZipEntry, ZipProvider, ZipSource } from "@triliumnext/core/src/services/zip_provider.js";
import { ZipArchive as ArchiverZip } from "archiver";
import fs from "fs";
import type { Stream } from "stream";
import * as yauzl from "yauzl";

class NodejsZipArchive implements ZipArchive {
    readonly #archive: ArchiverZip;
    // Byte sizes of appended entries not yet written out, in FIFO order.
    // archiver processes its queue strictly in order at concurrency 1 and emits
    // exactly one "entry" event per append, so this stays aligned with it.
    readonly #pendingSizes: number[] = [];
    #queuedBytes = 0;
    #capacityWaiter: { resolve: () => void; reject: (err: Error) => void } | null = null;
    // First error emitted by archiver (disk full, zlib failure, …); surfaced through append/waitForCapacity.
    #error: Error | null = null;

    // Cap how much appended-but-unwritten data archiver holds in its internal
    // queue. The export walk appends the whole note tree synchronously; without
    // this the entire archive (multi-GB) is read into memory before draining.
    static readonly #HIGH_WATER_MARK = 64 * 1024 * 1024; // 64 MiB

    constructor() {
        this.#archive = new ArchiverZip({
            // Level 6 (zlib default) is the speed/ratio sweet spot; level 9 costs
            // ~2x the CPU for <2% smaller output. Already-compressed entries skip
            // deflate entirely via the per-entry `store` flag below.
            zlib: { level: 6 }
        });

        // An EventEmitter with no "error" listener throws as an *unhandled* exception when it errors, which
        // crashes the process. Capture archiver's error and re-surface it through append/waitForCapacity/
        // finalize so the export fails cleanly instead.
        this.#archive.on("error", (err: Error) => {
            this.#error = err;
            if (this.#capacityWaiter) {
                const waiter = this.#capacityWaiter;
                this.#capacityWaiter = null;
                waiter.reject(err);
            }
        });

        // Fires as each queued entry finishes being written to the output.
        this.#archive.on("entry", () => {
            this.#queuedBytes -= this.#pendingSizes.shift() ?? 0;
            if (this.#capacityWaiter && this.#queuedBytes < NodejsZipArchive.#HIGH_WATER_MARK) {
                const waiter = this.#capacityWaiter;
                this.#capacityWaiter = null;
                waiter.resolve();
            }
        });
    }

    append(content: string | Uint8Array, options: ZipArchiveEntryOptions) {
        if (this.#error) {
            throw this.#error;
        }
        // Wrap the Uint8Array in a Buffer view sharing the same memory rather
        // than copying it (Buffer.from(uint8array) would allocate a full copy).
        // byteOffset/byteLength keep the view scoped to this slice, never the
        // surrounding backing buffer. archiver only reads, so sharing is safe.
        const payload = typeof content === "string" ? content : Buffer.from(content.buffer, content.byteOffset, content.byteLength);
        const size = typeof content === "string" ? Buffer.byteLength(content) : content.byteLength;
        this.#pendingSizes.push(size);
        this.#queuedBytes += size;
        // `store` (and `date`) pass straight through: archiver preserves extra
        // entry-data fields and zip-stream switches to the STORE method when set.
        this.#archive.append(payload, options);
    }

    waitForCapacity(): Promise<void> {
        if (this.#error) {
            return Promise.reject(this.#error);
        }
        if (this.#queuedBytes < NodejsZipArchive.#HIGH_WATER_MARK) {
            return Promise.resolve();
        }
        // At most one waiter: the export loop awaits this before the next append.
        return new Promise((resolve, reject) => { this.#capacityWaiter = { resolve, reject }; });
    }

    pipe(destination: unknown) {
        this.#archive.pipe(destination as NodeJS.WritableStream);
    }

    finalize(): Promise<void> {
        return this.#archive.finalize();
    }
}

function streamToBuffer(stream: Stream): Promise<Buffer> {
    const chunks: Uint8Array[] = [];
    stream.on("data", (chunk: Uint8Array) => chunks.push(chunk));
    return new Promise((res, rej) => {
        stream.on("end", () => res(Buffer.concat(chunks)));
        stream.on("error", rej);
    });
}

async function openZip(source: ZipSource) {
    const options = { validateEntrySizes: false, decodeStrings: false };
    if (source instanceof Uint8Array) {
        // Wrap the bytes in a Buffer *view* (no copy); fall through to fromBuffer. A `path` source is
        // opened straight from disk so a multi-GB zip is never held in memory (and dodges fs.readFile's
        // ~2 GiB ceiling) — yauzl reads the central directory and each entry on demand from the fd.
        const buf = Buffer.isBuffer(source) ? source : Buffer.from(source.buffer, source.byteOffset, source.byteLength);
        return yauzl.fromBufferPromise(buf, options);
    }
    return yauzl.openPromise(source.path, options);
}

export default class NodejsZipProvider implements ZipProvider {
    async detectFilenameEncoding(source: ZipSource): Promise<string> {
        const zipfile = await openZip(source);

        const samples: Buffer[] = [];
        try {
            for await (const entry of zipfile.eachEntry()) {
                const isUtf8Flagged = !!(entry.generalPurposeBitFlag & 0x800);
                if (!isUtf8Flagged) {
                    samples.push(entry.fileNameRaw);
                }
            }
        } finally {
            // Release the file descriptor for a path source (no-op for an already-closed buffer reader).
            if (zipfile.isOpen) {
                zipfile.close();
            }
        }

        if (samples.length === 0) {
            return "utf-8";
        }

        const combined = Buffer.concat(samples);
        try {
            const chardet = await import("chardet");
            return chardet.default.detect(combined) || "utf-8";
        } catch {
            return "utf-8";
        }
    }

    createZipArchive(): ZipArchive {
        return new NodejsZipArchive();
    }

    createFileStream(filePath: string): FileStream {
        const stream = fs.createWriteStream(filePath);
        return {
            destination: stream,
            waitForFinish: () => new Promise((resolve, reject) => {
                stream.on("finish", resolve);
                stream.on("error", reject);
            })
        };
    }

    async readZipFile(
        source: ZipSource,
        processEntry: (entry: ZipEntry, readContent: () => Promise<Uint8Array>) => Promise<void>,
        filenameEncoding?: string
    ): Promise<void> {
        const zipfile = await openZip(source);

        try {
            for await (const entry of zipfile.eachEntry()) {
                // yauzl with decodeStrings: false leaves file names undecoded.
                // Use the detected encoding for non-UTF-8-flagged entries,
                // falling back to UTF-8.
                const isUtf8Flagged = !!(entry.generalPurposeBitFlag & 0x800);
                const encoding = isUtf8Flagged ? "utf-8" : (filenameEncoding || "utf-8");
                const fileName = decodeBuffer(entry.fileNameRaw, encoding);

                const readContent = async () => {
                    const readStream = await zipfile.openReadStreamPromise(entry);
                    return await streamToBuffer(readStream);
                };

                await processEntry({ fileName, lastModified: entry.getLastModDate() }, readContent);
            }
        } finally {
            // Release the file descriptor for a path source (no-op for an already-closed buffer reader).
            if (zipfile.isOpen) {
                zipfile.close();
            }
        }
    }
}

function decodeBuffer(buf: Buffer, encoding: string): string {
    try {
        return new TextDecoder(encoding).decode(buf);
    } catch {
        // Fallback if the encoding label isn't supported by TextDecoder
        return buf.toString("utf-8");
    }
}
