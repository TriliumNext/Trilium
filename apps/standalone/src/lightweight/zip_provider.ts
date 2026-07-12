import type { FileStream, ZipArchive, ZipEntry, ZipProvider, ZipSource } from "@triliumnext/core/src/services/zip_provider.js";
import { strToU8, unzip, zipSync } from "fflate";

/** The browser/WASM build has no filesystem, so a `path` source is unsupported here — only raw bytes. */
function requireBuffer(source: ZipSource): Uint8Array {
    if (!(source instanceof Uint8Array)) {
        throw new Error("Path-based zip reading is not supported in the browser; uploads arrive as bytes.");
    }
    return source;
}

type ZipOutput = {
    send?: (body: unknown) => unknown;
    write?: (chunk: Uint8Array | string) => unknown;
    end?: (chunk?: Uint8Array | string) => unknown;
};

class BrowserZipArchive implements ZipArchive {
    readonly #entries: Record<string, Uint8Array | [Uint8Array, { level: 0 }]> = {};
    #destination: ZipOutput | null = null;

    append(content: string | Uint8Array, options: { name: string; store?: boolean }) {
        const data = typeof content === "string" ? strToU8(content) : content;
        // fflate honors a per-entry level; level 0 stores the entry uncompressed.
        this.#entries[options.name] = options.store ? [data, { level: 0 }] : data;
    }

    waitForCapacity(): Promise<void> {
        // zipSync builds the whole archive in memory anyway, so there's nothing
        // to pace against — resolve immediately.
        return Promise.resolve();
    }

    pipe(destination: unknown) {
        this.#destination = destination as ZipOutput;
    }

    async finalize(): Promise<void> {
        if (!this.#destination) {
            throw new Error("ZIP output destination not set.");
        }

        const content = zipSync(this.#entries, { level: 6 });

        if (typeof this.#destination.send === "function") {
            this.#destination.send(content);
            return;
        }

        if (typeof this.#destination.end === "function") {
            if (typeof this.#destination.write === "function") {
                this.#destination.write(content);
                this.#destination.end();
            } else {
                this.#destination.end(content);
            }
            return;
        }

        throw new Error("Unsupported ZIP output destination.");
    }
}

export default class BrowserZipProvider implements ZipProvider {
    async detectFilenameEncoding(source: ZipSource): Promise<string> {
        const buffer = requireBuffer(source);
        // fflate decodes filenames as CP437/Latin-1 (preserving raw bytes).
        // We recover raw bytes and detect the encoding.
        const rawSamples = await this.#collectRawFilenameSamples(buffer);
        if (rawSamples.length === 0) {
            return "utf-8";
        }
        return detectEncodingFromBytes(rawSamples);
    }

    createZipArchive(): ZipArchive {
        return new BrowserZipArchive();
    }

    createFileStream(_filePath: string): FileStream {
        throw new Error("File stream creation is not supported in the browser.");
    }

    readZipFile(
        source: ZipSource,
        processEntry: (entry: ZipEntry, readContent: () => Promise<Uint8Array>) => Promise<void>,
        filenameEncoding?: string
    ): Promise<void> {
        const buffer = requireBuffer(source);
        return new Promise<void>((res, rej) => {
            unzip(buffer, async (err, files) => {
                if (err) { rej(err); return; }

                try {
                    for (const [fileName, data] of Object.entries(files)) {
                        await processEntry(
                            { fileName: decodeZipFileName(fileName, filenameEncoding) },
                            () => Promise.resolve(data)
                        );
                    }
                    res();
                } catch (e) {
                    rej(e);
                }
            });
        });
    }

    /**
     * Does a first pass over the ZIP to collect raw filename bytes
     * from entries that aren't valid UTF-8.
     */
    #collectRawFilenameSamples(buffer: Uint8Array): Promise<Uint8Array[]> {
        return new Promise<Uint8Array[]>((res, rej) => {
            unzip(buffer, (err, files) => {
                if (err) { rej(err); return; }

                const samples: Uint8Array[] = [];
                const utf8 = new TextDecoder("utf-8", { fatal: true });
                for (const fileName of Object.keys(files)) {
                    const bytes = recoverRawBytes(fileName);
                    try {
                        utf8.decode(bytes);
                    } catch {
                        samples.push(bytes);
                    }
                }
                res(samples);
            });
        });
    }
}

/** Recover original raw bytes from fflate's CP437/Latin-1 decoded string. */
function recoverRawBytes(name: string): Uint8Array {
    const bytes = new Uint8Array(name.length);
    for (let i = 0; i < name.length; i++) {
        bytes[i] = name.charCodeAt(i) & 0xff;
    }
    return bytes;
}

/**
 * fflate decodes ZIP entry filenames as CP437/Latin-1 unless the language
 * encoding flag (general purpose bit 11) is set, but many real-world archives
 * write UTF-8 or other encodings without setting that flag.
 * Recover the original raw bytes and re-decode with the detected encoding.
 */
function decodeZipFileName(name: string, encoding?: string): string {
    const bytes = recoverRawBytes(name);
    try {
        return new TextDecoder(encoding || "utf-8", { fatal: true }).decode(bytes);
    } catch {
        if (encoding && encoding !== "utf-8") {
            // Encoding detection was wrong for this entry, try UTF-8
            try {
                return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
            } catch {
                return name;
            }
        }
        return name;
    }
}

/** Common CJK encodings to try when filenames aren't valid UTF-8. */
const CANDIDATE_ENCODINGS = ["gbk", "shift_jis", "euc-kr", "big5"];

/**
 * Detect encoding from raw filename bytes by trying TextDecoder with
 * common encodings. Returns the first encoding that can decode all samples
 * without errors, or "utf-8" as fallback.
 */
function detectEncodingFromBytes(samples: Uint8Array[]): string {
    for (const encoding of CANDIDATE_ENCODINGS) {
        try {
            const decoder = new TextDecoder(encoding, { fatal: true });
            let valid = true;
            for (const sample of samples) {
                try {
                    decoder.decode(sample);
                } catch {
                    valid = false;
                    break;
                }
            }
            if (valid) {
                return encoding;
            }
        } catch {
            // TextDecoder doesn't support this encoding in this environment
            continue;
        }
    }
    return "utf-8";
}
