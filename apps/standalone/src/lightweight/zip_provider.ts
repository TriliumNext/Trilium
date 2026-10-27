import type { FileStream, ZipArchive, ZipEntry, ZipProvider, ZipSource } from "@triliumnext/core/src/services/zip_provider.js";
import { inflateSync, strToU8, zipSync } from "fflate";

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
        const entries = await readCentralDirectory(toByteSource(source));
        const rawSamples = collectRawFilenameSamples(entries);
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
        for (const record of await readCentralDirectory(byteSource)) {
            await processEntry(
                { fileName: decodeZipFileName(record, filenameEncoding) },
                () => readEntryContent(byteSource, record)
            );
        }
    }

    createZipArchive(): ZipArchive {
        return new BrowserZipArchive();
    }

    createFileStream(_filePath: string): FileStream {
        throw new Error("File stream creation is not supported in the browser.");
    }
}

/** Random access to the archive's bytes, whether they are in memory or behind a `Blob`. */
interface ByteSource {
    size: number;
    read(offset: number, length: number): Promise<Uint8Array>;
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

/** One central directory record: everything needed to find, name and inflate an entry. */
interface CentralDirectoryRecord {
    /** The name exactly as stored, undecoded. */
    rawName: Uint8Array;
    /** Whether the language encoding flag (general purpose bit 11) is set, i.e. the archive declares UTF-8. */
    isUtf8Flagged: boolean;
    isEncrypted: boolean;
    compressionMethod: number;
    compressedSize: number;
    uncompressedSize: number;
    localHeaderOffset: number;
}

const LOCAL_HEADER_SIGNATURE = 0x04034b50;
const CENTRAL_HEADER_SIGNATURE = 0x02014b50;
/** The optional record that closes a central directory and is counted in its size. */
const DIGITAL_SIGNATURE_SIGNATURE = 0x05054b50;
const END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054b50;
const ZIP64_END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06064b50;
const ZIP64_LOCATOR_SIGNATURE = 0x07064b50;
const LOCAL_HEADER_LENGTH = 30;
const CENTRAL_HEADER_LENGTH = 46;
const END_OF_CENTRAL_DIRECTORY_LENGTH = 22;
const ZIP64_LOCATOR_LENGTH = 20;
const ZIP64_END_OF_CENTRAL_DIRECTORY_LENGTH = 56;
/** The longest comment the end-of-central-directory record can carry after itself. */
const MAX_COMMENT_LENGTH = 0xffff;
const ZIP64_EXTRA_FIELD_ID = 0x0001;
/** A 32-bit size or offset that holds this value is in the entry's ZIP64 extra field instead. */
const ZIP64_SATURATED = 0xffffffff;
/** General purpose bit 0: the entry is encrypted. */
const ENCRYPTED_FLAG = 0x1;
/** General purpose bit 11: the file name and comment are UTF-8. */
const UTF8_FLAG = 0x800;
const METHOD_STORED = 0;
const METHOD_DEFLATED = 8;

/**
 * Reads the end-of-central-directory record (and its ZIP64 counterpart, for an archive past 4 GiB or
 * 65535 entries), then the central directory it points to.
 */
async function readCentralDirectory(source: ByteSource): Promise<CentralDirectoryRecord[]> {
    if (source.size < END_OF_CENTRAL_DIRECTORY_LENGTH) {
        throw new Error("Truncated ZIP: no end-of-central-directory record.");
    }

    // The ZIP64 locator sits right before the end record, so the tail covers it at any comment length.
    const tailStart = Math.max(
        0,
        source.size - ZIP64_LOCATOR_LENGTH - END_OF_CENTRAL_DIRECTORY_LENGTH - MAX_COMMENT_LENGTH
    );
    const tail = await source.read(tailStart, source.size - tailStart);
    const tailView = viewOf(tail);

    let eocd = -1;
    for (let i = tail.byteLength - END_OF_CENTRAL_DIRECTORY_LENGTH; i >= 0; i--) {
        if (tailView.getUint32(i, true) === END_OF_CENTRAL_DIRECTORY_SIGNATURE) {
            eocd = i;
            break;
        }
    }
    if (eocd < 0) {
        throw new Error("Truncated ZIP: no end-of-central-directory record.");
    }

    let directorySize = tailView.getUint32(eocd + 12, true);
    let directoryOffset = tailView.getUint32(eocd + 16, true);

    const locator = eocd - ZIP64_LOCATOR_LENGTH;
    if (locator >= 0 && tailView.getUint32(locator, true) === ZIP64_LOCATOR_SIGNATURE) {
        const zip64Offset = readUint64(tailView, locator + 8);
        const zip64 = viewOf(await source.read(zip64Offset, ZIP64_END_OF_CENTRAL_DIRECTORY_LENGTH));
        if (zip64.byteLength < ZIP64_END_OF_CENTRAL_DIRECTORY_LENGTH
            || zip64.getUint32(0, true) !== ZIP64_END_OF_CENTRAL_DIRECTORY_SIGNATURE) {
            throw new Error("Corrupt ZIP: the ZIP64 end-of-central-directory record is missing.");
        }
        directorySize = readUint64(zip64, 40);
        directoryOffset = readUint64(zip64, 48);
    }

    if (directoryOffset + directorySize > source.size) {
        throw new Error("Corrupt ZIP: the central directory lies past the end of the file.");
    }

    const directory = await source.read(directoryOffset, directorySize);
    const view = viewOf(directory);
    const records: CentralDirectoryRecord[] = [];

    // Walked by header rather than by the recorded entry count, which saturates at 65535.
    let offset = 0;
    while (offset + CENTRAL_HEADER_LENGTH <= directory.byteLength
        && view.getUint32(offset, true) === CENTRAL_HEADER_SIGNATURE) {
        const flags = view.getUint16(offset + 8, true);
        const nameLength = view.getUint16(offset + 28, true);
        const extraLength = view.getUint16(offset + 30, true);
        const commentLength = view.getUint16(offset + 32, true);
        const nameStart = offset + CENTRAL_HEADER_LENGTH;
        const extraStart = nameStart + nameLength;
        if (extraStart + extraLength > directory.byteLength) {
            throw new Error("Corrupt ZIP: a central directory record runs past the directory.");
        }

        const record: CentralDirectoryRecord = {
            rawName: directory.subarray(nameStart, extraStart),
            isUtf8Flagged: !!(flags & UTF8_FLAG),
            isEncrypted: !!(flags & ENCRYPTED_FLAG),
            compressionMethod: view.getUint16(offset + 10, true),
            compressedSize: view.getUint32(offset + 20, true),
            uncompressedSize: view.getUint32(offset + 24, true),
            localHeaderOffset: view.getUint32(offset + 42, true)
        };
        applyZip64Extra(record, view, extraStart, extraLength);
        records.push(record);

        offset = extraStart + extraLength + commentLength;
    }

    // The entries are imported from this list, so a directory that stops early must not pass as complete.
    if (offset < directory.byteLength
        && (offset + 4 > directory.byteLength || view.getUint32(offset, true) !== DIGITAL_SIGNATURE_SIGNATURE)) {
        throw new Error("Corrupt ZIP: the central directory ends in an unreadable record.");
    }

    return records;
}

/**
 * Replaces the saturated 32-bit fields with the 64-bit values from the ZIP64 extra field, which
 * carries only the saturated ones, in the order uncompressed size, compressed size, local header offset.
 */
function applyZip64Extra(record: CentralDirectoryRecord, view: DataView, start: number, length: number) {
    const end = start + length;
    for (let offset = start; offset + 4 <= end;) {
        const id = view.getUint16(offset, true);
        const size = view.getUint16(offset + 2, true);
        let field = offset + 4;
        if (id === ZIP64_EXTRA_FIELD_ID) {
            for (const key of ["uncompressedSize", "compressedSize", "localHeaderOffset"] as const) {
                if (record[key] === ZIP64_SATURATED && field + 8 <= offset + 4 + size) {
                    record[key] = readUint64(view, field);
                    field += 8;
                }
            }
            return;
        }
        offset += 4 + size;
    }
}

/** Reads an entry's bytes through its local header, which can carry a different extra field length. */
async function readEntryContent(source: ByteSource, record: CentralDirectoryRecord): Promise<Uint8Array> {
    if (record.isEncrypted) {
        throw new Error("Encrypted ZIP entries are not supported.");
    }

    const header = viewOf(await source.read(record.localHeaderOffset, LOCAL_HEADER_LENGTH));
    if (header.byteLength < LOCAL_HEADER_LENGTH || header.getUint32(0, true) !== LOCAL_HEADER_SIGNATURE) {
        throw new Error("Corrupt ZIP: an entry's local header is missing.");
    }
    const dataStart = record.localHeaderOffset + LOCAL_HEADER_LENGTH
        + header.getUint16(26, true) + header.getUint16(28, true);
    const data = await source.read(dataStart, record.compressedSize);
    if (data.byteLength < record.compressedSize) {
        throw new Error("Truncated ZIP: an entry's data runs past the end of the file.");
    }

    switch (record.compressionMethod) {
        case METHOD_STORED:
            return data;
        case METHOD_DEFLATED:
            return inflateSync(data, { out: new Uint8Array(record.uncompressedSize) });
        default:
            throw new Error(`Unsupported ZIP compression method ${record.compressionMethod}.`);
    }
}

function viewOf(bytes: Uint8Array): DataView {
    return new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
}

/** ZIP64 values fit in a double for any archive a browser can hold. */
function readUint64(view: DataView, offset: number): number {
    return Number(view.getBigUint64(offset, true));
}

/**
 * Collects the raw name bytes of every entry whose encoding is genuinely unknown: the archive did not
 * flag it as UTF-8 and it does not decode as UTF-8 either.
 *
 * A flagged entry is excluded even when its bytes look unusual. Its encoding is already declared, so it
 * needs no rescuing, and sampling it would let one such name drag every other name in the archive
 * through the wrong decoder.
 */
function collectRawFilenameSamples(records: CentralDirectoryRecord[]): Uint8Array[] {
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
function decodeZipFileName(record: CentralDirectoryRecord, encoding?: string): string {
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
