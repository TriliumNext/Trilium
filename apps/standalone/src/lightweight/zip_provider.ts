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
        const rawSamples = collectRawFilenameSamples(buffer);
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
            // Read inside the executor so a malformed archive rejects rather than throwing
            // synchronously, matching how an unzip() failure surfaces.
            const fileNames = readCentralDirectory(buffer);

            unzip(buffer, async (err, files) => {
                if (err) { rej(err); return; }

                try {
                    for (const [fileName, data] of Object.entries(files)) {
                        await processEntry(
                            { fileName: decodeZipFileName(fileName, fileNames.get(fileName), filenameEncoding) },
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
}

/** What an entry's name actually is on disk, as opposed to what fflate made of it. */
interface FileNameInfo {
    /** The name exactly as stored, undecoded. */
    rawBytes: Uint8Array;
    /** Whether the language encoding flag (general purpose bit 11) is set, i.e. the archive declares UTF-8. */
    isUtf8Flagged: boolean;
}

/**
 * Collects the raw name bytes of every entry whose encoding is genuinely unknown: the archive did not
 * flag it as UTF-8 and it does not decode as UTF-8 either.
 *
 * A flagged entry is excluded even when its bytes look unusual. Its encoding is already declared, so it
 * needs no rescuing — and sampling it would let one such name drag every *other* name in the archive
 * through the wrong decoder.
 */
function collectRawFilenameSamples(buffer: Uint8Array): Uint8Array[] {
    const utf8 = new TextDecoder("utf-8", { fatal: true });
    const samples: Uint8Array[] = [];

    for (const { rawBytes, isUtf8Flagged } of readCentralDirectory(buffer).values()) {
        if (isUtf8Flagged) {
            continue;
        }
        try {
            utf8.decode(rawBytes);
        } catch {
            samples.push(rawBytes);
        }
    }

    return samples;
}

/**
 * Resolves an entry's name from what fflate decoded plus what the archive actually recorded.
 *
 * fflate hands names back already decoded, choosing UTF-8 or Latin-1 by the language encoding flag —
 * which it never exposes. A flagged name is therefore already correct and is passed through untouched;
 * re-deriving bytes from it would truncate every character above U+00FF (a curly apostrophe in a note
 * title becoming a control character, and the entry then matching nothing in `!!!meta.json`).
 *
 * Only an unflagged name is ambiguous — many real-world archives write UTF-8, or a legacy codepage,
 * without setting the flag — so those are re-decoded from their raw bytes with the detected encoding.
 */
function decodeZipFileName(name: string, info: FileNameInfo | undefined, encoding?: string): string {
    // A name missing from the central directory (a duplicate entry, say) keeps fflate's reading.
    if (!info || info.isUtf8Flagged) {
        return name;
    }

    try {
        return new TextDecoder(encoding || "utf-8", { fatal: true }).decode(info.rawBytes);
    } catch {
        if (encoding && encoding !== "utf-8") {
            // Encoding detection was wrong for this entry, try UTF-8
            try {
                return new TextDecoder("utf-8", { fatal: true }).decode(info.rawBytes);
            } catch {
                return name;
            }
        }
        return name;
    }
}

const CENTRAL_HEADER_SIGNATURE = 0x02014b50;
const END_OF_CENTRAL_DIRECTORY_SIGNATURE = 0x06054b50;
const CENTRAL_HEADER_LENGTH = 46;
const END_OF_CENTRAL_DIRECTORY_LENGTH = 22;
/** General purpose bit 11: the file name and comment are UTF-8. */
const UTF8_FLAG = 0x800;

/**
 * Reads the archive's central directory for the two facts fflate discards — each entry's raw name bytes
 * and its language encoding flag — keyed by the string fflate produces for that entry, which is the only
 * handle the callers have on it.
 *
 * This also replaces what used to be a second full `unzip()` pass done purely to sample file names: the
 * central directory carries them verbatim, so no entry has to be inflated to read one.
 */
function readCentralDirectory(buffer: Uint8Array): Map<string, FileNameInfo> {
    const entries = new Map<string, FileNameInfo>();
    if (buffer.byteLength < END_OF_CENTRAL_DIRECTORY_LENGTH) {
        throw new Error("Truncated ZIP: no end-of-central-directory record.");
    }

    const view = new DataView(buffer.buffer, buffer.byteOffset, buffer.byteLength);

    // The end-of-central-directory record is last, but a trailing comment of up to 64 KiB may follow it.
    let eocd = -1;
    const earliest = Math.max(0, buffer.byteLength - END_OF_CENTRAL_DIRECTORY_LENGTH - 0xffff);
    for (let i = buffer.byteLength - END_OF_CENTRAL_DIRECTORY_LENGTH; i >= earliest; i--) {
        if (view.getUint32(i, true) === END_OF_CENTRAL_DIRECTORY_SIGNATURE) {
            eocd = i;
            break;
        }
    }
    if (eocd < 0) {
        throw new Error("Truncated ZIP: no end-of-central-directory record.");
    }

    // Walk the directory by header rather than by the recorded entry count, which saturates at 65535
    // (and is then only recoverable from a ZIP64 record). A ZIP64 offset saturates to 0xFFFFFFFF, which
    // lands past `end` and simply yields no entries — every name then keeps fflate's own decoding.
    let offset = view.getUint32(eocd + 16, true);
    const end = Math.min(buffer.byteLength, offset + view.getUint32(eocd + 12, true));

    while (offset + CENTRAL_HEADER_LENGTH <= end && view.getUint32(offset, true) === CENTRAL_HEADER_SIGNATURE) {
        const isUtf8Flagged = !!(view.getUint16(offset + 8, true) & UTF8_FLAG);
        const nameLength = view.getUint16(offset + 28, true);
        const extraLength = view.getUint16(offset + 30, true);
        const commentLength = view.getUint16(offset + 32, true);
        const nameStart = offset + CENTRAL_HEADER_LENGTH;

        if (nameStart + nameLength > end) {
            break;
        }

        const rawBytes = buffer.subarray(nameStart, nameStart + nameLength);
        entries.set(decodeAsFflateDoes(rawBytes, isUtf8Flagged), { rawBytes, isUtf8Flagged });

        offset = nameStart + nameLength + extraLength + commentLength;
    }

    return entries;
}

/**
 * Reproduces the string fflate hands back for an entry, so a central directory record can be matched to
 * it: UTF-8 when the archive flags the name as such, otherwise one character per byte.
 *
 * The Latin-1 branch cannot use `TextDecoder`, whose "latin1"/"iso-8859-1" labels are aliases of
 * windows-1252 and so map 0x80-0x9F to different code points than the plain byte-to-char widening
 * fflate performs.
 */
function decodeAsFflateDoes(rawBytes: Uint8Array, isUtf8Flagged: boolean): string {
    if (isUtf8Flagged) {
        return new TextDecoder("utf-8").decode(rawBytes);
    }

    let name = "";
    for (const byte of rawBytes) {
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
