import { MAX_BLOB_CONTENT_LENGTH } from "@triliumnext/core";
import {
    type ByteSource, readCentralDirectory, readEntryContent, type ZipRecord
} from "@triliumnext/core/src/services/utils/zip_records.js";
import { entryTooLargeError, type FileStream, type ZipArchive, type ZipEntry, type ZipProvider, type ZipSource } from "@triliumnext/core/src/services/zip_provider.js";
import { strToU8, zipSync } from "fflate";

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
    /** The most bytes `readContent()` inflates from one entry; nothing larger can be stored as a blob. */
    readonly #maxEntryLength: number;

    constructor(maxEntryLength = MAX_BLOB_CONTENT_LENGTH) {
        this.#maxEntryLength = maxEntryLength;
    }

    async detectFilenameEncoding(source: ZipSource): Promise<string> {
        const { records } = await readCentralDirectory(toByteSource(source));
        const rawSamples = collectRawFilenameSamples(records);
        if (rawSamples.length === 0) {
            return "utf-8";
        }
        return detectEncodingFromBytes(rawSamples);
    }

    /**
     * Reads one entry at a time: the central directory first, then each entry's bytes by offset when
     * `readContent()` asks for them. A `Blob` source is therefore never loaded whole.
     */
    async readZipFile(
        source: ZipSource,
        processEntry: (entry: ZipEntry, readContent: () => Promise<Uint8Array>) => Promise<void>,
        filenameEncoding?: string
    ): Promise<void> {
        const byteSource = toByteSource(source);
        for (const record of (await readCentralDirectory(byteSource)).records) {
            const fileName = decodeZipFileName(record, filenameEncoding);
            await processEntry({ fileName }, async () => {
                // `readEntryContent()` never inflates past the declared size, so checking it bounds
                // the allocation.
                if (record.uncompressedSize > this.#maxEntryLength) {
                    throw entryTooLargeError(fileName, this.#maxEntryLength);
                }
                return await readEntryContent(byteSource, record);
            });
        }
    }

    createZipArchive(): ZipArchive {
        return new BrowserZipArchive();
    }

    createFileStream(_filePath: string): FileStream {
        throw new Error("File stream creation is not supported in the browser.");
    }
}

/** The browser/WASM build has no filesystem, so a `path` source is unsupported here. */
function toByteSource(source: ZipSource): ByteSource {
    if (source instanceof Uint8Array) {
        return {
            size: source.byteLength,
            read: (offset, length) => Promise.resolve(source.subarray(offset, offset + length))
        };
    }
    if ("blob" in source) {
        const { blob } = source;
        return {
            size: blob.size,
            read: async (offset, length) => new Uint8Array(await blob.slice(offset, offset + length).arrayBuffer())
        };
    }
    throw new Error("Path-based zip reading is not supported in the browser; uploads arrive as bytes or a Blob.");
}

/**
 * Collects the raw name bytes of every entry whose encoding is genuinely unknown: the archive did not
 * flag it as UTF-8 and it does not decode as UTF-8 either.
 *
 * A flagged entry is excluded even when its bytes look unusual. Its encoding is already declared, so it
 * needs no rescuing, and sampling it would let one such name drag every other name in the archive
 * through the wrong decoder.
 */
function collectRawFilenameSamples(records: ZipRecord[]): Uint8Array[] {
    const utf8 = new TextDecoder("utf-8", { fatal: true });
    const samples: Uint8Array[] = [];

    for (const { rawName, isUtf8Flagged } of records) {
        if (isUtf8Flagged) {
            continue;
        }
        try {
            utf8.decode(rawName);
        } catch {
            samples.push(rawName);
        }
    }

    return samples;
}

/**
 * Decodes an entry's name. A UTF-8-flagged name is decoded as UTF-8. An unflagged name is ambiguous,
 * since many archivers write UTF-8 or a legacy codepage without setting the flag, so it is decoded with
 * the detected encoding, then UTF-8, and failing both one character per byte.
 */
function decodeZipFileName(record: ZipRecord, encoding?: string): string {
    if (record.isUtf8Flagged) {
        return new TextDecoder("utf-8").decode(record.rawName);
    }

    for (const label of encoding && encoding !== "utf-8" ? [encoding, "utf-8"] : ["utf-8"]) {
        try {
            return new TextDecoder(label, { fatal: true }).decode(record.rawName);
        } catch {
            // An unknown label or bytes invalid in it: try the next one.
        }
    }

    let name = "";
    for (const byte of record.rawName) {
        name += String.fromCharCode(byte);
    }
    return name;
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
