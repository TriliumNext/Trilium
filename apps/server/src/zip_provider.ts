import type { FileStream, ZipArchive, ZipEntry, ZipProvider } from "@triliumnext/core/src/services/zip_provider.js";
import { ZipArchive as ArchiverZip } from "archiver";
import fs from "fs";
import type { Stream } from "stream";
import * as yauzl from "yauzl";

class NodejsZipArchive implements ZipArchive {
    readonly #archive: ArchiverZip;

    constructor() {
        this.#archive = new ArchiverZip({
            zlib: { level: 9 }
        });
    }

    append(content: string | Uint8Array, options: { name: string; date?: Date }) {
        this.#archive.append(typeof content === "string" ? content : Buffer.from(content), options);
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

export default class NodejsZipProvider implements ZipProvider {
    async detectFilenameEncoding(buffer: Uint8Array): Promise<string> {
        const zipfile = await yauzl.fromBufferPromise(Buffer.from(buffer), {
            validateEntrySizes: false,
            decodeStrings: false
        });

        const samples: Buffer[] = [];
        for await (const entry of zipfile.eachEntry()) {
            const isUtf8Flagged = !!(entry.generalPurposeBitFlag & 0x800);
            if (!isUtf8Flagged) {
                samples.push(entry.fileNameRaw);
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
        buffer: Uint8Array,
        processEntry: (entry: ZipEntry, readContent: () => Promise<Uint8Array>) => Promise<void>,
        filenameEncoding?: string
    ): Promise<void> {
        const zipfile = await yauzl.fromBufferPromise(Buffer.from(buffer), {
            validateEntrySizes: false,
            decodeStrings: false
        });

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
