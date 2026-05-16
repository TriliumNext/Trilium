import type { FileStream, ZipArchive, ZipEntry, ZipProvider } from "@triliumnext/core/src/services/zip_provider.js";
import archiver, { type Archiver } from "archiver";
import fs from "fs";
import type { Stream } from "stream";
import * as yauzl from "yauzl";

class NodejsZipArchive implements ZipArchive {
    readonly #archive: Archiver;

    constructor() {
        this.#archive = archiver("zip", {
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
    detectFilenameEncoding(buffer: Uint8Array): Promise<string> {
        return new Promise<string>((res, rej) => {
            yauzl.fromBuffer(Buffer.from(buffer), { lazyEntries: true, validateEntrySizes: false, decodeStrings: false }, (err, zipfile) => {
                if (err) return rej(err);
                if (!zipfile) return rej(new Error("Unable to read zip file."));

                const samples: Buffer[] = [];
                zipfile.readEntry();
                zipfile.on("entry", (entry: yauzl.Entry) => {
                    const isUtf8Flagged = !!(entry.generalPurposeBitFlag & 0x800);
                    if (!isUtf8Flagged && Buffer.isBuffer(entry.fileName)) {
                        samples.push(entry.fileName as Buffer);
                    }
                    zipfile.readEntry();
                });
                zipfile.on("end", async () => {
                    if (samples.length === 0) {
                        return res("utf-8");
                    }
                    const combined = Buffer.concat(samples);
                    try {
                        const chardet = await import("chardet");
                        const detected = chardet.default.detect(combined);
                        res(detected || "utf-8");
                    } catch {
                        res("utf-8");
                    }
                });
                zipfile.on("error", rej);
            });
        });
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

    readZipFile(
        buffer: Uint8Array,
        processEntry: (entry: ZipEntry, readContent: () => Promise<Uint8Array>) => Promise<void>,
        filenameEncoding?: string
    ): Promise<void> {
        return new Promise<void>((res, rej) => {
            yauzl.fromBuffer(Buffer.from(buffer), { lazyEntries: true, validateEntrySizes: false, decodeStrings: false }, (err, zipfile) => {
                if (err) { rej(err); return; }
                if (!zipfile) { rej(new Error("Unable to read zip file.")); return; }

                zipfile.readEntry();
                zipfile.on("entry", async (entry: yauzl.Entry) => {
                    try {
                        // yauzl with decodeStrings: false returns fileName as a Buffer.
                        // Use the detected encoding for non-UTF-8-flagged entries,
                        // falling back to UTF-8.
                        let fileName: string;
                        if (Buffer.isBuffer(entry.fileName)) {
                            const isUtf8Flagged = !!(entry.generalPurposeBitFlag & 0x800);
                            const encoding = isUtf8Flagged ? "utf-8" : (filenameEncoding || "utf-8");
                            fileName = decodeBuffer(entry.fileName as Buffer, encoding);
                        } else {
                            fileName = entry.fileName;
                        }

                        const readContent = () => new Promise<Uint8Array>((res, rej) => {
                            zipfile.openReadStream(entry, (err, readStream) => {
                                if (err) { rej(err); return; }
                                if (!readStream) { rej(new Error("Unable to read content.")); return; }
                                streamToBuffer(readStream).then(res, rej);
                            });
                        });

                        await processEntry({ fileName }, readContent);
                    } catch (e) {
                        rej(e);
                    }
                    zipfile.readEntry();
                });
                zipfile.on("end", res);
                zipfile.on("error", rej);
            });
        });
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
